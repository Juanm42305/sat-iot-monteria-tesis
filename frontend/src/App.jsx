import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export default function App() {
  const [notificaciones, setNotificaciones] = useState([]);
  const [lecturas, setLecturas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Cargar datos iniciales desde Supabase
    const fetchData = async () => {
      setLoading(true);
      const { data: notifData, error: notifError } = await supabase
        .from('notificaciones')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (!notifError && notifData) setNotificaciones(notifData);

      const { data: lectData, error: lectError } = await supabase
        .from('lecturas')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (!lectError && lectData) setLecturas(lectData);
      setLoading(false);
    };

    fetchData();

    // 2. Suscripción en Tiempo Real (Realtime) para ambas tablas
    const channel = supabase.channel('schema-db-changes')
      .on(
        'postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'notificaciones' }, 
        (payload) => {
          setNotificaciones((prev) => [payload.new, ...prev]);
        }
      )
      .on(
        'postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'lecturas' }, 
        (payload) => {
          setLecturas((prev) => [payload.new, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Función para descargar la Bitácora de Notificaciones en CSV
  const descargarNotificacionesCSV = () => {
    const headers = ["Hora", "Estado", "Canal", "Resultado", "Mensaje"];
    const rows = notificaciones.map(n => [
      `"${n.hora || ''}"`, 
      `"${n.estado || ''}"`, 
      `"${n.canal || 'Telegram'}"`, 
      `"${n.resultado || 'Éxito'}"`, 
      `"${(n.mensaje || '').replace(/\n/g, ' ').replace(/"/g, '""')}"`
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `bitacora_notificaciones_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Función para descargar el Histórico de Lecturas en CSV
  const descargarLecturasCSV = () => {
    const headers = ["Sector", "Nivel (m)", "Porcentaje Cota (%)", "Batería (%)", "Estado", "Tendencia", "Fecha/Hora Local"];
    const rows = lecturas.map(l => [
      `"${l.sector || 'Margen Izquierda'}"`,
      l.nivel_m,
      l.porcentaje_cota || '',
      l.bateria_pct || '',
      `"${l.estado || ''}"`,
      `"${l.tendencia || 'Estable'}"`,
      `"${l.timestamp_local || l.created_at || ''}"`
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `historico_lecturas_satiot_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Obtener la lectura más reciente para el panel de KPIs
  const ultimaLectura = lecturas[0] || {
    nivel_m: '--',
    estado: 'NORMAL',
    porcentaje_cota: '--',
    bateria_pct: '--',
    tendencia: 'Estable',
    sector: 'Margen Izquierda'
  };

  // Preparar datos para la gráfica (orden cronológico ascendente para Recharts)
  const chartData = [...lecturas].reverse().map(l => ({
    hora: l.timestamp_local 
      ? new Date(l.timestamp_local).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Bogota' })
      : new Date(l.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Bogota' }),
    nivel: l.nivel_m,
    cota: l.porcentaje_cota
  }));

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6 font-sans">
      {/* Cabecera del Dashboard */}
      <header className="max-w-6xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center border-b border-slate-800 pb-4 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-cyan-400">SAT-IoT · Río Sinú</h1>
            <span className="bg-cyan-500/10 text-cyan-400 text-xs px-2.5 py-0.5 rounded-full border border-cyan-500/20 font-mono">
              Montería, Córdoba
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">Sistema de Alerta Temprana frente a Inundaciones</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button 
            onClick={descargarNotificacionesCSV}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2 cursor-pointer"
          >
            📥 Exportar Bitácora CSV
          </button>
          <button 
            onClick={descargarLecturasCSV}
            className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2 cursor-pointer"
          >
            📊 Exportar Lecturas CSV
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-6">

        {/* TARJETAS DE MONITOREO EN TIEMPO REAL (KPIs) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg relative overflow-hidden">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Nivel Actual del Río</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-white font-mono">{ultimaLectura.nivel_m}</span>
              <span className="text-slate-400 text-sm">metros</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">Estación: {ultimaLectura.sector || 'Margen Izquierda'}</p>
          </div>

          <div className={`bg-slate-900 border p-5 rounded-xl shadow-lg ${
            ultimaLectura.estado === 'CRITICA' ? 'border-red-500/50 bg-red-950/20' :
            ultimaLectura.estado === 'PRECAUCION' ? 'border-amber-500/50 bg-amber-950/20' :
            'border-slate-800'
          }`}>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Estado de Alerta</p>
            <div className="mt-2">
              <span className={`px-3 py-1 rounded-md text-sm font-bold inline-block ${
                ultimaLectura.estado === 'CRITICA' ? 'bg-red-500 text-white animate-pulse' :
                ultimaLectura.estado === 'PRECAUCION' ? 'bg-amber-500 text-slate-950' :
                'bg-emerald-500 text-slate-950'
              }`}>
                {ultimaLectura.estado || 'NORMAL'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2">Tendencia: {ultimaLectura.tendencia || 'Estable'}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Capacidad de Cauce</p>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-3xl font-extrabold text-cyan-400 font-mono">{ultimaLectura.porcentaje_cota || 0}</span>
              <span className="text-cyan-400 text-lg">%</span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
              <div 
                className="bg-cyan-500 h-full transition-all duration-500" 
                style={{ width: `${Math.min(ultimaLectura.porcentaje_cota || 0, 100)}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Batería del Nodo ESP32</p>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-3xl font-extrabold text-emerald-400 font-mono">{ultimaLectura.bateria_pct || 100}</span>
              <span className="text-emerald-400 text-lg">%</span>
            </div>
            <p className="text-xs text-emerald-500/80 mt-2 flex items-center gap-1">
              <span>⚡</span> Alimentación Normal
            </p>
          </div>

        </div>

        {/* GRÁFICA EN TIEMPO REAL CON UMBRALES DE ALERTA */}
        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-200">MONITOREO GRÁFICO - NIVEL DEL RÍO SINÚ</h3>
              <p className="text-xs text-slate-400">Comportamiento en tiempo real con líneas de umbral de riesgo</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-amber-400 font-medium">🟨 Precaución (3.5m)</span>
              <span className="flex items-center gap-1 text-red-400 font-medium">🟥 Crítica (5.0m)</span>
            </div>
          </div>
          
          <div className="h-72 w-full pt-4">
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500">
                Esperando datos para graficar...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="hora" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} domain={['auto', 'auto']} unit="m" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', color: '#fff' }} 
                  />
                  {/* Línea de Umbral de Precaución (Amarilla) */}
                  <ReferenceLine 
                    y={3.5} 
                    stroke="#f59e0b" 
                    strokeDasharray="4 4" 
                    label={{ value: 'Umbral Precaución (3.5m)', fill: '#f59e0b', fontSize: 11, position: 'insideTopRight' }} 
                  />
                  {/* Línea de Umbral Crítico (Roja) */}
                  <ReferenceLine 
                    y={5.0} 
                    stroke="#ef4444" 
                    strokeDasharray="4 4" 
                    label={{ value: 'Umbral Crítico (5.0m)', fill: '#ef4444', fontSize: 11, position: 'insideTopRight' }} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="nivel" 
                    name="Nivel (m)" 
                    stroke="#22d3ee" 
                    strokeWidth={3} 
                    dot={{ fill: '#22d3ee', r: 4 }} 
                    activeDot={{ r: 8 }} 
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* 1. SECCIÓN: BITÁCORA DE NOTIFICACIONES */}
        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-slate-200">BITÁCORA DE NOTIFICACIONES AUTOMÁTICAS</h3>
            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> Realtime Activo
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="py-3 px-3">Hora Local</th>
                  <th className="py-3 px-3">Estado</th>
                  <th className="py-3 px-3">Canal</th>
                  <th className="py-3 px-3">Resultado</th>
                  <th className="py-3 px-3">Mensaje Transmitido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {loading && notificaciones.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="text-center py-6 text-slate-500">Cargando bitácora...</td>
                  </tr>
                ) : notificaciones.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="text-center py-6 text-slate-500">
                      No hay notificaciones registradas todavía.
                    </td>
                  </tr>
                ) : (
                  notificaciones.map((item, index) => (
                    <tr key={item.id || index} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-3 text-slate-300 font-mono">{item.hora}</td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          item.estado === 'CRITICA' ? 'bg-red-900/60 text-red-300 border border-red-700' :
                          item.estado === 'PRECAUCION' ? 'bg-amber-900/60 text-amber-300 border border-amber-700' :
                          'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
                        }`}>
                          {item.estado}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">{item.canal || 'Telegram'}</td>
                      <td className="py-3 px-3 text-emerald-400 font-medium">{item.resultado || 'Éxito'}</td>
                      <td className="py-3 px-3 text-slate-300 text-xs max-w-md truncate">{item.mensaje}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 2. SECCIÓN: HISTÓRICO DE LECTURAS DEL SENSOR */}
        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-slate-200">HISTÓRICO DE LECTURAS (NODO ESP32)</h3>
            <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2.5 py-1 rounded-full font-medium">
              Sincronizado Supabase
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
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
                {lecturas.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-6 text-slate-500">
                      Esperando datos del sensor...
                    </td>
                  </tr>
                ) : (
                  lecturas.map((item, index) => (
                    <tr key={item.id || index} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-3 text-slate-300">{item.sector || 'Margen Izquierda'}</td>
                      <td className="py-3 px-3 font-bold text-amber-400 font-mono">{item.nivel_m} m</td>
                      <td className="py-3 px-3 text-slate-300 font-mono">{item.porcentaje_cota}%</td> sustentación
                      <td className="py-3 px-3 text-slate-300 font-mono">{item.bateria_pct}%</td>
                      <td className="py-3 px-3 font-medium text-cyan-400">{item.estado}</td>
                      <td className="py-3 px-3 text-slate-400 text-xs font-mono">
                        {item.timestamp_local 
                          ? new Date(item.timestamp_local).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) 
                          : new Date(item.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

      </main>
    </div>
  );
}