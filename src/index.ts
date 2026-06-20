// @filamind-app/core — public surface (Phase 0 foundation).

// provenance ("never lie")
export { stamp, isStale, freshness, UNKNOWN } from './provenance'
export type { Stamped, Source } from './provenance'

// reactivity (framework-agnostic)
export { Observable } from './state/observable'
export type { Listener } from './state/observable'

// printer state model
export { PrinterState, deepMerge } from './state/printer'
export type { PrinterObjects } from './state/printer'

// Moonraker transport (behind a connector seam)
export { MoonrakerClient } from './moonraker/client'
export type { MoonrakerClientOptions, WebSocketLike } from './moonraker/client'
export type {
  Connector,
  ConnectorCallbacks,
  ConnectionState,
  SubscriptionMap,
} from './moonraker/connector'
export {
  SUBSCRIPTION_CONTRACT_VERSION,
  NARROW_STATUS,
  FULL_CONTROL,
  tier,
  mergeSubscriptions,
} from './moonraker/subscriptions'
export type { SubscriptionTier } from './moonraker/subscriptions'

// Klippy lifecycle + g-code prompt parsing
export { deriveKlippyState, isKlippyLive } from './printer/klippy'
export type { KlippyState } from './printer/klippy'
export { PromptParser } from './printer/prompt-parser'
export type { PromptEvent, PromptDialog, PromptButton } from './printer/prompt-parser'

// session orchestrator (staged init + Klippy-aware live/stale gating)
export { FilaMindSession } from './session/session'
export type { SessionOptions, IdentifyInfo } from './session/session'

// safety: write-arbiter + safe-mode gate
export { WriteArbiter, WriteRefused } from './safety/write-arbiter'
export type { WriteGuard } from './safety/write-arbiter'

// machine identity (stable roaming key)
export { deriveMachineId, fnv1a } from './identity/machine'

// reversible restore points (back-up-first substrate)
export { RestorePoints, memoryRestoreStore } from './backup/restore-points'
export type { RestorePoint, RestoreStore } from './backup/restore-points'

// observability (ring-buffer logger)
export { Logger, NULL_LOGGER } from './observability/logger'
export type { LogLevel, LogEntry } from './observability/logger'

// widget / plugin registry (cross-surface)
export {
  registerWidget,
  getWidget,
  getWidgets,
  aggregateSubscriptions,
  _resetRegistry,
} from './registry/widget-registry'
export type { WidgetDefinition, SurfaceTarget } from './registry/widget-registry'

// Pharaonic design tokens
export {
  themes,
  DEFAULT_THEME,
  themeToCssVars,
  applyTheme,
} from './theme/tokens'
export type { ThemeTokens, ThemeName } from './theme/tokens'

// i18n (shared 19-locale foundation)
export {
  LOCALES,
  DEFAULT_LOCALE,
  RTL_LOCALES,
  localeMeta,
  isRtl,
  pluralCategory,
} from './i18n/locale-meta'
export type { LocaleMeta, PluralCategory } from './i18n/locale-meta'
export {
  translate,
  Translator,
  resolveMessage,
} from './i18n/translator'
export type { Catalog, Params, BackendMessage } from './i18n/translator'

// cross-surface remote control (UI-only command bus over Moonraker agent events)
export {
  FILAMIND_COMMAND_EVENT,
  REMOTE_VIEWS,
  REMOTE_MESSAGE_LEVELS,
  parseCommand,
  parseAgentEvent,
  handleAgentCommand,
} from './remote/commands'
export type { RemoteCommand, RemoteView, RemoteMessageLevel, AgentEvent, AgentAllow } from './remote/commands'
export { CommandSender } from './remote/command-sender'
export type { CommandSenderOptions } from './remote/command-sender'

// unified settings & customization (theme + language switch + prefs, persisted)
export {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  SettingsStore,
  applySettings,
  migrate,
  memoryPersistence,
  localStoragePersistence,
  moonrakerDbPersistence,
  roamSettings,
} from './settings/settings'
export type { UserSettings, SettingsPersistence } from './settings/settings'
