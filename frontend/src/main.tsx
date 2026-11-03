import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './i18n'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'rgb(var(--color-elevated))',
          color: 'rgb(var(--color-text-primary))',
          border: '1px solid rgb(var(--color-border))',
          borderRadius: '8px',
          fontSize: '14px',
        },
        success: { iconTheme: { primary: 'rgb(var(--color-success))', secondary: 'rgb(var(--color-elevated))' } },
        error: { iconTheme: { primary: 'rgb(var(--color-danger))', secondary: 'rgb(var(--color-elevated))' } },
      }}
    />
  </React.StrictMode>,
)
