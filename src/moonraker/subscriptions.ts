// The ONE canonical, versioned subscription contract so every surface (web, touch,
// farm-status) requests the same baseline rather than inventing divergent sets.
// Widgets still add their own via aggregateSubscriptions(); these are the tiers.

import type { SubscriptionMap } from './connector'

export const SUBSCRIPTION_CONTRACT_VERSION = 1

/** Status-only tier (farm overview / ambient screen): the minimum to show state + progress. */
export const NARROW_STATUS: SubscriptionMap = {
  webhooks: ['state', 'state_message'],
  print_stats: ['state', 'filename', 'print_duration', 'total_duration', 'info'],
  virtual_sdcard: ['progress', 'is_active'],
  display_status: ['message', 'progress'],
  idle_timeout: ['state'],
}

/** Full-control tier (the daily-driver UI): everything a control surface needs. */
export const FULL_CONTROL: SubscriptionMap = {
  webhooks: ['state', 'state_message'],
  gcode_move: null,
  toolhead: null,
  motion_report: null,
  print_stats: null,
  virtual_sdcard: null,
  display_status: null,
  idle_timeout: ['state'],
  pause_resume: ['is_paused'],
  fan: null,
  configfile: ['settings', 'warnings', 'save_config_pending'],
}

export type SubscriptionTier = 'narrow' | 'full'

export function tier(t: SubscriptionTier): SubscriptionMap {
  return t === 'narrow' ? NARROW_STATUS : FULL_CONTROL
}

/** Union of subscription maps (`null` = "all fields" wins). The single source for the
 *  null-wins merge rule — consumers compose a baseline tier with widget-declared needs. */
export function mergeSubscriptions(...maps: SubscriptionMap[]): SubscriptionMap {
  const out: SubscriptionMap = {}
  for (const map of maps) {
    for (const key of Object.keys(map)) {
      const fields = map[key]
      if (out[key] === null || fields === null) out[key] = null
      else out[key] = Array.from(new Set([...(out[key] ?? []), ...(fields ?? [])]))
    }
  }
  return out
}
