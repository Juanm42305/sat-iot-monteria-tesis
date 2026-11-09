import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { COTA_M, CRITICO_M, MAX_FILAS, PRECAUCION_M, PUNTOS_GRAFICA, SIN_DATOS_TRAS_MS } from './configuracion';
import { estadoVigente, exportarCSV, fechaHoraColombia, fusionarPorId, horaColombia, tiempoTranscurrido } from './datos';

const ETIQUETA_ESTADO = { CRITICA: 'CRÍTICA', PRECAUCION: 'PRECAUCIÓN', NORMAL: 'NORMAL', SIN_DATOS: 'SIN DATOS' };

const TARJETA_ESTADO = {
  CRITICA: 'border-red-500/50 bg-red-950/20',
  PRECAUCION: 'border-amber-500/50 bg-amber-950/20',
  NORMAL: 'border-slate-800',
  SIN_DATOS: 'border-slate-600',
};

const INSIGNIA_ESTADO = {
  CRITICA: 'bg-red-500 text-white animate-pulse',
  PRECAUCION: 'bg-amber-500 text-slate-950',
  NORMAL: 'bg-emerald-500 text-slate-950',
  SIN_DATOS: 'bg-slate-600 text-white',
};

const FILA_ESTADO = {
  CRITICA: 'bg-red-900/60 text-red-300 border border-red-700',
  PRECAUCION: 'bg-amber-900/60 text-amber-300 border border-amber-700',
  NORMAL: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700',
};

const CONEXION = {
  SUBSCRIBED: { texto: 'Tiempo real activo', clase: 'bg-emerald-500/20 text-emerald-400', punto: 'bg-emerald-400 animate-ping' },
  CONECTANDO: { texto: 'Conectando...', clase: 'bg-amber-500/20 text-amber-400', punto: 'bg-amber-400' },
  FALLO: { texto: 'Tiempo real sin conexión', clase: 'bg-red-500/20 text-red-400', punto: 'bg-red-400' },
};

const conexionVisible = (estado) => CONEXION[estado] ?? CONEXION.FALLO;

function colorResultado(resultado) {
  if (resultado === 'enviada' || resultado === 'registrada') return 'text-emerald-400';
  if (resultado?.startsWith('ERROR')) return 'text-red-400';
  return 'text-amber-400';
}

function colorBateria(bateria) {
  if (bateria === null || bateria === undefined) return 'text-slate-400';
  if (bateria < 20) return 'text-red-400';
  if (bateria < 40) return 'text-amber-400';
  return 'text-emerald-400';
}

const COLUMNAS_NOTIFICACIONES = [
  ['Fecha y hora (Colombia)', (n) => fechaHoraColombia(n.created_at)],
  ['Sector', (n) => n.sector],
  ['Nivel (m)', (n) => n.nivel_m],
  ['Estado', (n) => n.estado],
  ['Canal', (n) => n.canal],
  ['Resultado', (n) => n.resultado],
  ['Mensaje', (n) => n.mensaje],
];

const COLUMNAS_LECTURAS = [
  ['Fecha y hora (Colombia)', (l) => fechaHoraColombia(l.created_at)],
  ['Sector', (l) => l.sector],
  ['Nivel (m)', (l) => l.nivel_m],
  ['Porcentaje de cota (%)', (l) => l.porcentaje_cota],
  ['Batería (%)', (l) => l.bateria_pct],
  ['Estado', (l) => l.estado],
  ['Tendencia', (l) => l.tendencia],
];

function textoEstado(estado, ultima) {
  if (estado !== 'SIN_DATOS') return `Tendencia: ${ultima.tendencia ?? 'sin dato'}`;
  if (!ultima) return 'Aún no se han recibido lecturas';
  const anterior = ETIQUETA_ESTADO[ultima.estado] ?? ultima.estado;
  return `El sensor no reporta hace más de ${SIN_DATOS_TRAS_MS / 1000} s. Último estado: ${anterior}`;
}

function FilaVacia({ columnas, children }) {
  return (
    <tr>
      <td colSpan={columnas} className="text-center py-6 text-slate-500">{children}</td>
    </tr>
  );
}

