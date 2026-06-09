import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installNeonDiagnostics, neonDiagnostics } from './diagnostics/neonDiagnostics'
import './index.css'
import App from './App.tsx'

installNeonDiagnostics()

const root = document.getElementById('root')
if (!root) {
  neonDiagnostics.error('app', 'missing_root_element')
  throw new Error('Missing #root element')
}

neonDiagnostics.log('app', 'react_root_start')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
