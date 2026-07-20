import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import LoginGate from './components/LoginGate'
import './index.css'
// Set the persisted theme on <html> BEFORE first paint (no flash). Store reads the same key.
{
  let saved: string | null = null
  try { saved = localStorage.getItem('verdix-theme') } catch { /* denied */ }
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark'
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <LoginGate>
        <BrowserRouter><App /></BrowserRouter>
      </LoginGate>
    </AuthProvider>
  </React.StrictMode>
)
