import { SIN_DATOS_TRAS_MS } from './configuracion'

const ZONA = { timeZone: 'America/Bogota' }

export const horaColombia = (iso) =>
  new Date(iso).toLocaleTimeString('es-CO', { ...ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const fechaHoraColombia = (iso) => new Date(iso).toLocaleString('es-CO', ZONA)

// Une filas sin repetir, de la más reciente a la más antigua.
export function fusionarPorId(nuevas, previas, maximo) {
  const porId = new Map([...previas, ...nuevas].map((fila) => [fila.id, fila]))
  return [...porId.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, maximo)
}

// El último estado solo es vigente si la lectura es reciente.
export function estadoVigente(lectura, ahora) {
  if (!lectura) return 'SIN_DATOS'
  if (ahora - new Date(lectura.created_at).getTime() > SIN_DATOS_TRAS_MS) return 'SIN_DATOS'
  return lectura.estado
}

export function tiempoTranscurrido(iso, ahora) {
  const segundos = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000))
  if (segundos < 60) return `${segundos} s`
  if (segundos < 3600) return `${Math.round(segundos / 60)} min`
  if (segundos < 86400) return `${Math.round(segundos / 3600)} h`
  return `${Math.round(segundos / 86400)} días`
}

async function leerTabla(supabase, tabla) {
  const filas = []
  const paso = 1000
  for (;;) {
    const { data, error } = await supabase
      .from(tabla)
      .select('*')
      .order('created_at', { ascending: false })
      .order('id')
      .range(filas.length, filas.length + paso - 1)
    if (error) throw error
    filas.push(...data)
    if (data.length < paso) return filas
  }
}

function celdaCSV(valor) {
  if (valor === null || valor === undefined) return ''
  const texto = typeof valor === 'number' ? String(valor).replace('.', ',') : String(valor)
  return `"${texto.replaceAll(/\r?\n/g, ' | ').replaceAll('"', '""')}"`
}

// Descarga la tabla completa como CSV para Excel en Colombia: separador ';' y coma decimal.
export async function exportarCSV(supabase, tabla, columnas, nombre) {
  const filas = await leerTabla(supabase, tabla)
  const lineas = [
    columnas.map(([titulo]) => celdaCSV(titulo)).join(';'),
    ...filas.map((fila) => columnas.map(([, valor]) => celdaCSV(valor(fila))).join(';')),
  ]
  const archivo = new Blob(['\uFEFF' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(archivo)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = `${nombre}_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.append(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}
