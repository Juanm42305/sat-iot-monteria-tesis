import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

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

  // Función para descargar el Histórico de Lecturas en CSV (En tiempo real hasta la descarga)
  const descargarLecturasCSV = () => {
    const headers = ["Sector", "Nivel (m)", "Porcentaje Cota (%)", "Batería (%)", "Estado", "Tendencia", "Fecha/Hora Local"];
    const rows = lecturas.map(l => [
      `"${l.sector || 'sector1'}"`,
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

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 font-sans">
      {/* Cabecera del Dashboard */}
      <header className="max-w-6xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-center border-b border-slate-800 pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cyan-400">SAT-IoT · Río Sinú (Margen Izquierda)</h1>
          <p className="text-sm text-slate-400">Sistema de Alerta Temprana en Tiempo Real</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={descargarNotificacionesCSV}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2"
          >
            📥 Descargar Notificaciones CSV
          </button>
          <button 
            onClick={descargarLecturasCSV}
            className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2"
          >
            📊 Descargar Histórico Lecturas CSV
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 gap-8">
        {/* 1. Sección: Bitácora de Notificaciones (Funcional en tiempo real) */}
        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-slate-200">BITÁCORA DE NOTIFICACIONES</h3>
            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded font-medium">Realtime Active</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="py-3 px-3">Hora</th>
                  <th className="py-3 px-3">Estado</th>
                  <th className="py-3 px-3">Canal</th>
                  <th className="py-3 px-3">Resultado</th>
                  <th className="py-3 px-3">Mensaje</th>
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
                      <td className="py-3 px-3 text-slate-300">{item.hora}</td>
                      <td className="py-3 px-3 font-semibold text-cyan-300">{item.estado}</td>
                      <td className="py-3 px-3 text-slate-300">{item.canal}</td>
                      <td className="py-3 px-3 text-emerald-400 font-semibold">{item.resultado}</td>
                      <td className="py-3 px-3 text-slate-300 text-xs max-w-md truncate">{item.mensaje}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 2. Sección: Histórico de Lecturas del Sensor */}
        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-slate-200">HISTÓRICO DE LECTURAS (SENSOR ESP32)</h3>
            <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded font-medium">Monitoreo Activo</span>
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
                  <th className="py-3 px-3">Fecha / Hora Local</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {lecturas.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-6 text-slate-500">
                      Esperando datos del sensor simulado...
                    </td>
                  </tr>
                ) : (
                  lecturas.map((item, index) => (
                    <tr key={item.id || index} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-3 text-slate-300">{item.sector}</td>
                      <td className="py-3 px-3 font-bold text-amber-400">{item.nivel_m} m</td>
                      <td className="py-3 px-3 text-slate-300">{item.porcentaje_cota}%</td>
                      <td className="py-3 px-3 text-slate-300">{item.bateria_pct}%</td>
                      <td className="py-3 px-3 font-medium text-cyan-400">{item.estado}</td>
                      <td className="py-3 px-3 text-slate-400 text-xs">
                        {new Date(item.timestamp_local || item.created_at).toLocaleString()}
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