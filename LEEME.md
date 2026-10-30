# Prototipo SAT-IoT Montería (simulación completa)

Corre entero en tu computador, **sin internet y sin instalar nada** (solo Python, que ya tienes).
Internet solo se usa si activas las notificaciones por Telegram.

## Qué hace

```
 sensor_simulado.py  --POST /api/lectura-->  sat_servidor.py  --->  Dashboard (http://localhost:8000)
 (nodo sensor)          (API + X-API-Key)    decide el estado  --->  historico_lecturas.csv
                                              (3 niveles)      --->  notificaciones.csv
                                                               --->  Telegram (precaución y crítica)
```

| Estado | Cuándo | Qué pasa |
|---|---|---|
| NORMAL | nivel < 4,6 m | nada |
| PRECAUCIÓN | desde 4,6 m (80 % de la cota) | aviso informativo |
| ALERTA CRÍTICA | desde 5,2 m (90 % de la cota) | alarma crítica |

La cota de desbordamiento (5,8 m) viene de la Alcaldía de Montería. **Los umbrales de 80 % y 90 % son
de diseño**: se pueden cambiar en `config.json` y deben calibrarse con datos del IDEAM.
La histéresis (0,15 m) evita que la alerta parpadee cuando el nivel oscila cerca de un umbral.

## Cómo correrlo

**Forma fácil:** doble clic en `iniciar_demo.bat`. Abre el servidor, el sensor y el navegador.

**Forma manual** (dos terminales en VS Code):

```
py sat_servidor.py
py sensor_simulado.py
```

Abre http://localhost:8000. Para detener cada programa: `Ctrl + C`.

Opciones útiles del sensor:

| Comando | Qué hace |
|---|---|
| `py sensor_simulado.py --repetir` | repite la creciente sin parar (ideal para la sustentación) |
| `py sensor_simulado.py --escenario rapida` | creciente brusca que supera la cota |
| `py sensor_simulado.py --manual` | tú escribes el nivel (como el deslizador de Wokwi) |
| `py sensor_simulado.py --perdida 0.3` | pierde el 30 % de los envíos: simula una falla de conectividad |
| `py sensor_simulado.py --escenario replay --archivo datos.csv` | reproduce datos reales (columna `nivel_m`, `nivel` o `valor`) |

Si `py` no funciona, prueba con `python`. Si el puerto 8000 está ocupado: `py sat_servidor.py --puerto 8080`.

## Configurar Telegram (opcional, 5 minutos)

1. En Telegram busca **@BotFather** y escríbele `/newbot`. Elige un nombre y un usuario que termine en `bot`.
   Te entrega un **token** (algo como `123456:ABC-DEF...`).
2. Si no existe `config.json`, copia `config.example.json` con ese nombre (Git lo ignora para proteger las
   credenciales). Ábrelo con el Bloc de notas y pega el token entre las comillas de `telegram_token`.
3. En Telegram busca tu bot nuevo y escríbele `hola`.
4. En la terminal: `py sat_servidor.py --descubrir-chat`. Muestra un número: tu `chat_id`.
5. Pégalo en `telegram_chat_id` de `config.json` y guarda.
6. Arranca el servidor y pulsa **Enviar notificación de prueba** en el dashboard. Debe llegarte el mensaje.

**El token es como una contraseña.** No lo subas a GitHub, no lo pegues en el documento de la tesis ni en capturas.

Todos los mensajes llevan el prefijo **[SIMULACIÓN]** (`prefijo_simulacion` en `config.json`) para que nadie
los confunda con una alerta real. Si usas un grupo de Telegram con otras personas, avísales.

## Archivos que genera

| Archivo | Contenido |
|---|---|
| `historico_lecturas.csv` | cada lectura: fecha, sector, nivel, % de la cota, estado, tendencia, batería |
| `notificaciones.csv` | bitácora: cada aviso, canal, resultado (enviada / error) y mensaje |

Para Excel en Colombia usa el botón **Descargar CSV para Excel** del dashboard: ya viene con `;` como
separador y coma decimal. Si abres directamente el CSV estándar y sale todo en una columna, usa
*Datos → Texto en columnas*. Si el servidor avisa que no puede escribir el CSV, es porque está abierto
en Excel: ciérralo y no se pierde ninguna lectura (se guardan en memoria y se escriben después).

## Métricas de evaluación

Para medir falsas alarmas, alertas perdidas, retardo y entrega usa `py evaluar.py`.
Las definiciones y el procedimiento están en `METRICAS.md`.

## La API del sensor (para el documento)

| Método y ruta | Uso | Respuestas |
|---|---|---|
| `POST /api/lectura` | el sensor envía `{"sector","nivel_m","bateria_pct"}` con el encabezado `X-API-Key` | 200 ok · 400 datos inválidos · 401 clave incorrecta · 413 cuerpo muy grande |
| `GET /api/estado` | estado actual y últimas lecturas (lo usa el dashboard) | 200 |
| `GET /api/historico.csv` | descarga el histórico | 200 |
| `GET /api/historico_excel.csv` | histórico listo para Excel (Colombia) | 200 |
| `POST /api/notificacion-prueba` | envía un mensaje de prueba (solo desde este computador) | 200 |

## Dónde va cada cosa en la tesis

- **Análisis e interpretación → diseño del prototipo:** el esquema de arquitectura, la tabla de la API,
  los tres estados con sus umbrales y la gráfica del dashboard.
- **Resultados de la prueba:** una captura del dashboard en cada estado (normal, precaución, crítica),
  el mensaje recibido en Telegram y la gráfica de nivel contra tiempo hecha con el CSV.
- **Anexos:** `sat_servidor.py`, `sensor_simulado.py`, `config.json` (sin el token), `historico_lecturas.csv`
  y `notificaciones.csv`.
- **Discusión (limitaciones):** todo es una simulación; no se probó con sensores en el río.

## Lo que este prototipo NO hace (decláralo en la tesis)

- **No hay sensor físico:** el nivel lo genera `sensor_simulado.py`. El firmware del ESP32 que probaste
  en Wokwi sigue siendo válido como evidencia del nodo, pero Wokwi no se conecta a este servidor
  (corre en la nube y no alcanza tu computador).
- **SMS y llamadas no están implementados.** Requieren un proveedor de pago (por ejemplo Twilio) y
  pruebas con números reales. La estructura permite agregarlos como un canal más; en el documento
  preséntalos como parte del diseño de producción.
- **No usa MQTT.** El diseño de la tesis contempla MQTT; este prototipo usa una API HTTP por simplicidad
  y porque funciona sin internet. Wokwi + `decision_engine.py` sigue siendo la versión MQTT.
- **El dashboard es local** (solo se ve en este computador) y no tiene usuarios ni contraseña.
- **Los umbrales no están calibrados con datos reales.**
