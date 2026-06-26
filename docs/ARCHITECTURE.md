# Architecture

This is the design and data-flow deep dive for `@filamind-app/core` — the framework-agnostic
TypeScript library shared by the three FilaMind surfaces: **3d** (the web control UI), **screen**
(the touch panel), and the **flow** touch app. The [README](../README.md) is the short, user-facing
tour; this document is the technical depth behind it.

The guiding idea is **one core, many faces**. Every surface needs the same things — a live,
trustworthy connection to the printer; one model of its state; remembered settings; a theme; and a
translation layer — so those live here, once, with no UI framework imported anywhere. Each surface
binds the core's plain observable to its own reactivity (Vue/Pinia, signals, …) on its side.

---

## Design principles

- **Framework-agnostic.** Nothing in `src/` imports Vue or React. Reactivity is a tiny hand-written
  `Observable`; the consumer adapts it. This is enforced by review, not tooling, but it is the rule
  the whole library is shaped around.
- **Never lie.** Values the UI shows can be **provenance-stamped** with where they came from and when,
  and the session exposes a single `live` flag that is true only when the data is trustworthy. The UI
  dims, strikes, or disables anything that isn't.
- **Fail closed.** Every mutation funnels through one arbiter that refuses the write when state isn't
  trustworthy or safe-mode is on. There is no second path to the printer.
- **Injectable seams everywhere.** The WebSocket, the discovery probes, and the persistence backends
  are all injected, so the library is fully unit-tested without a real socket, printer, or browser.
- **Trust no foreign JSON.** Anything that crosses a trust boundary — persisted settings, the remote
  command bus, a `notify_*` payload — is parsed defensively: an unrecognised shape is coerced to a
  safe default or dropped, never trusted as-is.
- **Backend-agnostic transport.** Moonraker is the first-class implementation, but it sits behind a
  `Connector` seam so another backend (a remote tunnel, say) can slot in without the UI knowing.

---

## Module map

Everything is re-exported from a single entry point (`src/index.ts`); the modules below are the
internal layout.

### Transport — `moonraker/`

- **`client.ts` — `MoonrakerClient`.** A reconnecting JSON-RPC 2.0 client over one WebSocket. Requests
  are id-correlated with a per-request timeout (default 10 s); on close, every pending request is
  rejected so nothing hangs. Reconnect uses exponential backoff capped at a max, with ±20% jitter to
  de-synchronize reconnect storms across a fleet, and an optional max-attempts terminal state. The
  subscription set is remembered and **restored on every reconnect**. Binary traffic (uploads,
  downloads) goes over a separate REST file channel derived from the same base URL, keeping the
  WebSocket for control and telemetry. The `WebSocket` is injectable via `wsFactory`, which is how the
  reconnect and coalescing behaviour is tested deterministically.
- **`connector.ts` — the `Connector` seam.** The interface the rest of the core depends on:
  `connect`/`close`, `call`, `subscribe`, `upload`/`download`, and a callback set
  (`onUpdate`/`onConnectProgress`/`onError`/`onReconnected`). `MoonrakerClient` is one implementation;
  the session and senders only ever see this interface.
- **`discovery.ts` — `resolveMoonrakerUrl()`.** Zero-config endpoint discovery. It derives candidate
  `ws(s)://…/websocket` URLs from the page origin — same-origin reverse-proxy, the direct `:7125`
  port, and `localhost:7125` for the on-printer/Tauri webview case — and races short-lived probe
  sockets, resolving with the first to open and closing the rest. A runtime `override` short-circuits
  the race. Socket-injectable, so it too is tested without a real WebSocket.
- **`subscriptions.ts` — the versioned subscription contract.** Two canonical tiers,
  `NARROW_STATUS` (just enough to show state and progress, for ambient/farm views) and `FULL_CONTROL`
  (everything a daily-driver UI needs), plus `mergeSubscriptions()` with the **null-wins** merge rule
  (`null` means "all fields"). Surfaces compose a baseline tier with widget-declared needs rather than
  each inventing its own set.
