import { describe, it, expect } from 'vitest'
import { translate, Translator, resolveMessage } from '../i18n/translator'
import { LOCALES, RTL_LOCALES, isRtl, pluralCategory } from '../i18n/locale-meta'
import en from '../i18n/locales/en.json'
import ar from '../i18n/locales/ar.json'

describe('locale meta', () => {
  it('ships 19 locales; Arabic is the only RTL', () => {
    expect(LOCALES).toHaveLength(19)
    expect(RTL_LOCALES).toEqual(['ar'])
    expect(isRtl('ar')).toBe(true)
    expect(isRtl('en')).toBe(false)
  })
  it('uses CLDR plural categories', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 2)).toBe('other')
    // Arabic has more forms
    expect(pluralCategory('ar', 0)).toBe('zero')
    expect(pluralCategory('ar', 2)).toBe('two')
    expect(pluralCategory('ar', 3)).toBe('few')
  })
})

describe('translate', () => {
  it('interpolates params', () => {
    expect(translate(en, 'job.file', { file: 'benchy.gcode' }, 'en')).toBe('Printing benchy.gcode')
    expect(translate(ar, 'job.file', { file: 'benchy.gcode' }, 'ar')).toBe('طباعة benchy.gcode')
  })
  it('selects the right plural form per locale', () => {
    expect(translate(en, 'job.layers', { count: 1 }, 'en')).toBe('1 layer')
    expect(translate(en, 'job.layers', { count: 5 }, 'en')).toBe('5 layers')
    expect(translate(ar, 'job.layers', { count: 1 }, 'ar')).toBe('طبقة واحدة')
    expect(translate(ar, 'job.layers', { count: 2 }, 'ar')).toBe('طبقتان')
    expect(translate(ar, 'job.layers', { count: 3 }, 'ar')).toBe('3 طبقات')
  })
  it('returns the key when missing (never blank)', () => {
    expect(translate(en, 'nope.missing', undefined, 'en')).toBe('nope.missing')
  })
  it('Translator holds catalog + locale', () => {
    const t = new Translator(ar, 'ar')
    expect(t.t('app.ready')).toBe('جاهزة')
  })
  it('resolveMessage falls back to server message then code', () => {
    expect(resolveMessage(en, { code: 'app.ready' }, 'en')).toBe('Ready')
    expect(resolveMessage(en, { code: 'x.y', message: 'server text' }, 'en')).toBe('server text')
    expect(resolveMessage(en, { code: 'x.y' }, 'en')).toBe('x.y')
  })
})
