import argparse
import contextlib
import csv
import itertools
import json
import math
import os
import random
import sys
import time
import requests

from validacion import ruta_en_proyecto, url_servidor


def clave_por_defecto():
    """Toma la API key de config.json, el mismo archivo que usa el servidor."""
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
    try:
        with open(ruta, encoding="utf-8") as f:
            return json.load(f).get("api_key", "")
    except (OSError, json.JSONDecodeError):
        return ""


class ErrorServidor(Exception):
    """El servidor SAT respondió con un código distinto de 200."""


def enviar(url, clave, carga, timeout=5):
    endpoint = url_servidor(url).rstrip("/") + "/api/lectura"
    response = requests.post(endpoint, json=carga, headers={"X-API-Key": clave}, timeout=timeout)
    if response.status_code == 200:
        return response.json()
    raise ErrorServidor(f"HTTP {response.status_code}: {response.text}")


# ---------- PERFILES DE NIVEL (en metros) ----------
def perfil_coseno(base, pico, pasos):
    """Sube de 'base' a 'pico' y vuelve a bajar, con forma suave."""
    for i in range(pasos + 1):
        yield base + (pico - base) * 0.5 * (1 - math.cos(2 * math.pi * i / pasos))


def perfil_estable(base=3.2):
    nivel = base
    while True:
        nivel += random.gauss(0, 0.03) + (base - nivel) * 0.2  # NOSONAR: simulación, no criptografía
        yield nivel


def perfil_oscilante(centro=4.6, amplitud=0.05, pasos=20):
    """Nivel que cruza una y otra vez el umbral de precaución: pone a prueba la histéresis."""
    for i in itertools.count():
        yield centro + amplitud * math.sin(2 * math.pi * i / pasos)


def perfil_constante(nivel):
    while True:
        yield nivel


def perfil_replay(archivo):
    columnas = ("nivel_m", "nivel", "valor", "level")
    with open(ruta_en_proyecto(archivo), newline="", encoding="utf-8-sig") as f:
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
    if args.escenario == "oscilante":
        return perfil_oscilante()
    if args.escenario == "cerca_umbral":
        return perfil_constante(4.45)
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
        print(f"  enviado {carga['nivel_m']:.2f} m  ->  {r.get('estado', 'OK')} ({r.get('tendencia', 'Estable')})")
        return True
    except (requests.RequestException, ErrorServidor, ValueError) as e:
        print(f"  [ERROR DE ENVÍO]: {e}")
        return False


def modo_manual(args):
    print("Modo manual: escribe el nivel del río en metros y presiona Enter.")
    print("Referencia: precaución ≈ 4.6 m · crítica ≈ 5.2 m · cota de desbordamiento 5.8 m.  (q para salir)\n")
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


def simular(args, verdad, archivo_verdad):
    bateria = 100.0
    while True:
        for nivel_real in itertools.islice(generar(args), args.max_lecturas):
            t = time.time()
            nivel = max(0.0, nivel_real + random.gauss(0, args.ruido))  # NOSONAR: ruido simulado del sensor
            bateria = max(0.0, bateria - 0.05)
            enviada = False
            # uniform(0, 1) da el mismo valor que random(): conserva la secuencia de cada semilla
            if random.uniform(0, 1) < args.perdida:  # simulación de pérdida, no criptografía
                print(f"  nivel {nivel:.2f} m  [envío perdido: simula falla de conectividad]")
            else:
                enviada = intentar_envio(args, nivel, bateria)
            if verdad:
                verdad.writerow([f"{t:.3f}", args.sector, round(nivel_real, 3), round(nivel, 2), int(enviada)])
                archivo_verdad.flush()
            time.sleep(args.intervalo)
        if not args.repetir or args.escenario in ("estable", "replay"):
            return
        print("\n--- Reiniciando escenario ---\n")


def main():
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass

    ap = argparse.ArgumentParser(description="Sensor simulado del SAT-IoT Montería")
    ap.add_argument("--url", default="http://127.0.0.1:8000", help="dirección del servidor SAT")
    ap.add_argument("--clave", default=clave_por_defecto(), help="API key del servidor (por defecto, la de config.json)")
    ap.add_argument("--sector", default="sector1", help="nombre del sector que mide este nodo")
    ap.add_argument("--escenario", choices=["creciente", "rapida", "estable", "oscilante", "cerca_umbral", "replay"], default="creciente")
    ap.add_argument("--duracion", type=float, default=120, help="duración de la creciente en segundos")
    ap.add_argument("--intervalo", type=float, default=2, help="segundos entre lecturas")
    ap.add_argument("--perdida", type=float, default=0.0, help="probabilidad (0 a 1) de perder un envío")
    ap.add_argument("--repetir", action="store_true", help="repite el escenario indefinidamente")
    ap.add_argument("--archivo", help="CSV para el escenario replay")
    ap.add_argument("--manual", action="store_true", help="tú escribes el nivel a mano")
    ap.add_argument("--ruido", type=float, default=0.015, help="desviación del ruido del sensor en metros")
    ap.add_argument("--semilla", type=int, help="semilla aleatoria, para repetir exactamente una prueba")
    ap.add_argument("--max-lecturas", type=int, help="detiene el escenario tras este número de lecturas")
    ap.add_argument("--verdad", help="CSV donde guardar el nivel real, antes de ruido y pérdidas")
    args = ap.parse_args()
    url_servidor(args.url)
    if not args.clave:
        raise SystemExit("[ERROR] Falta la API key: copia config.example.json como config.json o usa --clave.")

    print("=== SENSOR SIMULADO - SAT-IoT Montería ===")
    print(f"Servidor: {args.url} · sector: {args.sector}")
    if args.manual:
        modo_manual(args)
        return
    print(f"Escenario: {args.escenario} · una lectura cada {args.intervalo} s · Ctrl + C para detener\n")

    if args.semilla is not None:
        random.seed(args.semilla)  # NOSONAR: simulación reproducible, no criptografía
    with contextlib.ExitStack() as pila:
        verdad, archivo_verdad = None, None
        if args.verdad:
            archivo_verdad = pila.enter_context(open(ruta_en_proyecto(args.verdad), "w", newline="", encoding="utf-8"))
            verdad = csv.writer(archivo_verdad)
            verdad.writerow(["t_unix", "sector", "nivel_real_m", "nivel_medido_m", "enviada"])
        try:
            simular(args, verdad, archivo_verdad)
        except KeyboardInterrupt:
            pass
    print("\n[OK] Sensor detenido.")


if __name__ == "__main__":
    main()