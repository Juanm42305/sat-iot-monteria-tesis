import ssl
# Ignorar certificados autofirmados o errores de cadena en entorno local de pruebas
ssl._create_default_https_context = ssl._create_unverified_context
import argparse
import base64
import csv
import hmac
import io
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Cliente de Supabase
try:
    from supabase import create_client, Client
    SUPABASE_INSTALADO = True
except ImportError:
    SUPABASE_INSTALADO = False

CARPETA = os.path.dirname(os.path.abspath(__file__))
DATOS = CARPETA

CONFIG_BASE = {
    "cota_desbordamiento_m": 5.8,
    "umbral_precaucion_m": 4.6,
    "umbral_critico_m": 5.2,
    "histeresis_m": 0.15,
    "api_key": "sat-monteria-demo",
    "prefijo_simulacion": True,
    "telegram_token": "",
    "telegram_chat_id": "",
    "telegram_api_base": "https://api.telegram.org",
    "supabase_url": "",
    "supabase_key": "",
    "archivo_historico": "historico_lecturas.csv",
    "archivo_notificaciones": "notificaciones.csv",
}
CFG = dict(CONFIG_BASE)
supabase_client = None

CAB_HIST = ["timestamp_local", "sector", "nivel_m", "porcentaje_cota", "estado", "tendencia", "bateria_pct"]
CAB_NOTIF = ["timestamp_local", "sector", "nivel_m", "estado", "canal", "resultado", "mensaje"]

LOCK = threading.Lock()
estados = {}
historial = deque(maxlen=600)
notificaciones = deque(maxlen=50)
ultimo = {"datos": None, "recibido": None}
contadores = {"precauciones": 0, "criticas": 0}
_pendientes = {}
_avisados = set()

RE_SECTOR = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


def log(*args):
    try:
        print(*args, flush=True)
    except UnicodeEncodeError:
        print(*(str(a).encode("ascii", "replace").decode() for a in args), flush=True)


def inicializar_supabase():
    global supabase_client
    if SUPABASE_INSTALADO and CFG.get("supabase_url") and CFG.get("supabase_key"):
        try:
            supabase_client = create_client(CFG["supabase_url"], CFG["supabase_key"])
            log("[SUPABASE] Conexión establecida con éxito.")
        except Exception as e:
            log(f"[SUPABASE ERROR] No se pudo conectar: {e}")
    else:
        log("[SUPABASE] No configurado o librería no instalada. Trabajando solo en local.")


def cargar_config(ruta):
    cfg = dict(CONFIG_BASE)
    if ruta and os.path.exists(ruta):
        try:
            with open(ruta, encoding="utf-8") as f:
                cfg.update(json.load(f))
        except (OSError, json.JSONDecodeError) as e:
            raise SystemExit(f"[ERROR] No se pudo leer {ruta}: {e}")
    return cfg


def ruta_datos(clave):
    nombre = CFG[clave]
    return nombre if os.path.isabs(nombre) else os.path.join(DATOS, nombre)


