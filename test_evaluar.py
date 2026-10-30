"""Pruebas de las métricas. Ejecutar con: py -m unittest"""
import os
import re
import unittest

from evaluar import alertas_emitidas, alertas_esperadas, comparar, porcentaje
from sat_servidor import CONFIG_BASE as CFG


class AlertasEsperadas(unittest.TestCase):
    def test_creciente_genera_dos_alertas(self):
        verdad = [(0, 3.0), (1, 4.7), (2, 5.3), (3, 4.7), (4, 3.0)]
        self.assertEqual(alertas_esperadas(verdad, CFG), [(1, "PRECAUCION"), (2, "CRITICA")])

    def test_histeresis_evita_repetir_la_alerta(self):
        verdad = [(0, 4.6), (1, 4.5), (2, 4.6), (3, 4.5), (4, 4.6)]
        self.assertEqual(alertas_esperadas(verdad, CFG), [(0, "PRECAUCION")])

    def test_sin_riesgo_no_genera_alertas(self):
        self.assertEqual(alertas_esperadas([(0, 3.0), (1, 4.59)], CFG), [])


class AlertasEmitidas(unittest.TestCase):
    def test_los_descensos_no_cuentan_como_alerta(self):
        notif = [(1, "PRECAUCION"), (2, "CRITICA"), (3, "PRECAUCION"), (4, "NORMAL")]
        self.assertEqual(alertas_emitidas(notif), [(1, "PRECAUCION"), (2, "CRITICA")])

    def test_ordena_por_tiempo(self):
        self.assertEqual(alertas_emitidas([(2, "CRITICA"), (1, "PRECAUCION")]), [(1, "PRECAUCION"), (2, "CRITICA")])


class Comparar(unittest.TestCase):
    def test_alerta_correcta_mide_su_retardo(self):
        self.assertEqual(comparar([(10, "CRITICA")], [(12, "CRITICA")], 5), ([2], 0, 0))

    def test_alerta_sin_causa_es_falsa(self):
        self.assertEqual(comparar([], [(1, "PRECAUCION")], 5), ([], 1, 0))

    def test_causa_sin_alerta_es_perdida(self):
        self.assertEqual(comparar([(1, "CRITICA")], [], 5), ([], 0, 1))

    def test_fuera_de_tolerancia_cuenta_como_falsa_y_perdida(self):
        self.assertEqual(comparar([(1, "CRITICA")], [(20, "CRITICA")], 5), ([], 1, 1))

    def test_estado_distinto_no_empareja(self):
        self.assertEqual(comparar([(1, "CRITICA")], [(1, "PRECAUCION")], 5), ([], 1, 1))

    def test_una_alerta_no_se_empareja_dos_veces(self):
        esperadas = [(1, "PRECAUCION"), (2, "PRECAUCION")]
        self.assertEqual(comparar(esperadas, [(1, "PRECAUCION")], 5), ([0], 0, 1))


class UmbralesDelDashboard(unittest.TestCase):
    def test_coinciden_con_el_servidor(self):
        ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "src", "configuracion.js")
        with open(ruta, encoding="utf-8") as f:
            js = dict(re.findall(r"export const (\w+) = ([\d.]+)", f.read()))
        self.assertEqual(float(js["COTA_M"]), CFG["cota_desbordamiento_m"])
        self.assertEqual(float(js["PRECAUCION_M"]), CFG["umbral_precaucion_m"])
        self.assertEqual(float(js["CRITICO_M"]), CFG["umbral_critico_m"])


class Porcentaje(unittest.TestCase):
    def test_sin_datos_no_inventa_un_valor(self):
        self.assertIsNone(porcentaje(0, 0))


if __name__ == "__main__":
    unittest.main()
