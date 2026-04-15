import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Toaster from './components/Toaster'
import './index.css'

// Suppress Chromium internal error that fires when code runs during a native drag
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('Tabs cannot be edited')) {
    event.preventDefault()
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster />
  </React.StrictMode>,
)
