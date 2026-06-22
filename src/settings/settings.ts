// Unified user settings & customization — the shared model behind the single
// "Settings & Customization" section (theme switcher + language switcher + prefs).
// Persisted by the app in the Moonraker DB namespace, machineUUID-keyed (F10),
// with a localStorage fallback. Applying a change re-themes + re-directions the UI.

import { Observable } from '../state/observable'
import type { Connector } from '../moonraker/connector'
import { applyTheme, DEFAULT_THEME, themes, type ThemeName } from '../theme/tokens'
import { DEFAULT_LOCALE, LOCALES, localeMeta } from '../i18n/locale-meta'
import { coerceDashboardLayout, type DashboardLayout } from '../registry/dashboard-resolver'

export const SETTINGS_VERSION = 1

export interface UserSettings {
  /** schema version (for migration) */
  version: number
  theme: ThemeName
  locale: string
  density: 'comfortable' | 'compact'
  /** Pharaonic motif density (§10.4) */
  motifDensity: 'off' | 'subtle' | 'full'
  /** reduce animation/illustration for low-power or accessibility */
  reducedMotion: boolean
  /** the single per-surface dashboard definition (resolved per surface + viewport at render) */
  dashboardLayout?: DashboardLayout
}

export const DEFAULT_SETTINGS: UserSettings = {
  version: SETTINGS_VERSION,
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  density: 'comfortable',
  motifDensity: 'subtle',
  reducedMotion: false,
}

const DENSITIES = new Set<string>(['comfortable', 'compact'])
const MOTIFS = new Set<string>(['off', 'subtle', 'full'])

/** Coerce an arbitrary (old / foreign / partial) blob into valid UserSettings — drops unknown keys,
 *  validates every enum, stamps the current version. Used by hydrate() + import(). */
export function migrate(raw: unknown): UserSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: UserSettings = {
    version: SETTINGS_VERSION,
    theme: typeof r.theme === 'string' && r.theme in themes ? (r.theme as ThemeName) : DEFAULT_SETTINGS.theme,
    locale:
      typeof r.locale === 'string' && LOCALES.some((l) => l.code === r.locale)
        ? r.locale
        : DEFAULT_SETTINGS.locale,
    density:
      typeof r.density === 'string' && DENSITIES.has(r.density)
        ? (r.density as UserSettings['density'])
        : DEFAULT_SETTINGS.density,
    motifDensity:
      typeof r.motifDensity === 'string' && MOTIFS.has(r.motifDensity)
        ? (r.motifDensity as UserSettings['motifDensity'])
        : DEFAULT_SETTINGS.motifDensity,
    reducedMotion: typeof r.reducedMotion === 'boolean' ? r.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
  }
  // The dashboard layout is optional; only carry it through when it coerces to a valid shape so the
  // round-trip of a layout-free blob stays identical to DEFAULT_SETTINGS.
  const layout = coerceDashboardLayout(r.dashboardLayout)
  if (layout) out.dashboardLayout = layout
  return out
}

/** App-provided persistence — the Moonraker-DB impl is keyed by machineUUID; tests use memory. */
export interface SettingsPersistence {
  load(): Promise<Partial<UserSettings>>
  save(settings: UserSettings): Promise<void>
}

export function memoryPersistence(): SettingsPersistence {
  let store: UserSettings | undefined
  return {
    load: async () => store ?? {},
    save: async (s) => {
      store = s
    },
  }
}

export function localStoragePersistence(storageKey = 'filamind.settings'): SettingsPersistence {
  return {
    load: async () => {
      try {
        const raw = localStorage.getItem(storageKey)
        return raw ? (JSON.parse(raw) as Partial<UserSettings>) : {}
      } catch {
        return {}
      }
    },
    save: async (s) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(s))
      } catch {
        /* ignore quota/availability */
      }
    },
  }
}

const DB_NAMESPACE = 'filamind'
const DB_KEY = 'settings'

/** Settings persisted in the printer's Moonraker database, so they roam across every FilaMind
 *  surface on that printer (3d, screen, …) — the F10 remote-config substrate. */
export function moonrakerDbPersistence(connector: Connector): SettingsPersistence {
  return {
    load: async () => {
      try {
        const res = await connector.call<{ value?: Partial<UserSettings> }>(
          'server.database.get_item',
          { namespace: DB_NAMESPACE, key: DB_KEY },
        )
        return res?.value ?? {}
      } catch {
        return {} // missing key or offline → fall back to defaults
      }
    },
    save: async (s) => {
      try {
        await connector.call('server.database.post_item', {
          namespace: DB_NAMESPACE,
          key: DB_KEY,
          value: s,
        })
      } catch {
        /* offline / no DB — the local copy still holds */
      }
    },
  }
}

/** Roam a (locally-persisted) SettingsStore across surfaces via a shared remote store: pull the
 *  shared settings whenever the connection goes live (the shared copy wins on connect), and
 *  write local changes back. Lets one surface (e.g. FilaMind 3d) reconfigure another (the screen). */
export function roamSettings(
  store: SettingsStore,
  remote: SettingsPersistence,
  live: Observable<boolean>,
): void {
  let applying = false
  let primed = false
  live.subscribe((isLive) => {
    if (!isLive) return
    void remote.load().then((shared) => {
      if (Object.keys(shared).length === 0) return
      applying = true
      store.patch(shared)
      applying = false
    })
  })
  store.settings.subscribe((s) => {
    if (!primed) {
      primed = true // skip the immediate current-value emission (don't clobber the shared copy on attach)
      return
    }
    if (!applying) void remote.save(s) // write local changes through to the shared store
  })
}

export class SettingsStore {
  readonly settings: Observable<UserSettings>

  constructor(
    private readonly persistence: SettingsPersistence = memoryPersistence(),
    initial: Partial<UserSettings> = {},
  ) {
    this.settings = new Observable<UserSettings>(migrate({ ...DEFAULT_SETTINGS, ...initial }))
  }

  get value(): UserSettings {
    return this.settings.value
  }

  /** Load persisted settings over the defaults (e.g. on app start). */
  async hydrate(): Promise<void> {
    const loaded = await this.persistence.load()
    this.settings.set(migrate({ ...DEFAULT_SETTINGS, ...loaded }))
  }

  /** Change one or more settings + persist. */
  patch(p: Partial<UserSettings>): void {
    this.settings.update((s) => ({ ...s, ...p }))
    void this.persistence.save(this.settings.value)
  }

  reset(): void {
    this.patch({ ...DEFAULT_SETTINGS })
  }

  export(): string {
    return JSON.stringify(this.settings.value, null, 2)
  }

  import(json: string): void {
    try {
      this.patch(migrate(JSON.parse(json)))
    } catch {
      /* ignore malformed import */
    }
  }
}

/** Apply theme to the DOM and return the text direction the app should set for the locale. */
export function applySettings(
  s: UserSettings,
  el?: { style: { setProperty(p: string, v: string): void } },
): { dir: 'ltr' | 'rtl' } {
  applyTheme(s.theme, el)
  return { dir: localeMeta(s.locale)?.dir ?? 'ltr' }
}
