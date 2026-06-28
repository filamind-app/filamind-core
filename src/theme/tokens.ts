// FilaMind's design tokens - one token layer shared across web (FilaMind 3d) and
// touch (FilaMind screen): three signature Pharaonic themes plus neutral light/dark.
// Emits CSS custom properties (`--fm-*`) that Tailwind + SVG charts read, so one
// switch restyles everything.

export interface ThemeTokens {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  textMuted: string
  primary: string
  primaryContrast: string
  secondary: string
  accent: string
  success: string
  warning: string
  danger: string
}

export type ThemeName = 'tutankhamun' | 'horus' | 'anubis' | 'light' | 'dark'

export const themes: Record<ThemeName, ThemeTokens> = {
  // flagship default - obsidian + gold + lapis + turquoise
  tutankhamun: {
    bg: '#0E0F12', surface: '#17171C', surface2: '#20202A', border: '#3A3320',
    text: '#F3ECD8', textMuted: '#B9AE8E',
    primary: '#D4AF37', primaryContrast: '#0E0F12', secondary: '#1B3A6B', accent: '#2BA199',
    success: '#2BA199', warning: '#E0A92E', danger: '#9E2B25',
  },
  // night sky + sky-lapis + gold + malachite (Eye of Horus)
  horus: {
    bg: '#0B1016', surface: '#122430', surface2: '#173040', border: '#1E4256',
    text: '#EAF2F5', textMuted: '#9DB6C2',
    primary: '#1E6FA8', primaryContrast: '#06121C', secondary: '#E0B84C', accent: '#1E6F5C',
    success: '#1E6F5C', warning: '#E0B84C', danger: '#B3432F',
  },
  // granite + ochre + bronze + deep red (guardian of the afterlife)
  anubis: {
    bg: '#1A1714', surface: '#221C16', surface2: '#2E251B', border: '#5A3F22',
    text: '#F4E7CE', textMuted: '#C2A878',
    primary: '#C2843B', primaryContrast: '#1A1714', secondary: '#7A5C2E', accent: '#8C1F1A',
    success: '#6E7C3A', warning: '#D98E2B', danger: '#8C1F1A',
  },
  // neutral light - a conventional bright UI for users who prefer it
  light: {
    bg: '#F7F8FA', surface: '#FFFFFF', surface2: '#EEF1F5', border: '#D6DBE2',
    text: '#1A1D23', textMuted: '#5B6573',
    primary: '#2563EB', primaryContrast: '#FFFFFF', secondary: '#64748B', accent: '#0D9488',
    success: '#15803D', warning: '#B45309', danger: '#DC2626',
  },
  // neutral dark - a conventional dark UI, distinct from the warm Pharaonic palettes
  dark: {
    bg: '#0F1115', surface: '#171A21', surface2: '#1F232C', border: '#2C313C',
    text: '#E6E8EC', textMuted: '#9AA2AE',
    primary: '#4F8EF7', primaryContrast: '#0B0D11', secondary: '#6B7280', accent: '#14B8A6',
    success: '#22A06B', warning: '#E0A92E', danger: '#E5484D',
  },
}

export const DEFAULT_THEME: ThemeName = 'tutankhamun'

function kebab(s: string): string {
  return s.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`)
}

/** `{ "--fm-bg": "#0E0F12", ... }` for a theme. */
export function themeToCssVars(t: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(t)) out[`--fm-${kebab(k)}`] = v
  return out
}

/** Apply a theme to an element (default: document root) by setting the `--fm-*` variables. */
export function applyTheme(name: ThemeName, el?: { style: { setProperty(p: string, v: string): void } }): void {
  const target =
    el ?? (typeof document !== 'undefined' ? document.documentElement : undefined)
  if (!target) return
  for (const [prop, val] of Object.entries(themeToCssVars(themes[name]))) {
    target.style.setProperty(prop, val)
  }
}
