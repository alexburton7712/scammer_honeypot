#!/usr/bin/env python3
# Lists all currently connected scammer sessions.
#
# Usage:
#   python3 scripts/sessions.py

import json
import urllib.request

SERVER = "http://localhost:8000"

with urllib.request.urlopen(f"{SERVER}/admin/sessions") as resp:
    data = json.loads(resp.read())
    sessions = data.get("sessions", [])
    if not sessions:
        print("No scammers connected.")
    else:
        print(f"{len(sessions)} scammer(s) connected:")
        for s in sessions:
            print(f"  {s}")
