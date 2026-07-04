import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import LoginGate from './components/LoginGate'
import './index.css'
// light theme removed — the app is always dark
document.documentElement.dataset.theme = 'dark'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <LoginGate>
        <BrowserRouter><App /></BrowserRouter>
      </LoginGate>
    </AuthProvider>
  </React.StrictMode>
)
