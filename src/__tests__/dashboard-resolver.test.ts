import { describe, it, expect } from 'vitest'

import {
  surfaceHint,
  resolveDashboard,
  coerceDashboardLayout,
  DASHBOARD_LAYOUT_VERSION,
  type DashboardLayout,
} from '../registry/dashboard-resolver'
import type { WidgetDefinition } from '../registry/widget-registry'

const w = (id: string): WidgetDefinition => ({ id, title: id, component: async () => ({}) })
const ids = (r: { widgets: WidgetDefinition[] }) => r.widgets.map((x) => x.id)

describe('surfaceHint', () => {
  it('screen is always big-touch; 3d depends on width', () => {
    expect(surfaceHint('screen', 1920)).toBe('big-touch')
    expect(surfaceHint('screen', 320)).toBe('big-touch')
    expect(surfaceHint('3d', 1280)).toBe('dense-desktop')
    expect(surfaceHint('3d', 500)).toBe('thumb-phone')
  })
})

describe('resolveDashboard', () => {
  const available = [w('temps'), w('motion'), w('history')]

  it('with no layout, renders all available in registry order', () => {
    const r = resolveDashboard(undefined, available, 'dense-desktop')
    expect(ids(r)).toEqual(['temps', 'motion', 'history'])
    expect(r.columns).toBe(3)
  })

  it('honours slot order, then appends unmentioned widgets', () => {
    const layout: DashboardLayout = {
      version: 1,
      slots: [
        { widgetId: 'history', order: 1 },
        { widgetId: 'temps', order: 2 },
      ],
    }
    // history, temps (ordered) then motion (appended; not in layout)
    expect(ids(resolveDashboard(layout, available, 'dense-desktop'))).toEqual([
      'history',
      'temps',
      'motion',
    ])
  })

  it('hides a widget on a hint via hideOn (and does not re-append it)', () => {
    const layout: DashboardLayout = {
      version: 1,
      slots: [{ widgetId: 'history', hideOn: ['thumb-phone'] }],
    }
    expect(ids(resolveDashboard(layout, available, 'thumb-phone'))).toEqual(['temps', 'motion'])
    // shown on a different hint
    expect(ids(resolveDashboard(layout, available, 'dense-desktop'))).toContain('history')
  })

  it('ignores slots whose widget is not available; columns vary by hint', () => {
    const layout: DashboardLayout = { version: 1, slots: [{ widgetId: 'ghost', order: 0 }] }
    const r = resolveDashboard(layout, available, 'big-touch')
    expect(ids(r)).toEqual(['temps', 'motion', 'history']) // ghost dropped, rest appended
    expect(r.columns).toBe(2)
  })
})

describe('coerceDashboardLayout', () => {
  it('normalises a valid blob and drops bad slots / hints', () => {
    const out = coerceDashboardLayout({
      version: 99,
      slots: [
        { widgetId: 'a', order: 3, hideOn: ['thumb-phone', 'bogus'] },
        { widgetId: 5 }, // bad widgetId -> dropped
        { order: 1 }, // no widgetId -> dropped
        'nope', // not an object -> dropped
      ],
    })
    expect(out).toEqual({
      version: DASHBOARD_LAYOUT_VERSION,
      slots: [{ widgetId: 'a', order: 3, hideOn: ['thumb-phone'] }],
    })
  })

  it('returns undefined for non-layout input', () => {
    expect(coerceDashboardLayout(null)).toBeUndefined()
    expect(coerceDashboardLayout({})).toBeUndefined()
    expect(coerceDashboardLayout({ slots: 'x' })).toBeUndefined()
  })
})