- **`rpc-types.ts` — RPC type safety.** `RpcError` preserves the JSON-RPC `code` and `data` instead of
  flattening to a bare `Error`; `call()` has a typed overload over a `MoonrakerMethods` map for common
  methods (with the generic `call<T>()` still available); and `parseNotifyEvent()` turns positional
  `notify_*` params into a discriminated union so consumers narrow by event instead of hand-casting
  `unknown`.

### State — `state/` and `provenance.ts`

- **`observable.ts` — `Observable<T>`.** The entire reactive primitive: a current value, `subscribe`
  (which emits the current value immediately on attach), `set`, and `update`. This is the seam every
  surface adapts to its own framework.
- **`printer.ts` — `PrinterState`.** One normalized, reactive model merge-patched from
  `notify_status_update`. Updates are **coalesced on a 1 s timer** so the reactive layer isn't thrashed
  at Klipper's ~250 ms-per-object rate, with a **fast path** for `motion_report` so live toolhead
  position stays smooth. `seed()` resets from a `printer.objects.query` result; `flush()` forces any
  pending patch through (e.g. on tab focus). `deepMerge` recursively merges plain objects and replaces
  arrays/primitives.
- **`provenance.ts` — `Stamped<T>`.** A value plus `ts`, `source` (`live`/`cache`/`optimistic`/
  `unknown`), and an optional `staleAfter`. `isStale()` and `freshness()` turn that into a UI hint
  (`ok`/`stale`/`unknown`). Because Moonraker has no server timestamp, `ts` is the client clock at
  arrival. This is the "never lie" primitive widgets render against.

### Lifecycle & orchestration — `printer/` and `session/`

- **`klippy.ts`.** Klippy's lifecycle (`ready`/`startup`/`shutdown`/`error`/`disconnected`) is tracked
  **separately from the socket state** because a `FIRMWARE_RESTART` keeps the WebSocket open while
  Klipper drops and re-registers every object. Without this distinction a control surface would show
  stale data as live. `isKlippyLive()` is true only when Klippy is `ready`.
- **`prompt-parser.ts` — `PromptParser`.** Parses Klipper's `// action:prompt_*` g-code protocol out of
  the `notify_gcode_response` stream into structured modal dialogs (`PromptDialog` with `PromptButton`s)
  the UI can render.
- **`session.ts` — `FilaMindSession`.** The orchestrator that wires the isolated pieces into one working
  connection. It runs a **staged init**: identify → read `server.info` for capabilities and Klippy state
  → if Klippy is ready, `printer.objects.query` to seed → `subscribe`. It routes incoming `notify_*`
  methods (status updates into `PrinterState`, g-code responses into the `PromptParser`, agent events to
  an optional callback) and owns the Klippy-aware **`live`** gate. Crucially, it **re-bootstraps on
  reconnect and on `notify_klippy_ready`** — even when the socket never dropped — and guards that
  bootstrap so overlapping triggers can't interleave two seeds. The result is a single, honest `live`
  flag the UI can trust.

### Safety — `safety/`

