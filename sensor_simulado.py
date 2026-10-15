#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 SENSOR SIMULADO - SAT-IoT MONTERÍA
 Simula el nodo sensor (ESP32 + sensor ultrasónico) de la margen izquierda.
============================================================
Se comunica con el servidor SOLO por la API, como lo haría el nodo real:
    POST /api/lectura    {"sector": "sector1", "nivel_m": 4.72, "bateria_pct": 97}
    Encabezado:          X-API-Key: <clave>

Escenarios:
    creciente   El río sube hasta casi la cota y baja (por defecto, 120 s). Pasa por
                PRECAUCIÓN y por ALERTA CRÍTICA.
    rapida      Creciente brusca de 45 s que supera la cota de desbordamiento.
    estable     Nivel normal con pequeñas variaciones (no genera alertas).
    replay      Reproduce un CSV con datos reales (columna nivel_m, nivel o valor).

Uso (Windows):
    py sensor_simulado.py                              creciente de 2 minutos
    py sensor_simulado.py --escenario rapida
    py sensor_simulado.py --repetir                    repite la creciente sin parar
    py sensor_simulado.py --manual                     tú escribes el nivel (como el deslizador de Wokwi)
    py sensor_simulado.py --perdida 0.3                pierde el 30 % de los envíos (falla de conectividad)
    py sensor_simulado.py --escenario replay --archivo datos_ideam.csv

No necesita instalar nada: solo Python 3.8 o superior.
============================================================
"""

import argparse
import csv
import json
import math
import random
import sys
import time
import urllib.error
import urllib.request


def enviar(url, clave, carga, timeout=5):
    req = urllib.request.Request(
        url.rstrip("/") + "/api/lectura",
        data=json.dumps(carga).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-API-Key": clave},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------- PERFILES DE NIVEL (en metros) ----------
def perfil_coseno(base, pico, pasos):
    """Sube de 'base' a 'pico' y vuelve a bajar, con forma suave."""
    for i in range(pasos + 1):
        yield base + (pico - base) * 0.5 * (1 - math.cos(2 * math.pi * i / pasos))


def perfil_estable(base=3.2):
    nivel = base
    while True:
        nivel += random.gauss(0, 0.03) + (base - nivel) * 0.2  # vuelve hacia la base
        yield nivel


def perfil_replay(archivo):
    columnas = ("nivel_m", "nivel", "valor", "level")
    with open(archivo, newline="", encoding="utf-8-sig") as f:
        lector = csv.DictReader(f)
        col = next((c for c in (lector.fieldnames or []) if c.strip().lower() in columnas), None)
        if col is None:
            raise SystemExit(f"[ERROR] {archivo} debe tener una columna llamada 'nivel_m', 'nivel' o 'valor'.")
        n = 0
        for fila in lector:
            try:
                yield float(str(fila[col]).replace(",", "."))
                n += 1
            except ValueError:
                continue
    if n == 0:
        raise SystemExit("[ERROR] No se encontraron valores numéricos en el archivo.")


def generar(args):
    paso = max(args.intervalo, 0.01)
    if args.escenario == "creciente":
        return perfil_coseno(3.0, 5.6, int(args.duracion / paso))
    if args.escenario == "rapida":
        return perfil_coseno(3.2, 5.9, int(min(args.duracion, 45) / paso))
    if args.escenario == "estable":
        return perfil_estable()
    if args.escenario == "replay":
        if not args.archivo:
            raise SystemExit("[ERROR] El escenario replay necesita --archivo datos.csv")
        return perfil_replay(args.archivo)
    raise SystemExit("[ERROR] Escenario desconocido.")


# ---------- ENVÍO ----------
def intentar_envio(args, nivel, bateria):
    carga = {"sector": args.sector, "nivel_m": round(nivel, 2), "bateria_pct": round(bateria, 1)}
    try:
        r = enviar(args.url, args.clave, carga)
        print(f"  enviado {carga['nivel_m']:.2f} m  ->  {r['estado']} ({r['tendencia']})")
        return True
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise SystemExit("[ERROR] El servidor rechazó la API key. Usa --clave con la misma "
                             "que está en config.json (api_key).")
        try:
            motivo = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            motivo = ""
        print(f"  [RECHAZADO] HTTP {e.code} {motivo}")
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        print("  [SIN CONEXIÓN] No se pudo contactar al servidor. ¿Está corriendo sat_servidor.py? Reintentando...")
    return False


def modo_manual(args):
    print("Modo manual: escribe el nivel del río en metros y presiona Enter.")
    print(f"Referencia: precaución ≈ 4.6 m · crítica ≈ 5.2 m · cota de desbordamiento 5.8 m.  (q para salir)\n")
    bateria = 100.0
    while True:
        try:
            texto = input("Nivel (m): ").strip().replace(",", ".")
        except (EOFError, KeyboardInterrupt):
            break
        if texto.lower() in ("q", "salir", "exit"):
            break
        try:
            nivel = float(texto)
        except ValueError:
            print("  Escribe un número, por ejemplo 4.8")
            continue
        intentar_envio(args, nivel, bateria)
        bateria = max(0.0, bateria - 0.1)


def main():
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass
    ap = argparse.ArgumentParser(description="Sensor simulado del SAT-IoT Montería")
    ap.add_argument("--url", default="http://127.0.0.1:8000", help="dirección del servidor")
    ap.add_argument("--clave", default="sat-monteria-demo", help="API key (igual a la de config.json)")
    ap.add_argument("--sector", default="sector1", help="nombre del sector que mide este nodo")
    ap.add_argument("--escenario", choices=["creciente", "rapida", "estable", "replay"], default="creciente")
    ap.add_argument("--duracion", type=float, default=120, help="duración de la creciente en segundos")
    ap.add_argument("--intervalo", type=float, default=2, help="segundos entre lecturas")
    ap.add_argument("--perdida", type=float, default=0.0, help="probabilidad (0 a 1) de perder un envío")
    ap.add_argument("--repetir", action="store_true", help="repite el escenario indefinidamente")
    ap.add_argument("--archivo", help="CSV para el escenario replay")
    ap.add_argument("--manual", action="store_true", help="tú escribes el nivel a mano")
    args = ap.parse_args()

    print("=== SENSOR SIMULADO - SAT-IoT Montería ===")
    print(f"Servidor: {args.url} · sector: {args.sector}")
    if args.manual:
        return modo_manual(args)
    print(f"Escenario: {args.escenario} · una lectura cada {args.intervalo} s · Ctrl + C para detener\n")

    bateria = 100.0
    try:
        while True:
            for nivel in generar(args):
                nivel = max(0.0, nivel + random.gauss(0, 0.015))  # ruido del sensor
                bateria = max(0.0, bateria - 0.05)
                if random.random() < args.perdida:
                    print(f"  nivel {nivel:.2f} m  [envío perdido: simula falla de conectividad]")
                else:
                    intentar_envio(args, nivel, bateria)
                time.sleep(args.intervalo)
            if not args.repetir or args.escenario in ("estable", "replay"):
                break
            print("\n--- Reiniciando escenario ---\n")
    except KeyboardInterrupt:
        pass
    print("\n[OK] Sensor detenido.")


if __name__ == "__main__":
    main()
