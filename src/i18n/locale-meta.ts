// Shared locale metadata for the whole suite (19 locales). The actual translation
// catalogs are drop-in JSON (one folder per locale); this is the registry + RTL +
// plural-rule helper that 3d / screen / flow all consume.

export interface LocaleMeta {
  code: string
  /** endonym (shown in the language picker) */
  name: string
  rtl: boolean
  dir: 'ltr' | 'rtl'
}

export const LOCALES: readonly LocaleMeta[] = [
  { code: 'en', name: 'English', rtl: false, dir: 'ltr' },
  { code: 'ar', name: 'العربية', rtl: true, dir: 'rtl' },
  { code: 'de', name: 'Deutsch', rtl: false, dir: 'ltr' },
  { code: 'es', name: 'Español', rtl: false, dir: 'ltr' },
  { code: 'fr', name: 'Français', rtl: false, dir: 'ltr' },
  { code: 'ru', name: 'Русский', rtl: false, dir: 'ltr' },
  { code: 'zh-Hans', name: '简体中文', rtl: false, dir: 'ltr' },
  { code: 'pt-BR', name: 'Português (Brasil)', rtl: false, dir: 'ltr' },
  { code: 'it', name: 'Italiano', rtl: false, dir: 'ltr' },
  { code: 'ja', name: '日本語', rtl: false, dir: 'ltr' },
  { code: 'ko', name: '한국어', rtl: false, dir: 'ltr' },
  { code: 'pl', name: 'Polski', rtl: false, dir: 'ltr' },
  { code: 'tr', name: 'Türkçe', rtl: false, dir: 'ltr' },
  { code: 'nl', name: 'Nederlands', rtl: false, dir: 'ltr' },
  { code: 'zh-Hant', name: '繁體中文', rtl: false, dir: 'ltr' },
  { code: 'uk', name: 'Українська', rtl: false, dir: 'ltr' },
  { code: 'hi', name: 'हिन्दी', rtl: false, dir: 'ltr' },
  { code: 'vi', name: 'Tiếng Việt', rtl: false, dir: 'ltr' },
  { code: 'id', name: 'Bahasa Indonesia', rtl: false, dir: 'ltr' },
] as const

export const DEFAULT_LOCALE = 'en'
export const RTL_LOCALES: readonly string[] = LOCALES.filter((l) => l.rtl).map((l) => l.code)

export function localeMeta(code: string): LocaleMeta | undefined {
  return LOCALES.find((l) => l.code === code)
}

export function isRtl(code: string): boolean {
  return localeMeta(code)?.rtl ?? false
}

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/** CLDR plural category via the platform's Intl.PluralRules (handles ar/ru/pl/… correctly). */
export function pluralCategory(locale: string, n: number): PluralCategory {
  try {
    return new Intl.PluralRules(locale).select(n) as PluralCategory
  } catch {
    return n === 1 ? 'one' : 'other'
  }
}
