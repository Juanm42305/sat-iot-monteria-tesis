import './index.css' // <--- ¡Esta línea es obligatoria! Si no está, el CSS no existe para Vite.
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)