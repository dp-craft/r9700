#!/usr/bin/env python3
"""capture_proxy.py LISTEN_PORT UPSTREAM_URL OUT_DIR -- forward HTTP to UPSTREAM, save every POST body.

Used once to capture real Claude Code request bodies (OUT_DIR/req-NNN.json) for warm_start.sh to replay.
Streams the upstream response back unchanged. Stop it with Ctrl-C / kill.
"""
import http.client, http.server, os, sys, urllib.parse

port, up, out = int(sys.argv[1]), urllib.parse.urlparse(sys.argv[2]), sys.argv[3]
os.makedirs(out, exist_ok=True)
n = [0]


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _fwd(self, body=None):
        c = http.client.HTTPConnection(up.hostname, up.port, timeout=3600)
        hdr = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "content-length")}
        if body is not None:
            hdr["Content-Length"] = str(len(body))
        c.request(self.command, self.path, body=body, headers=hdr)
        r = c.getresponse()
        self.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                self.send_header(k, v)
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        while chunk := r.read1(65536):
            self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
            self.wfile.flush()
        self.wfile.write(b"0\r\n\r\n")

    def do_GET(self):
        self._fwd()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        n[0] += 1
        with open(os.path.join(out, f"req-{n[0]:03d}{self.path.replace('/', '_').split('?')[0]}.json"), "wb") as f:
            f.write(body)
        self._fwd(body)

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
