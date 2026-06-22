import { describe, it, expect } from 'vitest'
import {
  SettingsStore,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  applySettings,
  migrate,
  memoryPersistence,
  moonrakerDbPersistence,
  roamSettings,
} from '../settings/settings'
import { Observable } from '../state/observable'
import type { Connector } from '../moonraker/connector'

function fakeDbConnector(): Connector {
  const db = new Map<string, unknown>()
  return {
    state: 'ready',
    connect: async () => {},
    close: () => {},
    subscribe: async () => {},
    upload: async () => {},
    download: async () => new Blob(),
    setCallbacks: () => {},
    call: async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
      const k = `${params?.namespace}/${params?.key}`
      if (method === 'server.database.post_item') {
        db.set(k, params?.value)
        return undefined as T
      }
      if (method === 'server.database.get_item') {
        if (!db.has(k)) throw new Error('not found')
        return { value: db.get(k) } as T
      }
      return undefined as T
    },
  }
}

describe('SettingsStore', () => {
  it('starts from defaults', () => {
    const s = new SettingsStore()
    expect(s.value).toEqual(DEFAULT_SETTINGS)
    expect(s.value.theme).toBe('tutankhamun')
    expect(s.value.locale).toBe('en')
  })

  it('patch updates + persists, hydrate restores', async () => {
    const p = memoryPersistence()
    const a = new SettingsStore(p)
    a.patch({ theme: 'anubis', locale: 'ar', density: 'compact' })
    expect(a.value.theme).toBe('anubis')

    const b = new SettingsStore(p)
    await b.hydrate()
    expect(b.value).toMatchObject({ theme: 'anubis', locale: 'ar', density: 'compact' })
    // unspecified keys still come from defaults
    expect(b.value.motifDensity).toBe(DEFAULT_SETTINGS.motifDensity)
  })

  it('reset returns to defaults', () => {
    const s = new SettingsStore()
    s.patch({ theme: 'horus' })
    s.reset()
    expect(s.value).toEqual(DEFAULT_SETTINGS)
  })

  it('export / import round-trips', () => {
    const a = new SettingsStore()
    a.patch({ theme: 'horus', locale: 'fr' })
    const json = a.export()
    const b = new SettingsStore()
    b.import(json)
    expect(b.value).toMatchObject({ theme: 'horus', locale: 'fr' })
  })

  it('subscribers are notified on change', () => {
    const s = new SettingsStore()
    const seen: string[] = []
    s.settings.subscribe((v) => seen.push(v.theme))
    s.patch({ theme: 'anubis' })
    expect(seen).toEqual(['tutankhamun', 'anubis'])
  })
})

describe('migrate (coercion / hardening)', () => {
  it('replaces every invalid enum with its default and stamps the version', () => {
    const m = migrate({
      theme: 'bogus',
      locale: 'zz',
      density: 'weird',
      motifDensity: 'nope',
      reducedMotion: 'yes',
    })
    expect(m).toEqual(DEFAULT_SETTINGS)
    expect(m.version).toBe(SETTINGS_VERSION)
  })

  it('keeps valid values verbatim', () => {
    expect(
      migrate({ theme: 'anubis', locale: 'ar', density: 'compact', motifDensity: 'full', reducedMotion: true }),
    ).toEqual({
      version: SETTINGS_VERSION,
      theme: 'anubis',
      locale: 'ar',
      density: 'compact',
      motifDensity: 'full',
      reducedMotion: true,
    })
  })

  it('tolerates non-object input', () => {
    expect(migrate(null)).toEqual(DEFAULT_SETTINGS)
    expect(migrate('garbage')).toEqual(DEFAULT_SETTINGS)
    expect(migrate(42)).toEqual(DEFAULT_SETTINGS)
  })

  it('carries a valid dashboardLayout through and omits an invalid one', () => {
    const m = migrate({ dashboardLayout: { slots: [{ widgetId: 'temps', order: 1 }] } })
    expect(m.dashboardLayout).toEqual({ version: 1, slots: [{ widgetId: 'temps', order: 1 }] })
    expect(migrate({ dashboardLayout: 'nope' })).not.toHaveProperty('dashboardLayout')
    expect(migrate({})).not.toHaveProperty('dashboardLayout')
  })

  it('import() rejects unknown keys and survives malformed JSON', () => {
    const s = new SettingsStore()
    s.import('{ not valid json')
    expect(s.value).toEqual(DEFAULT_SETTINGS)
    s.import(JSON.stringify({ theme: 'horus', evil: 'x' }))
    expect(s.value.theme).toBe('horus')
    expect((s.value as unknown as Record<string, unknown>).evil).toBeUndefined()
  })
})

describe('applySettings', () => {
  it('returns rtl direction for an RTL locale, ltr otherwise', () => {
    const el = { style: { setProperty() {} } }
    expect(applySettings({ ...DEFAULT_SETTINGS, locale: 'ar' }, el).dir).toBe('rtl')
    expect(applySettings({ ...DEFAULT_SETTINGS, locale: 'en' }, el).dir).toBe('ltr')
  })
  it('applies the theme css variables', () => {
    const set: Record<string, string> = {}
    const el = { style: { setProperty: (p: string, v: string) => { set[p] = v } } }
    applySettings({ ...DEFAULT_SETTINGS, theme: 'anubis' }, el)
    expect(set['--fm-primary']).toBe('#C2843B') // Anubis ochre
  })
})

describe('moonrakerDbPersistence (roaming substrate)', () => {
  it('round-trips settings through the Moonraker DB; a missing key reads as {}', async () => {
    const p = moonrakerDbPersistence(fakeDbConnector())
    expect(await p.load()).toEqual({})
    await p.save({ ...DEFAULT_SETTINGS, theme: 'horus' })
    expect((await p.load()).theme).toBe('horus')
  })
})

describe('roamSettings', () => {
  it('pulls the shared settings when the connection goes live', async () => {
    const remote = memoryPersistence()
    await remote.save({ ...DEFAULT_SETTINGS, theme: 'horus' })
    const store = new SettingsStore(memoryPersistence())
    const live = new Observable(false)
    roamSettings(store, remote, live)
    expect(store.value.theme).toBe('tutankhamun') // unchanged until live
    live.set(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(store.value.theme).toBe('horus') // shared copy pulled in
  })

  it('writes a later local change back to the shared store', async () => {
    const remote = memoryPersistence()
    const store = new SettingsStore(memoryPersistence())
    roamSettings(store, remote, new Observable(false))
    store.patch({ theme: 'anubis' })
    await new Promise((r) => setTimeout(r, 0))
    expect((await remote.load()).theme).toBe('anubis')
  })
})
