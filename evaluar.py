"""Evalúa el SAT-IoT con escenarios simulados y calcula sus métricas (ver METRICAS.md).

Cada corrida levanta un servidor propio, sin Supabase, y guarda sus datos en resultados/.
Por defecto no envía nada a Telegram; con --telegram también mide entrega y latencia reales.
"""
import argparse
import csv
import json
import os
import socket
import statistics
import subprocess
import sys
import time
from datetime import datetime

from sat_servidor import cargar_config, evaluar_estado

CARPETA = os.path.dirname(os.path.abspath(__file__))
RANGO = {"NORMAL": 0, "PRECAUCION": 1, "CRITICA": 2}

ESCENARIOS = {
    "creciente": ["--escenario", "creciente", "--duracion", "40"],
    "rapida": ["--escenario", "rapida", "--duracion", "20"],
    "sin_riesgo": ["--escenario", "estable", "--max-lecturas", "60"],
    "oscilante": ["--escenario", "oscilante", "--max-lecturas", "60"],
    "cerca_umbral_ruido_alto": ["--escenario", "cerca_umbral", "--ruido", "0.08", "--max-lecturas", "60"],
    "perdida_30": ["--escenario", "rapida", "--duracion", "20", "--perdida", "0.3"],
}


def alertas_esperadas(verdad, cfg):
    """Aplica las reglas del sistema al nivel real: son las alertas que deberían emitirse."""
    estado, alertas = "NORMAL", []
    for t, nivel in verdad:
        nuevo = evaluar_estado(estado, nivel, cfg)
        if RANGO[nuevo] > RANGO[estado]:
            alertas.append((t, nuevo))
        estado = nuevo
    return alertas


def alertas_emitidas(notificaciones):
    """Toma las notificaciones del sistema y deja las que suben de nivel de riesgo."""
    estado, alertas = "NORMAL", []
    for t, nuevo in sorted(notificaciones):
        if RANGO[nuevo] > RANGO[estado]:
            alertas.append((t, nuevo))
        estado = nuevo
    return alertas


def comparar(esperadas, emitidas, tolerancia_s):
    """Empareja alertas por estado y cercanía en el tiempo. Devuelve (retardos, falsas, perdidas)."""
    libres = list(emitidas)
    retardos, perdidas = [], 0
    for t, estado in esperadas:
        candidatas = [a for a in libres if a[1] == estado and abs(a[0] - t) <= tolerancia_s]
        if candidatas:
            elegida = min(candidatas, key=lambda a: abs(a[0] - t))
            libres.remove(elegida)
            retardos.append(elegida[0] - t)
        else:
            perdidas += 1
    return retardos, len(libres), perdidas


def porcentaje(parte, total):
    return round(parte / total * 100, 1) if total else None