- **`write-arbiter.ts` — `WriteArbiter`.** The single chokepoint every FilaMind-originated mutation
  (g-code, config write, setup action) passes through. `run(action, fn)` refuses with a `WriteRefused`
  error if safe-mode is on or the caller-supplied **guard** (e.g. "Klippy ready + connection live, not
  print-locked") rejects, and logs every write. It is the enforcement arm of provenance: if state isn't
  trustworthy, writes don't happen. The guard is supplied by the caller so the policy lives with the
  surface while the gate lives here.

### Settings & customization — `settings/`, `theme/`, `i18n/`

- **`settings/settings.ts` — `SettingsStore` and friends.** One unified user-settings model (`version`,
  `theme`, `locale`, `density`, `motifDensity`, `reducedMotion`, and an optional adaptive
  `dashboardLayout`). `migrate()` coerces any old/foreign/partial blob into valid settings — it
  validates every enum, drops unknown keys, and stamps the current version — and is used by both
  `hydrate()` and `import()` so no untrusted JSON is ever trusted. Persistence is a seam with three
  implementations: in-memory (tests), `localStorage`, and the **Moonraker database** (namespaced and
  machine-keyed) so a user's choices roam across every FilaMind surface on that printer. `roamSettings()`
  ties a local store to a shared remote one: pull the shared copy when the connection goes live, push
  local changes back. `applySettings()` applies the theme to the DOM and returns the text direction for
  the locale.
- **`theme/tokens.ts`.** The palette as `ThemeTokens`, emitted as `--fm-*` CSS custom properties so
  Tailwind and SVG charts read the same variables and one switch restyles everything. Five themes ship:
  three signature Pharaonic ones — **Tutankhamun** (the default), **Horus**, **Anubis** — plus neutral
  **light** and **dark**. A contrast test asserts every theme keeps body text ≥ 4.5:1 on its background.
- **`i18n/locale-meta.ts`.** The 19 shipped locales as `{ code, name, rtl, dir }`, the derived RTL list,
  and `pluralCategory()` via the platform's `Intl.PluralRules` (so Arabic, Russian, Polish, … get the
  right CLDR plural form).
- **`i18n/translator.ts`.** A framework-agnostic `translate()` / `Translator`: dotted-key lookup into a
  nested catalog, `{placeholder}` interpolation, and plural selection when an entry is a `{ one, other,
  … }` object and `params.count` is a number. Missing keys return the key itself so gaps are visible,
  never blank. `resolveMessage()` is the backend message-code contract — the server sends a `code` (plus
  optional params and a fallback string) and the UI translates it.
- **`i18n/locales/*.json`.** Drop-in catalogs; `en` and `ar` ship in the package as a working proof
  (including the full Arabic plural set). Adding a locale is a new folder, no code change.

### Registry & dashboard — `registry/`

- **`widget-registry.ts`.** Features (and, later, third-party plugins) register themselves with a
  `WidgetDefinition` without touching the core. Each declares which surfaces it targets (`'3d'` and/or
  `'screen'`), a lazy component loader (kept as `unknown` so the host framework resolves it), and its
  data needs. `aggregateSubscriptions()` unions the declared needs of the active widgets — with the same
  null-wins rule — so the connector subscribes once.
- **`dashboard-resolver.ts`.** One machine-keyed `DashboardLayout` definition plus a **pure** resolver
  that adapts it to each surface and viewport. `surfaceHint()` maps a surface + viewport width to
  `dense-desktop` / `thumb-phone` / `big-touch`; `resolveDashboard()` honours slot order, hides per-hint
  via `hideOn`, appends any registered widget the layout doesn't mention (so new widgets still appear),
  and returns the column count for the hint. `coerceDashboardLayout()` validates a persisted layout
  before it is ever used. The resolver never controls the emergency stop — the shells wire that in
  independently, always present, regardless of any layout.

### Remote control — `remote/`

A UI-only cross-surface command bus. One surface can tell another to navigate, show a message, or
flash to locate itself — **never** to move the printer.

- **`commands.ts`.** Defines the single agent-event name, the `RemoteCommand` union
  (`navigate`/`message`/`locate`), and **strict validators**. The bus is an open broadcast, so untrusted
  input is parsed defensively (unrecognised shapes yield `null`) and message text is sanitized — control
  and bidi characters stripped, clamped by code point so a surrogate pair is never split — before it can
  reach the DOM. `handleAgentCommand()` adds an optional best-effort sender allow-list; because
  `client_name` is self-asserted, this is defence-in-depth, which is exactly why these commands stay
  strictly UI-only.
- **`command-sender.ts` — `CommandSender`.** The sender side. Moonraker only lets connections that
  identified as `type: "agent"` call `connection.send_event`, so the bus rides its **own lightweight
  agent connection**, separate from a surface's main data session (which keeps its honest type, e.g.
  `"web"`). That isolation means a data-session blip can't drop the bus identity and vice-versa. The
  sender is single-flight on identify, re-identifies on every genuine reconnect, self-heals a transient
  identify failure with bounded backoff, and drops (never queues) a command issued while the bus is down
  so a stale "navigate" can't fire minutes later.

