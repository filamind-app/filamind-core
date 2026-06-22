// Per-surface adaptive dashboard (§12.2 flagship): ONE machineUUID-keyed layout DEFINITION that a
// RESOLVER adapts to each surface + viewport - dense-desktop / thumb-phone / big-touch - so the 3d
// and screen surfaces render from the same source ("one core, many faces"). The resolver is pure:
// it orders + filters the registered widgets for a hint; it NEVER controls E-STOP (the shells wire
// that in, always present, regardless of any layout).

import type { SurfaceTarget, WidgetDefinition } from './widget-registry'

export type SurfaceHint = 'dense-desktop' | 'thumb-phone' | 'big-touch'

/** Grid columns per hint - the host maps this onto its CSS grid. */
const COLUMNS: Record<SurfaceHint, number> = {
  'dense-desktop': 3,
  'thumb-phone': 1,
  'big-touch': 2,
}

/** Derive the layout hint from the surface + viewport width (px). The touch screen is always
 *  big-touch; the 3d web UI is dense on wide viewports and a single thumb column when narrow. */
export function surfaceHint(target: SurfaceTarget, viewportWidth: number): SurfaceHint {
  if (target === 'screen') return 'big-touch'
  return viewportWidth < 640 ? 'thumb-phone' : 'dense-desktop'
}

/** One slot in the shared dashboard definition. */
export interface DashboardSlot {
  widgetId: string
  /** ascending display order; slots without it sort after ordered ones */
  order?: number
  /** hide this widget on these hints (e.g. a dense-only widget hidden on thumb-phone) */
  hideOn?: SurfaceHint[]
}

/** The single serializable dashboard definition (persisted in UserSettings, machineUUID-keyed). */
export interface DashboardLayout {
  version: number
  slots: DashboardSlot[]
}

export const DASHBOARD_LAYOUT_VERSION = 1

export interface ResolvedDashboard {
  hint: SurfaceHint
  columns: number
  /** the widgets to render, in order, already filtered for this hint */
  widgets: WidgetDefinition[]
}

const HINTS: readonly SurfaceHint[] = ['dense-desktop', 'thumb-phone', 'big-touch']

/**
 * Adapt one layout definition + the available widgets to a surface hint.
 *
 * Slots are honoured first (ordered, minus those hidden on this hint); any registered widget the
 * layout doesn't mention is appended (so newly added widgets still appear). A widget a slot hides
 * on this hint stays hidden even though it is available. With no layout, all available widgets
 * render in registry order.
 */
export function resolveDashboard(
  layout: DashboardLayout | undefined,
  available: WidgetDefinition[],
  hint: SurfaceHint,
): ResolvedDashboard {
  const byId = new Map(available.map((w) => [w.id, w]))
  const slots = layout?.slots ?? []
  const hiddenHere = new Set(
    slots.filter((s) => (s.hideOn ?? []).includes(hint)).map((s) => s.widgetId),
  )
  const used = new Set<string>()
  const widgets: WidgetDefinition[] = []
  for (const slot of [...slots]
    .filter((s) => !(s.hideOn ?? []).includes(hint))
    .sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY))) {
    const w = byId.get(slot.widgetId)
    if (w && !used.has(w.id)) {
      widgets.push(w)
      used.add(w.id)
    }
  }
  for (const w of available) {
    if (!used.has(w.id) && !hiddenHere.has(w.id)) widgets.push(w)
  }
  return { hint, columns: COLUMNS[hint], widgets }
}

/** Coerce an arbitrary blob into a valid DashboardLayout, or undefined. Used by settings migrate. */
export function coerceDashboardLayout(raw: unknown): DashboardLayout | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.slots)) return undefined
  const slots: DashboardSlot[] = []
  for (const item of r.slots) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    if (typeof s.widgetId !== 'string' || !s.widgetId) continue
    const slot: DashboardSlot = { widgetId: s.widgetId }
    if (typeof s.order === 'number' && Number.isFinite(s.order)) slot.order = s.order
    if (Array.isArray(s.hideOn)) {
      const hideOn = s.hideOn.filter((h): h is SurfaceHint => HINTS.includes(h as SurfaceHint))
      if (hideOn.length) slot.hideOn = hideOn
    }
    slots.push(slot)
  }
  return { version: DASHBOARD_LAYOUT_VERSION, slots }
}
