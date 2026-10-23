import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadRuntimeConfig } from './runtimeConfig'

async function startApp() {
  await loadRuntimeConfig()

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

startApp().catch((error) => {
  document.getElementById('root').textContent = error.message
})
