function getCanvasFingerprint() {
  const canvas = document.createElement("canvas");
  canvas.width = 300; canvas.height = 60;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f0f0f0"; ctx.fillRect(0, 0, 300, 60);
  ctx.fillStyle = "#6d1ed4"; ctx.font = "14px Arial";
  ctx.fillText("secure-token-v2", 10, 25);
  ctx.strokeStyle = "rgba(200,80,80,0.6)";
  ctx.beginPath(); ctx.arc(150, 40, 15, 0, Math.PI * 2); ctx.stroke();
  const dataURL = canvas.toDataURL();
  let hash = 0;
  for (let i = 0; i < dataURL.length; i++) {
    hash = ((hash << 5) - hash) + dataURL.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function getTimezoneData() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = navigator.language;
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hrs = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mins = String(Math.abs(offset) % 60).padStart(2, "0");
  return {
    timezone: tz,
    utc_offset: `UTC${sign}${hrs}:${mins}`,
    primary_language: locale,
    all_languages: navigator.languages ? [...navigator.languages] : [locale]
  };
}

function getWebRTCIPs() {
  return new Promise((resolve) => {
    const ips = { local: [], public: [] };
    const RTCPeer = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    if (!RTCPeer) { resolve({ error: "WebRTC not supported" }); return; }
    const pc = new RTCPeer({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
    const seen = new Set();
    pc.createDataChannel("");
    pc.createOffer().then(offer => pc.setLocalDescription(offer));
    pc.onicecandidate = (e) => {
      if (!e || !e.candidate || !e.candidate.candidate) { finish(); return; }
      const ipRegex = /(\d{1,3}(\.\d{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{0,4}){2,7})/gi;
      let m;
      while ((m = ipRegex.exec(e.candidate.candidate)) !== null) {
        const ip = m[1];
        if (seen.has(ip) || ip === "0.0.0.0") continue;
        seen.add(ip);
        if (ip.startsWith("192.168") || ip.startsWith("10.") || ip.startsWith("172.")) ips.local.push(ip);
        else if (!ip.startsWith("::") && !ip.startsWith("fe80")) ips.public.push(ip);
      }
    };
    function finish() { pc.close(); resolve(ips); }
    setTimeout(finish, 4000);
  });
}

async function sendFingerprint() {
  const webrtcData = await getWebRTCIPs();
  const payload = {
    event: "page_load",
    timestamp: new Date().toISOString(),
    webrtc_ips: webrtcData,
    timezone: getTimezoneData(),
    canvas_fingerprint: getCanvasFingerprint(),
    device: {
      screen_resolution: `${screen.width}x${screen.height}`,
      color_depth: screen.colorDepth,
      device_memory_gb: navigator.deviceMemory || "unknown",
      cpu_cores: navigator.hardwareConcurrency || "unknown",
      platform: navigator.platform || "unknown",
      vendor: navigator.vendor || "unknown",
      user_agent: navigator.userAgent,
      referrer: document.referrer || "direct"
    }
  };
  try {
    navigator.sendBeacon
      ? navigator.sendBeacon("/webhook", JSON.stringify(payload))
      : fetch("/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true });
  } catch (e) {}
}

sendFingerprint();
