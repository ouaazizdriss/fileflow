import { create } from 'zustand'

export type Theme = 'dark' | 'light' | 'corporate' | 'fileflow'

const THEMES: Theme[] = ['light', 'dark', 'corporate', 'fileflow']

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('fileflow_theme')
  if (stored === 'light' || stored === 'dark' || stored === 'corporate' || stored === 'fileflow') return stored
  // Default new visitors to the FileFlow brand theme; users can still cycle away.
  return 'fileflow'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.remove('dark', 'corporate', 'fileflow')
  if (theme === 'dark') document.documentElement.classList.add('dark')
  if (theme === 'corporate') document.documentElement.classList.add('corporate')
  if (theme === 'fileflow') document.documentElement.classList.add('fileflow')
}

interface ThemeStore {
  theme: Theme
  cycle: () => void
}

const initial = getInitialTheme()
applyTheme(initial)

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: initial,
  cycle() {
    set((s) => {
      const next = THEMES[(THEMES.indexOf(s.theme) + 1) % THEMES.length]
      applyTheme(next)
      localStorage.setItem('fileflow_theme', next)
      return { theme: next }
    })
  },
}))
