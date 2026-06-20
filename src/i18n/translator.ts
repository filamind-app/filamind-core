// Framework-agnostic translation core. The per-app layer (vue-i18n in 3d/screen/flow)
// binds to this; the catalogs + this logic are shared so all three translate identically.

import { pluralCategory } from './locale-meta'

/** A nested catalog: { app: { name: "FilaMind 3d" }, job: { layers: { one, other } } }. */
export type Catalog = Record<string, unknown>
export type Params = Record<string, string | number>

function lookup(catalog: Catalog, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (o, part) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[part] : undefined),
    catalog,
  )
}

function interpolate(s: string, params?: Params): string {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_m, k: string) => (k in params ? String(params[k]) : `{${k}}`))
}

/**
 * Translate `key` against `catalog` for `locale`. Plural: if the entry is an object
 * (`{ one, other, … }`) and `params.count` is a number, the right CLDR form is chosen.
 * Missing keys return the key itself (so gaps are visible, never blank).
 */
export function translate(catalog: Catalog, key: string, params?: Params, locale = 'en'): string {
  let entry = lookup(catalog, key)
  if (entry && typeof entry === 'object' && params && typeof params.count === 'number') {
    const forms = entry as Record<string, string>
    const cat = pluralCategory(locale, params.count)
    entry = forms[cat] ?? forms.other ?? forms.one
  }
  if (typeof entry !== 'string') return key
  return interpolate(entry, params)
}

/** Convenience holder for a (catalog, locale) pair. */
export class Translator {
  constructor(
    public catalog: Catalog,
    public locale = 'en',
  ) {}
  t(key: string, params?: Params): string {
    return translate(this.catalog, key, params, this.locale)
  }
}

/** Backend strings travel as a message-code contract so the UI translates them. */
export interface BackendMessage {
  code: string
  params?: Params
  /** server-side fallback text if the UI lacks the key */
  message?: string
}

export function resolveMessage(catalog: Catalog, m: BackendMessage, locale = 'en'): string {
  const out = translate(catalog, m.code, m.params, locale)
  return out === m.code ? (m.message ?? m.code) : out
}
