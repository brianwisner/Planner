import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
// Only downloaded when Easy reading is on (the browser fetches fonts on first use).
import '@fontsource-variable/atkinson-hyperlegible-next'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/easy.css'
import { applyEasy, applyTheme, savedEasy, savedTheme } from './lib/theme'
import App from './App'

applyTheme(savedTheme())
applyEasy(savedEasy())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
