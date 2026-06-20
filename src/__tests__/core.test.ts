import { describe, it, expect } from 'vitest'
import { stamp, isStale, freshness, UNKNOWN } from '../provenance'
import { deepMerge, PrinterState } from '../state/printer'
import {
  registerWidget,
  aggregateSubscriptions,
  getWidgets,
  _resetRegistry,
} from '../registry/widget-registry'
import { themes, themeToCssVars } from '../theme/tokens'

describe('provenance', () => {
  it('fresh value is not stale', () => {
    const s = stamp(42, 'live', 1000, 0)
    expect(isStale(s, 500)).toBe(false)
    expect(freshness(s, 500)).toBe('ok')
  })
  it('goes stale after staleAfter', () => {
    const s = stamp(42, 'live', 1000, 0)
    expect(isStale(s, 1500)).toBe(true)
    expect(freshness(s, 1500)).toBe('stale')
  })
  it('unknown is always stale', () => {
    expect(isStale(UNKNOWN, 0)).toBe(true)
    expect(freshness(UNKNOWN)).toBe('unknown')
  })
})

describe('deepMerge', () => {
  it('merges nested plain objects, replaces arrays', () => {
    const a = { extruder: { temperature: 200, target: 200 }, toolhead: { axis: ['x'] } }
    const b = { extruder: { temperature: 210 }, toolhead: { axis: ['x', 'y'] } }
    expect(deepMerge(a, b)).toEqual({
      extruder: { temperature: 210, target: 200 },
      toolhead: { axis: ['x', 'y'] },
    })
  })
})

describe('PrinterState motion_report fast-path', () => {
  it('applies motion_report immediately, coalesces the rest', () => {
    const ps = new PrinterState(1000)
    ps.applyNotify([{ motion_report: { live_position: [1, 2, 3] }, extruder: { temperature: 205 } }])
    // fast-path applied now; slow patch is still pending until flush
    expect((ps.objects.value.motion_report as any).live_position).toEqual([1, 2, 3])
    expect(ps.objects.value.extruder).toBeUndefined()
    ps.flush()
    expect((ps.objects.value.extruder as any).temperature).toBe(205)
  })
})

describe('widget registry', () => {
  it('aggregates subscriptions (null wins, fields union)', () => {
    _resetRegistry()
    registerWidget({ id: 'a', title: 'A', component: async () => null, subscriptions: { toolhead: ['position'], fan: null } })
    registerWidget({ id: 'b', title: 'B', component: async () => null, subscriptions: { toolhead: ['homed_axes'] }, targets: ['screen'] })
    const agg = aggregateSubscriptions(['a', 'b'])
    expect(new Set(agg.toolhead as string[])).toEqual(new Set(['position', 'homed_axes']))
    expect(agg.fan).toBeNull()
    expect(getWidgets('3d').map((w) => w.id)).toEqual(['a']) // b is screen-only
  })
})

describe('themes', () => {
  it('every theme has a full token set + emits --fm-* vars', () => {
    for (const t of Object.values(themes)) {
      expect(t.primary).toMatch(/^#/)
      const vars = themeToCssVars(t)
      expect(vars['--fm-bg']).toBe(t.bg)
      expect(vars['--fm-primary-contrast']).toBe(t.primaryContrast)
    }
  })
})
