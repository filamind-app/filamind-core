# Changelog

All notable changes to `@filamind-app/core` are documented here. Format: `## [version]` sections (parsed by the release workflow).

## [0.1.4]

- **Per-surface adaptive dashboard** — a single machineUUID-keyed dashboard definition plus a pure resolver that adapts it to each surface + viewport: `surfaceHint(target, viewportWidth)` (`dense-desktop` / `thumb-phone` / `big-touch`), a `DashboardLayout` / `DashboardSlot` schema, and `resolveDashboard(layout, available, hint)` (honours slot order, appends widgets the layout doesn't mention, hides per-hint via `hideOn`, drops unknown ids, returns the column count for the hint). `coerceDashboardLayout()` validates persisted layouts; `UserSettings` gains an optional `dashboardLayout` carried through `migrate()` only when valid. Framework-agnostic, so every surface renders from the same source; never controls the emergency stop (shells wire that in independently).

## [0.1.3]

- **§18.3 — RPC type safety** — `RpcError` preserves the JSON-RPC `code` + `data` (no longer flattened to a bare `Error`); `call()` gains a typed overload over `MoonrakerMethods` (result types + method-name autocomplete for common methods; the generic `call<T>()` still works for any method); `NotifyEvent` + `parseNotifyEvent()` turn positional `notify_*` params into a discriminated union so consumers narrow by event instead of hand-casting `unknown`.

## [0.1.2]

- **F16 — zero-config endpoint discovery** — `resolveMoonrakerUrl()` races candidate `ws(s)://…/websocket` endpoints (same-origin reverse-proxy, direct `:7125`, localhost) and resolves with the first that opens; a runtime `override` always wins. `deriveCandidates()` exposed for callers. Socket-injectable (`wsFactory`) and fully unit-tested.

## [0.1.1]

- **Themes** — add two neutral themes (`light`, `dark`) alongside the three Pharaonic ones; `ThemeName` gains `'light' | 'dark'`. A WCAG contrast guard test asserts every theme keeps body text ≥ 4.5:1 on its background and text ≥ 3:1 on its primary.

## [0.1.0]

Initial release — the framework-agnostic foundation shared by FilaMind 3d, screen, and flow.

- **Provenance** — `Stamped<T>` never-lie values with staleness / freshness.
- **State** — a tiny observable + `PrinterState` (merge-patch from `notify_status_update`, 1 s coalescing + `motion_report` fast-path).
- **Moonraker** — a reconnecting JSON-RPC WebSocket client (injectable socket, backoff + jitter + max-attempts, id-correlated, re-subscribe on reconnect, REST file channel) behind a backend-agnostic connector seam; a versioned subscription contract.
- **Session & safety** — the `FilaMindSession` orchestrator with a Klippy-aware live/stale gate; a fail-closed `WriteArbiter` (single mutation chokepoint + safe-mode); the `action:prompt_*` parser.
- **Settings** — a unified settings store with versioned, enum-coercing `migrate()`, apply (re-theme + RTL), and a persistence seam (Moonraker DB / localStorage) for cross-surface roaming.
- **Themes & i18n** — three Pharaonic theme token sets; 19-locale metadata (RTL + CLDR plurals) and a framework-agnostic translator (en + ar catalogs as proof).
- **Remote** — a UI-only cross-surface command bus (navigate / message / locate) over Moonraker agent events (`CommandSender`); never a mutation path.
- **Identity, backup, observability** — a stable machine id; reversible restore points; a ring-buffer logger; the widget / plugin registry.