### Identity, backup, observability — `identity/`, `backup/`, `observability/`

- **`identity/machine.ts` — `deriveMachineId()`.** Moonraker has no single machine-uuid field, so a
  stable `fm-<hash>` is derived (FNV-1a, dependency-free) from a fixed subset of `machine.system_info`
  (hostname, CPU serial/desc, distribution). This is the roaming-settings, dashboard, and remote-control
  key. Falls back to `fm-unknown` when nothing stable is available.
- **`backup/restore-points.ts` — `RestorePoints`.** The reversible, retention-bounded "back up first"
  substrate that gates config saves, plugin installs, firmware flashes, and migrations. Snapshots are
  machine-keyed and pruned per scope (newest N kept), with a monotonic sequence so pruning is
  deterministic even when two snapshots share a millisecond. The store is a seam; an in-memory one ships
  for tests.
- **`observability/logger.ts` — `Logger`.** A pluggable, bounded **ring buffer** of recent events — the
  source the diagnostics bundle collects from, and the replacement for the silent `catch {}` swallows
  that would otherwise hide failures. `NULL_LOGGER` is the no-op default.

---

## Data flow

A connect-to-live walkthrough:

1. **Discover (optional).** `resolveMoonrakerUrl()` races candidate endpoints and returns the first that
   opens, or the caller passes an explicit URL.
2. **Connect.** `MoonrakerClient.connect()` opens the WebSocket. The first open resolves `start()`;
   subsequent opens are reconnects and fire `onReconnected`.
3. **Bootstrap.** `FilaMindSession.bootstrap()` identifies, reads `server.info` (capabilities + Klippy
   state). If Klippy isn't `ready`, `live` stays false and the session waits for `notify_klippy_ready`.
   If it is, the session queries the subscription set to **seed** `PrinterState`, subscribes, and sets
   `live = true`.
4. **Stream.** `notify_status_update` payloads are merge-patched into `PrinterState` (coalesced, with the
   `motion_report` fast path); `notify_gcode_response` lines feed the `PromptParser`; `notify_agent_event`
   payloads are validated and handed to the surface.
5. **Survive restarts.** On a Klippy shutdown/disconnect, `live` drops. On `notify_klippy_ready` — even
   with the socket still open — the session re-bootstraps (re-seed + re-subscribe). On a socket drop, the
   client reconnects with backoff+jitter, restores the remembered subscriptions, and the session
   re-bootstraps.
6. **Mutate.** Any write goes through `WriteArbiter.run()`, which checks safe-mode and the live-trust
   guard before letting the mutation through, and logs it.

The single `live` observable is what the UI binds its "is this data real?" state to; the single
`WriteArbiter` is what it binds its "can I act?" state to.

---

## Using the core

