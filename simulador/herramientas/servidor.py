# Servidor de desarrollo sin caché: python simulador/herramientas/servidor.py [puerto=8123] [carpeta=raíz del repo]
# http.server a secas deja que el navegador guarde los .js y, tras editar, se seguía viendo la versión vieja.
import functools
import http.server
import os
import sys

class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
carpeta = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..')
http.server.ThreadingHTTPServer(('127.0.0.1', puerto), functools.partial(SinCache, directory=carpeta)).serve_forever()
