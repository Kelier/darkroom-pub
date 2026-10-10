#!/usr/bin/env python3
"""Static server for Darkroom.

Adds cross-origin isolation headers so the on-device ML runtime can use
multi-threaded WebAssembly, plus correct MIME types for .mjs/.wasm/.onnx.
Usage: python3 serve.py [port]
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5180


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm',
        '.onnx': 'application/octet-stream', '.tflite': 'application/octet-stream',
    }

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        big = self.path.split('?')[0].endswith(('.onnx', '.tflite', '.wasm'))
        self.send_header('Cache-Control', 'public, max-age=604800' if big else 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    with Server(('0.0.0.0', PORT), Handler) as httpd:
        print(f'Darkroom serving on http://localhost:{PORT}/', flush=True)
        httpd.serve_forever()