Beyond the [README quick start](../README.md#quick-start), the same patterns for the rest of the core:

**Settings, theming, and language**

```ts
import {
  SettingsStore, moonrakerDbPersistence, applySettings, deriveMachineId,
} from '@filamind-app/core'

const machineId = await deriveMachineId(connector)       // stable roaming key
const settings = new SettingsStore(moonrakerDbPersistence(connector))
await settings.hydrate()                                  // load over the defaults, migrated

settings.settings.subscribe((s) => {
  const { dir } = applySettings(s)                        // re-theme (--fm-*) + report text direction
  document.documentElement.setAttribute('dir', dir)
})

settings.patch({ theme: 'horus', locale: 'ar' })          // change + persist (and roam) in one call
```

**Registering a widget and subscribing once**

```ts
import { registerWidget, aggregateSubscriptions } from '@filamind-app/core'

registerWidget({
  id: 'temperatures',
  title: 'Temperatures',
  component: () => import('./TemperaturesWidget'),
  subscriptions: { extruder: null, heater_bed: null },
  targets: ['3d', 'screen'],
})

session.setSubscriptions(aggregateSubscriptions(['temperatures', /* …active ids */]))
```

**A UI-only remote command**

```ts
import { CommandSender, handleAgentCommand } from '@filamind-app/core'

// sender side (e.g. FilaMind 3d) — its own agent connection:
const bus = new CommandSender(agentConnector, { client_name: 'FilaMind 3d', version: '0.1.0', url })
await bus.start()
await bus.navigate('status')

// receiver side (e.g. FilaMind screen) — wire the session's agent events to a dispatcher:
new FilaMindSession(connector, {
  onAgentEvent: (ev) => handleAgentCommand(ev, (cmd) => dispatch(cmd), { allowFrom: ['FilaMind 3d'] }),
})
```

---

## Building, testing, and releasing

**Toolchain.** TypeScript in `strict` mode with `noUncheckedIndexedAccess`, `isolatedModules`, and
`verbatimModuleSyntax`. The build is [tsup](https://tsup.egoist.dev) over the single entry
(`src/index.ts`), emitting an **ESM-only** bundle plus `.d.ts` declarations to `dist/`. The package is
`type: module`, marked `sideEffects: false` for tree-shaking, and ships **no runtime dependencies** —
only `tsup`, `typescript`, and `vitest` as dev dependencies.

**Scripts.**

| Script | What it does |
| --- | --- |
| `npm run build` | `tsup src/index.ts --format esm --dts --clean` → `dist/` |
| `npm run dev` | the same, in watch mode |
| `npm run type-check` | `tsc --noEmit` (strict) |
| `npm test` | `vitest run` — 101 pure-logic tests across 13 files, no printer or browser needed |

**Tests.** Every networked seam is injectable, so the suite covers reconnect/backoff, coalescing,
discovery races, the staged bootstrap and re-seed, settings migration, the remote-command validators,
RPC typing, and the theme contrast guard — all without a real socket. Cover these paths with new tests
when you touch them.

**CI.** `.github/workflows/ci.yml` runs on every push and pull request (Node 20): `npm ci` →
`type-check` → `test` → `build` → the no-external-references guard. CI must be green to merge.

**The R1 no-external-references guard.** `scripts/check-no-external-refs.sh` greps `src/` for the names
of analyzed third-party UI/tooling projects and attribution phrases ("ported from", "inspired by",
"fork of", …) and fails the build if any appear. Klipper and Moonraker — the platform the library
integrates with — are allowed; lineage claims about other tools are not. Keep that rule in mind in
both code and docs.

**Releasing.** Bump the version and push a matching tag:

```bash
npm version patch        # or minor / major — commits and creates the vX.Y.Z tag
git push --follow-tags
```

`.github/workflows/release.yml` then builds, runs the tests, and publishes to npm **with provenance**
(OIDC) when an `NPM_TOKEN` secret is configured — otherwise it skips the publish (it doesn't fail) and
you publish manually with `npm publish --access public`. Either way it creates a GitHub Release whose
notes are pulled from the matching `## [version]` section of `CHANGELOG.md`, so the published text is
authored rather than generated from commits. Dependencies and actions are kept current by Dependabot
(weekly, grouped minor/patch).

---

## Conventions

- **One entry point.** Everything public is exported from `src/index.ts`; nothing reaches into a module
  path directly. New surface area gets added there with a short grouping comment.
- **Versioned, defensive boundaries.** Persisted settings, the dashboard layout, the subscription
  contract, and the remote-command protocol all carry a version and a coercer. Any blob crossing a trust
  boundary is validated, never trusted.
- **Provenance and the live gate are not optional.** Anything the UI shows should be expressible as
  trustworthy-or-not; anything that mutates the printer goes through the arbiter. There is deliberately
  no bypass.
- **No UI framework in core.** If a piece needs Vue/React, it belongs in a surface, not here.
- **English only, no lineage claims** (R1) — in code, comments, and docs alike.
