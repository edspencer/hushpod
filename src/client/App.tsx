import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Link } from 'react-router-dom'
import { AudioLines, LayoutDashboard, Settings as SettingsIcon, Moon, Sun } from 'lucide-react'
import { cn } from '@client/lib/cn'
import { Button } from '@client/components/ui/Button'
import Dashboard from '@client/pages/Dashboard'
import ShowDetail from '@client/pages/ShowDetail'
import EpisodeDetail from '@client/pages/EpisodeDetail'
import Settings from '@client/pages/Settings'

const THEME_KEY = 'hushpod:theme'

function getInitialDark(): boolean {
  if (typeof window === 'undefined') return true
  const stored = window.localStorage.getItem(THEME_KEY)
  if (stored === 'light') return false
  if (stored === 'dark') return true
  return document.documentElement.classList.contains('dark')
}

function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(getInitialDark)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', dark)
    try {
      window.localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  }, [dark])

  return [dark, () => setDark((d) => !d)]
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
        )
      }
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </NavLink>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted">This page could not be found.</p>
      <Link to="/" className="text-sm font-medium text-brand-400 hover:underline">
        Back to dashboard
      </Link>
    </div>
  )
}

export default function App() {
  const [dark, toggleDark] = useDarkMode()

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <AudioLines className="h-5 w-5 text-brand-500" />
              <span className="text-base font-semibold tracking-tight">HushPod</span>
            </Link>
            <nav className="flex items-center gap-1">
              <NavItem to="/" label="Dashboard" icon={<LayoutDashboard className="h-4 w-4" />} />
              <NavItem
                to="/settings"
                label="Settings"
                icon={<SettingsIcon className="h-4 w-4" />}
              />
            </nav>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDark}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/shows/:id" element={<ShowDetail />} />
          <Route path="/episodes/:id" element={<EpisodeDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  )
}
