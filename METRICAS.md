# Métricas de evaluación del SAT-IoT

Estas métricas evalúan el prototipo con **datos simulados**. Miden la lógica de alertas y la entrega por
Telegram; no miden el comportamiento de un sensor instalado en el río.

## Cómo se decide qué es una falsa alarma

El simulador conoce el nivel real antes de añadirle ruido o perder lecturas, y lo guarda en `verdad.csv`.
Al aplicar a ese nivel las mismas reglas del sistema (umbrales e histéresis) se obtienen las **alertas
esperadas**, que se comparan con las **alertas emitidas** por el servidor.

Solo cuentan como alerta las subidas de riesgo: NORMAL → PRECAUCIÓN, NORMAL → CRÍTICA y PRECAUCIÓN → CRÍTICA.
Una alerta emitida y una esperada se emparejan si tienen el mismo estado y están a no más de `--tolerancia`
segundos (10 por defecto).

| Métrica | Definición |
|---|---|
| Correcta | Alerta emitida que se empareja con una esperada |
| Falsa | Alerta emitida sin una esperada que la justifique |
| Perdida | Alerta esperada que no se emitió |
| Precisión | correctas / (correctas + falsas) |
| Sensibilidad | correctas / (correctas + perdidas) |
| Retardo | Hora de la alerta emitida − hora de la esperada; negativo si el ruido la adelantó |
| Cambios de estado | Total de transiciones del sistema; sirve para detectar parpadeo |
| Entrega | Mensajes aceptados por Telegram / intentos |
| Latencia | Tiempo desde que el servidor recibe la lectura hasta que Telegram confirma el mensaje |

Si una métrica no aplica, queda vacía en lugar de mostrarse como 0 % o 100 %. Por ejemplo, no hay precisión
sin alertas emitidas, y la entrega y la latencia solo se miden con `--telegram`. "Enviada" significa que
Telegram aceptó el mensaje, no que una persona lo leyó.

## Escenarios

| Escenario | Qué pone a prueba |
|---|---|
| `creciente` | Creciente gradual hasta 5,6 m |
| `rapida` | Creciente brusca que supera la cota |
| `sin_riesgo` | Nivel estable cerca de 3,2 m; no debe generar alertas |
| `oscilante` | Nivel que cruza 4,6 m una y otra vez; prueba la histéresis |
| `cerca_umbral_ruido_alto` | Nivel real fijo en 4,45 m con sensor ruidoso (0,08 m); toda alerta es falsa |
| `perdida_30` | Creciente brusca perdiendo el 30 % de las lecturas |

## Cómo ejecutarlo

```
py evaluar.py                        (sin mensajes a Telegram)
py evaluar.py --telegram             (envía mensajes reales; avisa a tu grupo)
py -m unittest                       (pruebas de estas métricas)
```

No usa Supabase, así que no mezcla estos datos con los del dashboard. Cada ejecución crea su carpeta en
`resultados/` con los CSV de cada corrida, `resumen.csv` (listo para Excel en Colombia) y `resumen.json`
(incluye los parámetros usados). Con la misma `--semilla` se repiten el ruido y las pérdidas.

## Limitaciones que deben declararse

- Las alertas esperadas usan las mismas reglas del sistema, así que estas métricas miden el efecto del ruido,
  las pérdidas y los fallos de entrega. **No validan si los umbrales son los correctos**: eso requiere
  calibrarlos con datos del IDEAM.
- El ruido del sensor y la tasa de pérdida son supuestos de la simulación, no mediciones de campo.
- La precisión depende de los escenarios elegidos: no es una tasa esperada para un despliegue real.
