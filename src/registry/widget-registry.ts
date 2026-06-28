// The widget/plugin registry: features (and, later, third-party plugins) register
// themselves without touching the core. Cross-surface: a widget declares which
// surfaces it targets ('3d' and/or 'screen'); the dashboard aggregates declared
// subscriptions so the connector subscribes once.

import type { SubscriptionMap } from '../moonraker/connector'

export type SurfaceTarget = '3d' | 'screen'

export interface WidgetDefinition {
  id: string
  title: string
  icon?: string
  description?: string
  /** lazy component loader - the host framework (Vue) resolves it (kept as `unknown` here) */
  component: () => Promise<unknown>
  defaultSize?: { w: number; h: number }
  /** declared data needs, aggregated across active widgets to subscribe once */
  subscriptions?: SubscriptionMap
  /** which surfaces this widget renders on (default: both) */
  targets?: SurfaceTarget[]
}

const registry = new Map<string, WidgetDefinition>()

export function registerWidget(def: WidgetDefinition): void {
  if (registry.has(def.id)) throw new Error(`duplicate widget id: ${def.id}`)
  registry.set(def.id, def)
}

export function getWidget(id: string): WidgetDefinition | undefined {
  return registry.get(id)
}

export function getWidgets(target?: SurfaceTarget): WidgetDefinition[] {
  const all = [...registry.values()]
  if (!target) return all
  return all.filter((w) => !w.targets || w.targets.includes(target))
}

/** The union of the given widgets' declared subscriptions (subscribe once). */
export function aggregateSubscriptions(ids: string[]): SubscriptionMap {
  const out: SubscriptionMap = {}
  for (const id of ids) {
    const subs = registry.get(id)?.subscriptions
    if (!subs) continue
    for (const obj of Object.keys(subs)) {
      const fields = subs[obj]
      if (fields === null || out[obj] === null) {
        out[obj] = null // null wins - "all fields"
      } else {
        out[obj] = Array.from(new Set([...(out[obj] ?? []), ...(fields ?? [])]))
      }
    }
  }
  return out
}

/** Test/host helper - clear the registry. */
export function _resetRegistry(): void {
  registry.clear()
}
