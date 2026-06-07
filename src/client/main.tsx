import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '@client/App'
import { cleanupStale } from '@client/lib/playback'
// Self-hosted editorial type (offline-friendly): Fraunces display + Hanken
// Grotesk text + JetBrains Mono numerals.
import '@fontsource-variable/fraunces'
import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// Best-effort cleanup of stale playback positions on startup.
cleanupStale()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
