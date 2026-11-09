"""Validación de los argumentos que llegan por línea de comandos.

Las rutas de archivos deben quedar dentro de la carpeta del proyecto y el sensor
solo puede enviar lecturas a servidores autorizados en config.json.
"""
import json
import os
from urllib.parse import urlparse

CARPETA = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))
SERVIDORES_BASE = ("127.0.0.1", "localhost")
ESQUEMAS = ("http", "https")
PUERTO_MIN, PUERTO_MAX = 1024, 65535


def ruta_en_proyecto(ruta):
    """Devuelve la ruta absoluta si está dentro del proyecto; si no, detiene el programa.

    Las rutas relativas se interpretan desde la carpeta del proyecto.
    """
    completa = os.path.realpath(os.path.join(CARPETA, ruta))
    if completa != CARPETA and not completa.startswith(CARPETA + os.sep):
        raise SystemExit(f"[ERROR] La ruta {ruta} debe estar dentro de la carpeta del proyecto ({CARPETA}).")
    return completa


def servidores_permitidos():
    """Servidores locales más los listados en 'servidores_permitidos' de config.json."""
    permitidos = set(SERVIDORES_BASE)
    try:
        with open(os.path.join(CARPETA, "config.json"), encoding="utf-8") as f:
            extra = json.load(f).get("servidores_permitidos", [])
    except (OSError, json.JSONDecodeError, AttributeError):
        extra = []
    if isinstance(extra, list):
        permitidos.update(h.lower() for h in extra if isinstance(h, str))
    return permitidos


def url_servidor(url):
    """Devuelve la URL si apunta a un servidor SAT autorizado; si no, detiene el programa."""
    partes = urlparse(url)
    host = (partes.hostname or "").lower()
    if partes.scheme not in ESQUEMAS or host not in servidores_permitidos():
        raise SystemExit(f"[ERROR] Servidor no autorizado: {url}. Agrega su IP a 'servidores_permitidos' "
                         "en config.json.")
    return url


def puerto_valido(puerto):
    """Devuelve el puerto como entero si está entre 1024 y 65535; si no, detiene el programa."""
    puerto = int(puerto)
    if not PUERTO_MIN <= puerto <= PUERTO_MAX:
        raise SystemExit(f"[ERROR] El puerto debe estar entre {PUERTO_MIN} y {PUERTO_MAX}.")
    return puerto