def leer_csv(ruta):
    if not os.path.exists(ruta):
        return []
    with open(ruta, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def medir_corrida(carpeta, cfg, tolerancia_s):
    verdad = leer_csv(os.path.join(carpeta, "verdad.csv"))
    lecturas = leer_csv(os.path.join(carpeta, "historico.csv"))
    notif = leer_csv(os.path.join(carpeta, "notificaciones.csv"))

    tablero = [(datetime.fromisoformat(n["timestamp_local"]).timestamp(), n["estado"])
               for n in notif if n["canal"] == "DASHBOARD"]
    telegram = [n for n in notif if n["canal"] == "TELEGRAM" and n["resultado"] != "no configurado"]

    esperadas = alertas_esperadas([(float(v["t_unix"]), float(v["nivel_real_m"])) for v in verdad], cfg)
    emitidas = alertas_emitidas(tablero)
    retardos, falsas, perdidas = comparar(esperadas, emitidas, tolerancia_s)
    return {
        "lecturas_generadas": len(verdad),
        "lecturas_recibidas": len(lecturas),
        "alertas_esperadas": len(esperadas),
        "alertas_emitidas": len(emitidas),
        "correctas": len(retardos),
        "falsas": falsas,
        "perdidas": perdidas,
        "cambios_de_estado": len(tablero),
        "telegram_intentos": len(telegram),
        "telegram_enviadas": sum(1 for n in telegram if n["resultado"] == "enviada"),
        "retardos_s": retardos,
        "latencias_ms": [int(n["latencia_ms"]) for n in telegram if n["resultado"] == "enviada" and n["latencia_ms"]],
    }


def resumir(corridas):
    def suma(clave):
        return sum(c[clave] for c in corridas)

    correctas, falsas, perdidas = suma("correctas"), suma("falsas"), suma("perdidas")
    retardos = [r for c in corridas for r in c["retardos_s"]]
    latencias = [latencia for c in corridas for latencia in c["latencias_ms"]]
    return {
        "corridas": len(corridas),
        "lecturas_generadas": suma("lecturas_generadas"),
        "lecturas_recibidas": suma("lecturas_recibidas"),
        "alertas_esperadas": suma("alertas_esperadas"),
        "alertas_emitidas": suma("alertas_emitidas"),
        "correctas": correctas,
        "falsas": falsas,
        "perdidas": perdidas,
        "precision_pct": porcentaje(correctas, correctas + falsas),
        "sensibilidad_pct": porcentaje(correctas, correctas + perdidas),
        "cambios_de_estado": suma("cambios_de_estado"),
        "retardo_medio_s": round(statistics.mean(retardos), 2) if retardos else None,
        "retardo_max_s": round(max(retardos), 2) if retardos else None,
        "entrega_telegram_pct": porcentaje(suma("telegram_enviadas"), suma("telegram_intentos")),
        "latencia_mediana_ms": round(statistics.median(latencias)) if latencias else None,
        "latencia_max_ms": max(latencias) if latencias else None,
    }


def correr(escenario, carpeta, cfg, semilla, intervalo, puerto, telegram):
    os.makedirs(carpeta)
    clave = "clave-evaluacion"
    temporal = dict(cfg, api_key=clave, supabase_url="", supabase_key="",
                    archivo_historico=os.path.join(carpeta, "historico.csv"),
                    archivo_notificaciones=os.path.join(carpeta, "notificaciones.csv"))
    if not telegram:
        temporal.update(telegram_token="", telegram_chat_id="")
    ruta_cfg = os.path.join(carpeta, "config_temporal.json")
    with open(ruta_cfg, "w", encoding="utf-8") as f:
        json.dump(temporal, f)

    entorno = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
    servidor = subprocess.Popen(
        [sys.executable, os.path.join(CARPETA, "sat_servidor.py"), "--config", ruta_cfg, "--puerto", str(puerto)],
        env=entorno, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", puerto)) == 0:
                    break
            time.sleep(0.2)
        else:
            raise SystemExit("[ERROR] El servidor no arrancó.")
        subprocess.run(
            [sys.executable, os.path.join(CARPETA, "sensor_simulado.py"), *ESCENARIOS[escenario],
             "--url", f"http://127.0.0.1:{puerto}", "--clave", clave, "--sector", escenario,
             "--intervalo", str(intervalo), "--semilla", str(semilla), "--verdad", os.path.join(carpeta, "verdad.csv")],
            env=entorno, stdout=subprocess.DEVNULL, check=True, timeout=600)
        time.sleep(3)  # deja terminar las notificaciones en curso
    finally:
        servidor.terminate()
        servidor.wait(5)
        os.remove(ruta_cfg)


def escribir_excel(ruta, filas):
    """CSV que Excel en Colombia abre bien: separador ';' y coma decimal."""
    with open(ruta, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(filas[0].keys())
        for fila in filas:
            w.writerow([celda_excel(v) for v in fila.values()])


def celda_excel(valor):
    if valor is None:
        return ""
    if isinstance(valor, float):
        return str(valor).replace(".", ",")
    return valor


def main():
    ap = argparse.ArgumentParser(description="Evaluación del SAT-IoT con escenarios simulados")
    ap.add_argument("--escenarios", nargs="+", choices=list(ESCENARIOS), default=list(ESCENARIOS))
    ap.add_argument("--repeticiones", type=int, default=3)
    ap.add_argument("--intervalo", type=float, default=0.5, help="segundos entre lecturas")
    ap.add_argument("--tolerancia", type=float, default=10, help="segundos para emparejar una alerta con su causa")
    ap.add_argument("--semilla", type=int, default=2026)
    ap.add_argument("--puerto", type=int, default=8765)
    ap.add_argument("--config", default=os.path.join(CARPETA, "config.json"))
    ap.add_argument("--telegram", action="store_true", help="envía mensajes reales a Telegram")
    ap.add_argument("--salida", default=os.path.join(CARPETA, "resultados", datetime.now().strftime("%Y%m%d_%H%M%S")))
    args = ap.parse_args()

    cfg = cargar_config(args.config)
    if args.telegram and not (cfg["telegram_token"] and cfg["telegram_chat_id"]):
        raise SystemExit("[ERROR] --telegram necesita telegram_token y telegram_chat_id en la configuración.")

    resumen, todas = [], []
    for i, escenario in enumerate(args.escenarios):
        corridas = []
        for rep in range(args.repeticiones):
            carpeta = os.path.join(args.salida, escenario, f"corrida_{rep + 1}")
            print(f"{escenario} · corrida {rep + 1} de {args.repeticiones}", flush=True)
            correr(escenario, carpeta, cfg, args.semilla + i * 100 + rep, args.intervalo, args.puerto, args.telegram)
            corridas.append(medir_corrida(carpeta, cfg, args.tolerancia))
        todas += corridas
        resumen.append({"escenario": escenario, **resumir(corridas)})
    resumen.append({"escenario": "TOTAL", **resumir(todas)})

    with open(os.path.join(args.salida, "resumen.json"), "w", encoding="utf-8") as f:
        json.dump({"parametros": {"intervalo_s": args.intervalo, "tolerancia_s": args.tolerancia,
                                  "semilla": args.semilla, "telegram": args.telegram,
                                  "umbral_precaucion_m": cfg["umbral_precaucion_m"],
                                  "umbral_critico_m": cfg["umbral_critico_m"], "histeresis_m": cfg["histeresis_m"]},
                   "resumen": resumen}, f, ensure_ascii=False, indent=2)
    escribir_excel(os.path.join(args.salida, "resumen.csv"), resumen)

    print(f"\nResultados en {args.salida}\n")
    for r in resumen:
        print(f'{r["escenario"]:<26} esperadas {r["alertas_esperadas"]:>3} · emitidas {r["alertas_emitidas"]:>3} · '
              f'falsas {r["falsas"]:>3} · perdidas {r["perdidas"]:>3} · retardo medio {r["retardo_medio_s"]} s')


if __name__ == "__main__":
    main()
