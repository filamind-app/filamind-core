# @filamind/core

The shared foundation of the FilaMind suite — **framework-agnostic TypeScript** consumed by FilaMind 3d
(web), FilaMind screen (touch), and FilaMind flow. Phase 0.

## What's here
| Module | Purpose |
| --- | --- |
| `provenance.ts` | `Stamped<T>` "never-lie" values (`value · ts · source · staleAfter`) + `isStale` / `freshness` |
| `state/observable.ts` | a tiny framework-agnostic observable (consumers bind it to Pinia/signals) |
| `state/printer.ts` | `PrinterState` — merge-patch from `notify_status_update`, **1 s coalescing + `motion_report` fast-path** |
| `moonraker/connector.ts` | the backend-agnostic `Connector` seam (Moonraker first; remote/others later) |
| `moonraker/client.ts` | `MoonrakerClient` — reconnecting JSON-RPC WS (**injectable socket**, backoff **+ jitter + max-attempts**), id-correlated, notify fan-out, re-subscribe on reconnect, **REST file channel** (`upload`/`download`) |
| `moonraker/subscriptions.ts` | the **versioned** canonical subscription contract — `NARROW_STATUS` / `FULL_CONTROL` tiers + `tier()` |
| `printer/klippy.ts` | the Klippy lifecycle (`ready`/`startup`/`shutdown`/`error`/`disconnected`) — tracked apart from the socket so a FIRMWARE_RESTART re-seeds instead of showing stale-as-live |
| `printer/prompt-parser.ts` | parses Klipper's `// action:prompt_*` protocol into structured modal dialogs (`PromptParser`) |
| `session/session.ts` | **`FilaMindSession`** — the orchestrator: staged init (identify → capabilities → query/seed → subscribe), routes `notify_*`, owns the Klippy-aware `live`/stale gate |
| `safety/write-arbiter.ts` | fail-closed **`WriteArbiter`** — the single chokepoint for every mutation; enforces safe-mode + a caller guard |
| `identity/machine.ts` | `deriveMachineId` → stable `fm-<hash>` from `machine.system_info` (the roaming-settings key) |
| `backup/restore-points.ts` | reversible, retention-bounded **`RestorePoints`** (back-up-first substrate for config/flash/migrate) |
| `observability/logger.ts` | pluggable ring-buffer `Logger` (the diagnostics-bundle source; replaces silent `catch {}`) |
| `registry/widget-registry.ts` | the cross-surface widget/plugin registry + `aggregateSubscriptions` |
| `theme/tokens.ts` | the exclusive Pharaonic themes (Tutankhamun · Horus · Anubis) as `--fm-*` design tokens |
| `i18n/locale-meta.ts` | the 19 shipped locales `{ code, name, rtl, dir }` + RTL list + CLDR `pluralCategory` (`Intl.PluralRules`) |
| `i18n/translator.ts` | framework-agnostic `translate` / `Translator` + the backend message-code contract (`resolveMessage`) |
| `i18n/locales/*.json` | drop-in catalogs (en + ar shipped as proof, incl. the full Arabic plural set) |
| `settings/settings.ts` | unified user settings (theme · locale · density · motif · reduced-motion): `SettingsStore` (patch/hydrate/reset/export/import), **`migrate()`** (versioned, enum-coercing — `import()` trusts no foreign JSON), `applySettings` (re-theme + RTL dir), persistence seam (Moonraker-DB / localStorage) |

## Wiring (the consumer entry point)
```ts
import { MoonrakerClient, FilaMindSession, FULL_CONTROL } from '@filamind/core'

const connector = new MoonrakerClient({ url: 'ws://printer.local:7125/websocket' })
const session = new FilaMindSession(connector, {
  subscriptions: FULL_CONTROL,
  identify: { client_name: 'FilaMind 3d', version: '0.1.0', type: 'web' },
})
await session.start()

// reactive, framework-agnostic — bind these to Pinia/signals/etc.
session.live.subscribe((v) => {/* dim the UI when not trustworthy-live */})
session.printer.objects.subscribe((o) => {/* render telemetry */})
session.prompt.subscribe((ev) => {/* show a Klipper modal */})
```

## Scripts
```bash
npm install
npm run type-check   # tsc --noEmit
npm test             # vitest (76 pure-logic tests)
npm run build        # tsup → dist/ (ESM + .d.ts)
```

## Notes
- Consumed by the suite apps (FilaMind 3d / screen / flow) via the workspace in development.
- Framework-agnostic on purpose: no Vue/React import in core. The reactive layer is a plain `Observable`;
  Vue/Pinia adapts it on the consumer side.
- Versions are pinned to current real latest-stable; bump deliberately at first real install.
- GPL-3.0-or-later. FilaMind's own — no third-party project named (R1).

## Credits

Built and maintained by the DeltaFabs team:

- abdelmonem awad - <eg2@live.com>
- Ahmed bebars - <Ahmedbebars1@gmail.com>
- Kareem Salama - <Golden.kiko@gmail.com>

## License

[GPL-3.0-or-later](LICENSE) © 2026 DeltaFabs team.