def escribir_fila_csv(ruta, cabecera, fila):
    cola = _pendientes.setdefault(ruta, [])
    cola.append(fila)
    try:
        nuevo = (not os.path.exists(ruta)) or os.path.getsize(ruta) == 0
        with open(ruta, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if nuevo:
                w.writerow(cabecera)
            w.writerows(cola)
        cola.clear()
        _avisados.discard(ruta)
    except OSError as e:
        if ruta not in _avisados:
            _avisados.add(ruta)
            log(f"[AVISO CSV] No se pudo escribir {os.path.basename(ruta)} ({e}).")


def guardar_lectura_supabase(registro):
    if not supabase_client:
        return
    def _insertar():
        try:
            payload = {
                "timestamp_local": registro["t"],
                "sector": registro["sector"],
                "nivel_m": registro["nivel_m"],
                "porcentaje_cota": registro["porcentaje_cota"],
                "estado": registro["estado"],
                "tendencia": registro["tendencia"],
                "bateria_pct": registro["bateria_pct"]
            }
            supabase_client.table("lecturas").insert(payload).execute()
        except Exception as e:
            log(f"[SUPABASE ERROR] Fallo al insertar lectura: {e}")
    threading.Thread(target=_insertar, daemon=True).start()


def guardar_notificacion_supabase(sector, nivel, estado, canal, resultado, mensaje):
    if not supabase_client:
        return
    def _insertar():
        try:
            payload = {
                "timestamp_local": datetime.now().isoformat(timespec="seconds"),
                "sector": sector,
                "nivel_m": nivel,
                "estado": estado,
                "canal": canal,
                "resultado": resultado,
                "mensaje": mensaje
            }
            supabase_client.table("notificaciones").insert(payload).execute()
        except Exception as e:
            log(f"[SUPABASE ERROR] Fallo al insertar notificacion: {e}")
    threading.Thread(target=_insertar, daemon=True).start()


def evaluar_estado(actual, nivel, cfg=None):
    cfg = cfg or CFG
    p, c, h = cfg["umbral_precaucion_m"], cfg["umbral_critico_m"], cfg["histeresis_m"]
    if nivel >= c:
        return "CRITICA"
    if actual == "CRITICA":
        if nivel >= c - h:
            return "CRITICA"
        return "PRECAUCION" if nivel >= p - h else "NORMAL"
    if actual == "PRECAUCION":
        return "PRECAUCION" if nivel >= p - h else "NORMAL"
    return "PRECAUCION" if nivel >= p else "NORMAL"


def calcular_tendencia(sector, nivel):
    previos = [l["nivel_m"] for l in historial if l["sector"] == sector][-5:]
    if len(previos) < 3:
        return "estable"
    d = nivel - sum(previos) / len(previos)
    if d > 0.02:
        return "sube"
    if d < -0.02:
        return "baja"
    return "estable"


def procesar_lectura(sector, nivel_m, bateria_pct=None):
    with LOCK:
        anterior = estados.get(sector, "NORMAL")
        nuevo = evaluar_estado(anterior, nivel_m)
        estados[sector] = nuevo
        tendencia = calcular_tendencia(sector, nivel_m)
        ts = datetime.now().isoformat(timespec="seconds")
        pct = round(nivel_m / CFG["cota_desbordamiento_m"] * 100, 1)
        registro = {"t": ts, "sector": sector, "nivel_m": nivel_m, "porcentaje_cota": pct,
                    "estado": nuevo, "tendencia": tendencia, "bateria_pct": bateria_pct}
        historial.append(registro)
        ultimo["datos"] = registro
        ultimo["recibido"] = time.time()
        
        if nuevo == "CRITICA" and anterior != "CRITICA":
            contadores["criticas"] += 1
        if nuevo == "PRECAUCION" and anterior == "NORMAL":
            contadores["precauciones"] += 1

        escribir_fila_csv(ruta_datos("archivo_historico"), CAB_HIST,
                          [ts, sector, nivel_m, pct, nuevo, tendencia,
                           "" if bateria_pct is None else bateria_pct])
        guardar_lectura_supabase(registro)

    log(f"[{ts[11:]}] {sector} | {nivel_m:.2f} m ({pct:.0f} % cota) | {nuevo} | {tendencia}")
    if nuevo != anterior:
        notificar_cambio(sector, nivel_m, anterior, nuevo)
    return registro


def telegram_configurado():
    return bool(CFG["telegram_token"] and CFG["telegram_chat_id"])


def telegram_enviar(texto):
    cuerpo = json.dumps({"chat_id": CFG["telegram_chat_id"], "text": texto}).encode("utf-8")
    url = f'{CFG["telegram_api_base"].rstrip("/")}/bot{CFG["telegram_token"]}/sendMessage'
    req = urllib.request.Request(url, data=cuerpo, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            datos = json.loads(r.read().decode("utf-8"))
        return datos.get("ok", False), ""
    except Exception as e:
        return False, str(e)


def mensaje_para(sector, nivel, anterior, nuevo):
    pref = "[SIMULACIÓN] " if CFG["prefijo_simulacion"] else ""
    cota = CFG["cota_desbordamiento_m"]
    base = f"Sector {sector} · nivel río Sinú: {nivel:.2f} m ({nivel / cota * 100:.0f} % de cota {cota:.1f} m)."
    if nuevo == "CRITICA":
        return f"{pref}🔴 ALERTA CRÍTICA\n{base}\n¡Peligro de desbordamiento! Prepárese para evacuar."
    if nuevo == "PRECAUCION" and anterior == "NORMAL":
        return f"{pref}🟡 PRECAUCIÓN\n{base}\nEl nivel está subiendo. Permanezca atento."
    if nuevo == "PRECAUCION":
        return f"{pref}🟠 DESCENSO\n{base}\nNivel bajó de crítico a precaución."
    return f"{pref}🟢 NORMALIZADO\n{base}\nNivel retornó a la normalidad."


def registrar_notificacion(sector, nivel, estado, canal, resultado, mensaje):
    ts = datetime.now().isoformat(timespec="seconds")
    with LOCK:
        notificaciones.append({"t": ts, "sector": sector, "nivel_m": nivel, "estado": estado,
                               "canal": canal, "resultado": resultado, "mensaje": mensaje})
        escribir_fila_csv(ruta_datos("archivo_notificaciones"), CAB_NOTIF,
                          [ts, sector, nivel, estado, canal, resultado, mensaje.replace("\n", " | ")])
        guardar_notificacion_supabase(sector, nivel, estado, canal, resultado, mensaje)


def despachar(sector, nivel, estado, mensaje):
    registrar_notificacion(sector, nivel, estado, "DASHBOARD", "registrada", mensaje)
    if telegram_configurado():
        ok, detalle = telegram_enviar(mensaje)
        res_telegram = "enviada" if ok else f"ERROR: {detalle}"
    else:
        res_telegram = "no configurado"
    registrar_notificacion(sector, nivel, estado, "TELEGRAM", res_telegram, mensaje)


def notificar_cambio(sector, nivel, anterior, nuevo):
    mensaje = mensaje_para(sector, nivel, anterior, nuevo)
    threading.Thread(target=despachar, args=(sector, nivel, nuevo, mensaje), daemon=True).start()


def validar_lectura(carga):
    if not isinstance(carga, dict):
        raise ValueError("El cuerpo debe ser JSON.")
    sector = carga.get("sector")
    if not isinstance(sector, str) or not RE_SECTOR.match(sector):
        raise ValueError("'sector' inválido.")
    nivel = carga.get("nivel_m")
    if not isinstance(nivel, (int, float)) or isinstance(nivel, bool):
        raise ValueError("'nivel_m' debe ser un número.")
    bateria = carga.get("bateria_pct")
    return sector, round(float(nivel), 3), bateria


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def _json(self, codigo, obj):
        cuerpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_POST(self):
        ruta = self.path.split("?")[0]
        if ruta == "/api/lectura":
            largo = int(self.headers.get("Content-Length", 0))
            cuerpo = self.rfile.read(largo)
            clave = self.headers.get("X-API-Key", "")
            if not hmac.compare_digest(clave.encode("utf-8"), CFG["api_key"].encode("utf-8")):
                return self._json(401, {"ok": False, "error": "API key inválida."})
            try:
                sector, nivel, bateria = validar_lectura(json.loads(cuerpo.decode("utf-8")))
            except Exception as e:
                return self._json(400, {"ok": False, "error": str(e)})
            
            reg = procesar_lectura(sector, nivel, bateria)
            return self._json(200, {"ok": True, "estado": reg["estado"], "nivel_m": reg["nivel_m"]})


def main():
    global CFG
    CFG = cargar_config("config.json")
    inicializar_supabase()

    servidor = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)
    log("============================================================")
    log(" Servidor SAT-IoT conectado a Supabase en puerto 8000")
    log("============================================================")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        log("\nServidor detenido.")

if __name__ == "__main__":
    main()