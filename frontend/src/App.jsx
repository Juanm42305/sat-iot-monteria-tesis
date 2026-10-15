import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { Radio } from 'lucide-react'
import './App.css'

export default function App() {
  const [lecturas, setLecturas] = useState([])
  const [notificaciones, setNotificaciones] = useState([])
  const [ultimo, setUltimo] = useState(null)

  useEffect(() => {
    fetchLecturas()
    fetchNotificaciones()

    const canalLecturas = supabase
      .channel('realtime_lecturas')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lecturas' }, (payload) => {
        const nueva = payload.new
        setUltimo(nueva)
        setLecturas((prev) => [...prev.slice(-49), nueva])
      })
      .subscribe()

    const canalNotif = supabase
      .channel('realtime_notificaciones')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, (payload) => {
        setNotificaciones((prev) => [payload.new, ...prev.slice(0, 9)])
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canalLecturas)
      supabase.removeChannel(canalNotif)
    }
  }, [])

  async function fetchLecturas() {
    const { data } = await supabase.from('lecturas').select('*').order('created_at', { ascending: true }).limit(50)
    if (data && data.length > 0) {
      setLecturas(data)
      setUltimo(data[data.length - 1])
    }
  }

  async function fetchNotificaciones() {
    const { data } = await supabase.from('notificaciones').select('*').order('created_at', { ascending: false }).limit(10)
    if (data) setNotificaciones(data)
  }

  const estadoActual = ultimo ? ultimo.estado : 'NORMAL'

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>SAT-IoT Montería · Cloud</h1>
          <span className="subtitulo">Margen izquierda de Montería · Río Sinú</span>
        </div>
        <div>
          <span className="badge-realtime">
            ● SUPABASE REALTIME
          </span>
        </div>
      </header>

      <div className="grid-cards">
        <div className={`card ${estadoActual}`}>
          <div className="card-lbl">Estado Actual</div>
          <div className="card-big">{estadoActual}</div>
          <div className="card-sub">{ultimo ? `Actualizado: ${ultimo.timestamp_local}` : 'Esperando datos...'}</div>
        </div>

        <div className="card">
          <div className="card-lbl">Nivel del Río</div>
          <div className="card-big">{ultimo ? `${ultimo.nivel_m} m` : '0.00 m'}</div>
          <div className="card-sub">Cota desbordamiento: 5.8 m ({ultimo ? ultimo.porcentaje_cota : 0}%)</div>
        </div>

        <div className="card">
          <div className="card-lbl">Tendencia y Batería</div>
          <div className="card-big">{ultimo ? ultimo.tendencia : 'Estable'}</div>
          <div className="card-sub">Batería Nodo: {ultimo?.bateria_pct ? `${ultimo.bateria_pct}%` : 'Externa'}</div>
        </div>
      </div>

      <div className="card-grafica">
        <div className="card-lbl" style={{ marginBottom: '16px' }}>Comportamiento Temporal del Nivel del Río</div>
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={lecturas}>
              <XAxis dataKey="timestamp_local" stroke="#9aa3ad" />
              <YAxis domain={[0, 7]} stroke="#9aa3ad" />
              <Tooltip contentStyle={{ backgroundColor: '#171b21', borderColor: '#262c34' }} />
              <ReferenceLine y={4.6} stroke="#f2c066" strokeDasharray="3 3" label="Precaución" />
              <ReferenceLine y={5.2} stroke="#ff8a80" strokeDasharray="3 3" label="Crítico" />
              <ReferenceLine y={5.8} stroke="#ffffff" strokeDasharray="5 5" label="Cota" />
              <Line type="monotone" dataKey="nivel_m" stroke="#6ea8ff" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="tabla-container">
        <div className="card-lbl" style={{ marginBottom: '10px' }}>Bitácora de Notificaciones</div>
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Estado</th>
              <th>Canal</th>
              <th>Resultado</th>
              <th>Mensaje</th>
            </tr>
          </thead>
          <tbody>
            {notificaciones.map((n) => (
              <tr key={n.id}>
                <td>{n.timestamp_local}</td>
                <td style={{ fontWeight: 'bold' }}>{n.estado}</td>
                <td>{n.canal}</td>
                <td>{n.resultado}</td>
                <td>{n.mensaje}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}