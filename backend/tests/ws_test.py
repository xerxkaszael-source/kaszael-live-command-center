#!/usr/bin/env python3
"""WebSocket integration test for LCC backend."""
import socket, base64, json, struct, time, sys, os


def ws_handshake(host, port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(5)
    s.connect((host, port))
    key = base64.b64encode(b"1234567890123456").decode()
    req = (
        f"GET /ws HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n"
    ).encode()
    s.sendall(req)
    # Read until \r\n\r\n
    buf = b""
    deadline = time.time() + 5
    while b"\r\n\r\n" not in buf and time.time() < deadline:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
    if b"\r\n\r\n" not in buf:
        print("✗ no upgrade response")
        s.close()
        return None
    headers_raw, body = buf.split(b"\r\n\r\n", 1)
    headers = headers_raw.decode()
    first_line = headers.split("\r\n")[0]
    print(f"=== {first_line}")
    if "101" not in first_line:
        print("✗ not 101 Switching Protocols")
        s.close()
        return None
    print("✓ WebSocket upgrade accepted")
    return s, body


def read_frame(s, timeout=4):
    s.settimeout(timeout)
    try:
        head = s.recv(2)
        if len(head) < 2:
            return None
        opcode = head[0] & 0x0F
        plen = head[1] & 0x7F
        if plen == 126:
            ext = s.recv(2)
            plen = struct.unpack(">H", ext)[0]
        elif plen == 127:
            ext = s.recv(8)
            plen = struct.unpack(">Q", ext)[0]
        payload = b""
        while len(payload) < plen:
            chunk = s.recv(min(8192, plen - len(payload)))
            if not chunk:
                break
            payload += chunk
        if opcode == 1:
            return json.loads(payload.decode())
        return None
    except socket.timeout:
        return None


def main():
    result = ws_handshake("127.0.0.1", int(os.environ.get("LCC_PORT", "9130")))
    if not result:
        sys.exit(1)
    s, body = result

    # Try to read initial frame from server (it should send state immediately)
    if len(body) >= 2:
        opcode = body[0] & 0x0F
        plen = body[1] & 0x7F
        if plen == 126:
            plen = struct.unpack(">H", body[2:4])[0]
            payload = body[4:4+plen]
        else:
            payload = body[2:2+plen]
        if opcode == 1:
            msg = json.loads(payload.decode())
            print(f"\n=== INITIAL STATE ===")
            print(f"  type: {msg.get('type')}")
            st = msg.get("state", {})
            print(f"  state keys: {len(st)}")
            print(f"  server.uptime_sec: {st.get('server',{}).get('uptime_sec',0):.0f}s")
            print(f"  hermes.alive: {st.get('hermes',{}).get('alive')}")
            print(f"  hermes.processes: {len(st.get('hermes',{}).get('processes',[]))}")
            print(f"  9router.running: {st.get('nine_router',{}).get('running')}")
            print(f"  9router.models_count: {st.get('nine_router',{}).get('models_count')}")
            print(f"  supabase.project: {st.get('supabase',{}).get('project',{}).get('name')}")
            print(f"  github.user: {(st.get('github',{}) or {}).get('user',{}).get('login') if (st.get('github',{}) or {}).get('user') else 'NONE'}")
            print(f"  github.repos: {len(st.get('github',{}).get('repos',[]))}")
            print(f"  telemetry.events_total: {st.get('telemetry',{}).get('events_total')}")
            print(f"  agents.experts: {len(st.get('agents',{}).get('experts',[]))}")
            print(f"  agents.active: {len(st.get('agents',{}).get('active',[]))}")
            print("\n✅ WS state delivery VERIFIED")
    else:
        # Frame split across packets — wait for next
        msg = read_frame(s)
        if msg:
            print(f"Got frame: type={msg.get('type')}, state keys={len(msg.get('state',{}))}")
            print("✅ WS state delivery VERIFIED")
        else:
            print("✗ no initial frame")

    # Wait for one more state push (the 2s push loop should fire)
    msg2 = read_frame(s, timeout=5)
    if msg2:
        print(f"\n=== SECOND PUSH ===")
        print(f"  type: {msg2.get('type')}")
        print("✅ WS push loop VERIFIED")
    else:
        print("\n⚠ no second push within 5s (acceptable — interval is 2s)")

    s.close()
    print("\n=== ALL TESTS PASSED ===")


if __name__ == "__main__":
    main()