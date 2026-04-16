import json
import os
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles

DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

app = FastAPI()


@app.post("/webhook")
async def receive_hit(request: Request):
    body = await request.body()
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return Response(status_code=400)

    webrtc = payload.get("webrtc_ips", {})
    tz     = payload.get("timezone", {})
    device = payload.get("device", {})
    fp     = payload.get("canvas_fingerprint", "none")
    ts     = payload.get("timestamp", "")

    public_ips = ", ".join(webrtc.get("public", [])) or "none detected"
    local_ips  = ", ".join(webrtc.get("local",  [])) or "none detected"

    embed = {
        "username": "Honeypot",
        "embeds": [{
            "title": "🖕 Scammer Hit",
            "color": 0xFF3B30,
            "timestamp": ts,
            "fields": [
                {"name": "Public IPs (WebRTC)", "value": public_ips, "inline": False},
                {"name": "Local IPs",           "value": local_ips,  "inline": False},
                {"name": "Timezone",   "value": f"{tz.get('timezone', '?')} ({tz.get('utc_offset', '?')})", "inline": True},
                {"name": "Language",   "value": tz.get("primary_language", "unknown"), "inline": True},
                {"name": "Platform",   "value": device.get("platform", "unknown"),     "inline": True},
                {"name": "Screen",     "value": device.get("screen_resolution", "?"),  "inline": True},
                {"name": "Canvas FP",  "value": fp,                                    "inline": True},
                {"name": "Referrer",   "value": device.get("referrer", "direct"),      "inline": True},
                {"name": "User Agent", "value": device.get("user_agent", "?")[:1000],  "inline": False},
            ],
        }],
    }

    if DISCORD_WEBHOOK_URL:
        async with httpx.AsyncClient() as client:
            await client.post(DISCORD_WEBHOOK_URL, json=embed)

    return {"ok": True}


# Serve static files — mounted last so /webhook takes priority
app.mount("/", StaticFiles(directory="public", html=True), name="static")