function FilasNotificaciones({ notificaciones, loading }) {
  if (notificaciones.length === 0) {
    return (
      <FilaVacia columnas={5}>
        {loading ? 'Cargando bitácora...' : 'No hay notificaciones registradas todavía.'}
      </FilaVacia>
    );
  }
  return notificaciones.map((item) => (
    <tr key={item.id} className="hover:bg-slate-800/40 transition">
      <td className="py-3 px-3 text-slate-300 font-mono">{horaColombia(item.created_at)}</td>
      <td className="py-3 px-3">
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${FILA_ESTADO[item.estado] ?? ''}`}>
          {ETIQUETA_ESTADO[item.estado] ?? item.estado}
        </span>
      </td>
      <td className="py-3 px-3 text-slate-300">{item.canal}</td>
      <td className={`py-3 px-3 font-medium ${colorResultado(item.resultado)}`}>{item.resultado}</td>
      <td className="py-3 px-3 text-slate-300 text-xs max-w-md truncate" title={item.mensaje}>{item.mensaje}</td>
    </tr>
  ));
}

function FilasLecturas({ lecturas, loading }) {
  if (lecturas.length === 0) {
    return <FilaVacia columnas={6}>{loading ? 'Cargando lecturas...' : 'Sin lecturas registradas.'}</FilaVacia>;
  }
  return lecturas.map((item) => (
    <tr key={item.id} className="hover:bg-slate-800/40 transition">
      <td className="py-3 px-3 text-slate-300">{item.sector}</td>
      <td className="py-3 px-3 font-bold text-amber-400 font-mono">{item.nivel_m} m</td>
      <td className="py-3 px-3 text-slate-300 font-mono">{item.porcentaje_cota ?? '--'}%</td>
      <td className="py-3 px-3 text-slate-300 font-mono">{item.bateria_pct ?? '--'}%</td>
      <td className="py-3 px-3 font-medium text-cyan-400">{ETIQUETA_ESTADO[item.estado] ?? item.estado}</td>
      <td className="py-3 px-3 text-slate-400 text-xs font-mono">{fechaHoraColombia(item.created_at)}</td>
    </tr>
  ));
}

export default function App() {
  const [notificaciones, setNotificaciones] = useState([]);
  const [lecturas, setLecturas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [errorExportar, setErrorExportar] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [conexion, setConexion] = useState('CONECTANDO');
  const [sectorElegido, setSectorElegido] = useState(null);
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    const fetchData = async () => {
      const [notif, lect] = await Promise.all([
        supabase.from('notificaciones').select('*').order('created_at', { ascending: false }).limit(MAX_FILAS),
        supabase.from('lecturas').select('*').order('created_at', { ascending: false }).limit(MAX_FILAS),
      ]);
      const error = notif.error || lect.error;
      setErrorCarga(error ? error.message : null);
      if (notif.data) setNotificaciones((prev) => fusionarPorId(notif.data, prev, MAX_FILAS));
      if (lect.data) setLecturas((prev) => fusionarPorId(lect.data, prev, MAX_FILAS));
      setLoading(false);
    };

    fetchData().catch((e) => {
      setErrorCarga(e.message);
      setLoading(false);
    });

    // React monta dos veces en desarrollo: cada montaje usa su propio canal e ignora los eventos del anterior
    let activo = true;
    const channel = supabase.channel(`panel-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, (payload) => {
        setNotificaciones((prev) => fusionarPorId([payload.new], prev, MAX_FILAS));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lecturas' }, (payload) => {
        setLecturas((prev) => fusionarPorId([payload.new], prev, MAX_FILAS));
      })
      .subscribe((estado) => {
        if (!activo) return;
        setConexion(estado);
        // Al reconectar recupera lo que llegó mientras no había conexión
        if (estado === 'SUBSCRIBED') fetchData().catch((e) => setErrorCarga(e.message));
      });

    const reloj = setInterval(() => setAhora(Date.now()), 5000);

    return () => {
      activo = false;
      clearInterval(reloj);
      void supabase.removeChannel(channel);
    };
  }, []);

  const exportar = async (tabla, columnas, nombre) => {
    setExportando(true);
    setErrorExportar(null);
    try {
      await exportarCSV(supabase, tabla, columnas, nombre);
    } catch (e) {
      setErrorExportar(e.message);
    } finally {
      setExportando(false);
    }
  };

  const sectores = [...new Set(lecturas.map((l) => l.sector))];
  const sector = sectorElegido ?? lecturas[0]?.sector ?? null;
  const lecturasSector = lecturas.filter((l) => l.sector === sector);
  const notificacionesSector = sector ? notificaciones.filter((n) => n.sector === sector) : notificaciones;

  const ultima = lecturasSector[0];
  const estado = estadoVigente(ultima, ahora);
  const conexionActual = conexionVisible(conexion);

  // Solo se dibujan como vigentes los valores de una lectura reciente
  const vigente = estado !== 'SIN_DATOS';
  const porcentaje = ultima?.porcentaje_cota;
  const bateria = ultima?.bateria_pct;
  const sinBateria = bateria === null || bateria === undefined;
  const claseBateria = vigente ? colorBateria(bateria) : 'text-slate-500';
  const claseCota = vigente ? 'text-cyan-400' : 'text-slate-500';

  const chartData = lecturasSector.slice(0, PUNTOS_GRAFICA).reverse().map((l) => ({
    hora: horaColombia(l.created_at),
    nivel: l.nivel_m,
  }));

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6 font-sans">
      {/* Cabecera del Dashboard */}
      <header className="max-w-6xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center border-b border-slate-800 pb-4 gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-cyan-400">SAT-IoT · Río Sinú</h1>
            <span className="bg-cyan-500/10 text-cyan-400 text-xs px-2.5 py-0.5 rounded-full border border-cyan-500/20 font-mono">
              Montería, Córdoba
            </span>
            <span className="bg-amber-500/10 text-amber-400 text-xs px-2.5 py-0.5 rounded-full border border-amber-500/20 font-medium">
              Datos simulados
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">Sistema de Alerta Temprana frente a Inundaciones</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            disabled={exportando}
            onClick={() => exportar('notificaciones', COLUMNAS_NOTIFICACIONES, 'bitacora_notificaciones')}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2 cursor-pointer"
          >
            📥 Exportar Bitácora CSV
          </button>
          <button
            disabled={exportando}
            onClick={() => exportar('lecturas', COLUMNAS_LECTURAS, 'historico_lecturas_satiot')}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2 cursor-pointer"
          >
            📊 Exportar Lecturas CSV
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-6">

        {(errorCarga || errorExportar) && (
          <div role="alert" className="bg-red-950/40 border border-red-500/50 text-red-300 text-sm rounded-lg p-3">
            {errorCarga && <p><strong>No se pudieron cargar los datos:</strong> {errorCarga}</p>}
            {errorExportar && <p><strong>No se pudo exportar:</strong> {errorExportar}</p>}
          </div>
        )}

        {sectores.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <span>Sector:</span>
            <select
              value={sector ?? ''}
              onChange={(e) => setSectorElegido(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-white"
            >
              {sectores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}

        {/* TARJETAS DE MONITOREO EN TIEMPO REAL (KPIs) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg relative overflow-hidden">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Nivel del Río</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className={`text-3xl font-extrabold font-mono ${vigente ? 'text-white' : 'text-slate-500'}`}>{ultima?.nivel_m ?? '--'}</span>
              <span className="text-slate-400 text-sm">metros</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {ultima ? `Estación: ${ultima.sector} · hace ${tiempoTranscurrido(ultima.created_at, ahora)}` : 'Sin lecturas registradas'}
            </p>
          </div>

          <div className={`bg-slate-900 border p-5 rounded-xl shadow-lg ${TARJETA_ESTADO[estado] ?? TARJETA_ESTADO.SIN_DATOS}`}>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Estado de Alerta</p>
            <div className="mt-2">
              <span className={`px-3 py-1 rounded-md text-sm font-bold inline-block ${INSIGNIA_ESTADO[estado] ?? INSIGNIA_ESTADO.SIN_DATOS}`}>
                {ETIQUETA_ESTADO[estado] ?? estado}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {textoEstado(estado, ultima)}
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Porcentaje de la Cota</p>
            <div className="flex items-baseline gap-1 mt-2">
              <span className={`text-3xl font-extrabold font-mono ${claseCota}`}>{porcentaje ?? '--'}</span>
              <span className={`text-lg ${claseCota}`}>%</span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${vigente ? 'bg-cyan-500' : 'bg-slate-600'}`}
                style={{ width: `${Math.min(porcentaje ?? 0, 100)}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Batería del Nodo</p>
            <div className="flex items-baseline gap-1 mt-2">
              <span className={`text-3xl font-extrabold font-mono ${claseBateria}`}>{bateria ?? '--'}</span>
              <span className={`text-lg ${claseBateria}`}>%</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {sinBateria ? 'Sin dato de batería' : 'Reportada por el nodo'}
            </p>
          </div>

        </div>

        {/* GRÁFICA EN TIEMPO REAL CON UMBRALES DE ALERTA */}
        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-200">MONITOREO GRÁFICO - NIVEL DEL RÍO SINÚ</h3>
              <p className="text-xs text-slate-400">Últimas {PUNTOS_GRAFICA} lecturas del sector, con los umbrales del sistema</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-amber-400 font-medium">🟨 Precaución ({PRECAUCION_M} m)</span>
              <span className="flex items-center gap-1 text-red-400 font-medium">🟥 Crítica ({CRITICO_M} m)</span>
              <span className="flex items-center gap-1 text-slate-300 font-medium">⬜ Cota ({COTA_M} m)</span>
            </div>
          </div>

          <div className="h-72 w-full pt-4">
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500">
                {loading ? 'Cargando lecturas...' : 'Sin lecturas para graficar'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="hora" stroke="#94a3b8" tick={{ fontSize: 12 }} minTickGap={40} />
                  {/* El eje siempre incluye los umbrales, aunque el nivel esté lejos de ellos */}
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fontSize: 12 }}
                    unit="m"
                    domain={[(min) => Math.floor(Math.min(min, PRECAUCION_M) - 0.5), (max) => Math.ceil(Math.max(max, COTA_M) + 0.2)]}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', color: '#fff' }}
                  />
                  <ReferenceLine
                    y={PRECAUCION_M}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    label={{ value: `Umbral Precaución (${PRECAUCION_M} m)`, fill: '#f59e0b', fontSize: 11, position: 'insideBottomLeft' }}
                  />
                  <ReferenceLine
                    y={CRITICO_M}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    label={{ value: `Umbral Crítico (${CRITICO_M} m)`, fill: '#ef4444', fontSize: 11, position: 'insideBottomLeft' }}
                  />
                  <ReferenceLine
                    y={COTA_M}
                    stroke="#cbd5e1"
                    label={{ value: `Cota de desbordamiento (${COTA_M} m)`, fill: '#cbd5e1', fontSize: 11, position: 'insideBottomLeft' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="nivel"
                    name="Nivel (m)"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* 1. SECCIÓN: BITÁCORA DE NOTIFICACIONES */}
        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
            <h3 className="text-lg font-semibold text-slate-200">BITÁCORA DE NOTIFICACIONES AUTOMÁTICAS</h3>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 ${conexionActual.clase}`}>
              <span className={`w-2 h-2 rounded-full ${conexionActual.punto}`}></span> {conexionActual.texto}
            </span>
          </div>
          <div className="max-h-[380px] overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="py-3 px-3">Hora Colombia</th>
                  <th className="py-3 px-3">Estado</th>
                  <th className="py-3 px-3">Canal</th>
                  <th className="py-3 px-3">Resultado</th>
                  <th className="py-3 px-3">Mensaje Transmitido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                <FilasNotificaciones notificaciones={notificacionesSector} loading={loading} />
              </tbody>
            </table>
          </div>
        </section>

        {/* 2. SECCIÓN: HISTÓRICO DE LECTURAS DEL SENSOR */}
        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-slate-200">HISTÓRICO DE LECTURAS</h3>
          </div>
          <div className="max-h-[380px] overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="py-3 px-3">Sector</th>
                  <th className="py-3 px-3">Nivel (m)</th>
                  <th className="py-3 px-3">% Cota</th>
                  <th className="py-3 px-3">Batería</th>
                  <th className="py-3 px-3">Estado</th>
                  <th className="py-3 px-3">Fecha / Hora Colombia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                <FilasLecturas lecturas={lecturasSector} loading={loading} />
              </tbody>
            </table>
          </div>
        </section>

      </main>
    </div>
  );
}
