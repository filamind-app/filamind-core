<div align="center">

# @filamind-app/core

The shared foundation of the FilaMind suite — one framework-agnostic TypeScript library
that talks to the printer, holds its state honestly, and looks the same everywhere.

**Built by Egyptian makers, for world makers. Happy printing.** 🇪🇬

A small-team hobby project, built and tested on real printers. The code is all here to read.

[![Support on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I2I119XEIV)

[![CI](https://github.com/filamind-app/filamind-core/actions/workflows/ci.yml/badge.svg)](https://github.com/filamind-app/filamind-core/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@filamind-app/core?color=111111&label=npm)](https://www.npmjs.com/package/@filamind-app/core)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-111111.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-111111?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Klipper](https://img.shields.io/badge/Klipper-compatible-111111)](https://www.klipper3d.org)
[![Moonraker](https://img.shields.io/badge/Moonraker-API-111111)](https://moonraker.readthedocs.io)

[Install](#install) · [What's inside](#whats-inside) · [Quick start](#quick-start) · [Tested on real printers](#tested-on-real-printers) · [Languages](#languages) · [Docs](#documentation) · [Support](#support)

</div>

`@filamind-app/core` is the shared core of the FilaMind suite. It is the one place that knows how
to open a Moonraker connection, keep printer state honest, remember a user's settings, theme the UI,
and translate it — so the three FilaMind surfaces (**3d** on the web, **screen** on a touch panel,
and the **flow** touch app) all behave the same way without copying that logic three times. It is
pure TypeScript with no UI framework inside: the reactive layer is a plain observable, and each
surface adapts it to Vue, signals, or whatever it uses. One core, many faces.

## Install

It is published to npm as `@filamind-app/core`:

```bash
npm install @filamind-app/core
```

The package is ESM-only and ships its own type declarations. It has **zero runtime dependencies** —
nothing is pulled in behind it. Inside the FilaMind suite it is consumed through the workspace during
development, so changes to the core are picked up by 3d, screen, and flow without a publish step.

## What's inside

| Piece | What it gives you |
| --- | --- |
| **Moonraker client** | A reconnecting JSON-RPC WebSocket plus a REST file channel, behind a backend-agnostic connector seam. Backs off with jitter, re-subscribes on reconnect, and times out stuck requests. |
| **Zero-config discovery** | Finds the printer's WebSocket for you by racing the likely endpoints; the first to open wins, and an explicit override always wins first. |
| **FilaMindSession** | The orchestrator. It connects, identifies, queries, subscribes, and routes every update into one place — and re-seeds itself after a firmware restart so the UI never shows stale data as live. |
| **Printer state** | One reactive, merge-patched model of the printer, coalesced so the UI isn't thrashed, with a fast path so live motion stays smooth. |
| **Provenance** | "Never-lie" stamped values that carry where they came from and when, so a widget can dim or strike anything that is stale or unknown. |
| **WriteArbiter** | A single fail-closed chokepoint every mutation passes through: if state isn't trustworthy, or safe-mode is on, the write is refused. |
| **Settings store** | One unified, persisted user-settings model (theme, language, density, motifs) that roams across every surface on the same printer, with strict versioned migration. |
| **Theme tokens** | The FilaMind palette as `--fm-*` CSS variables — three signature Pharaonic themes plus a neutral light and dark — so one switch restyles everything. |
| **i18n** | Metadata for 19 locales (including right-to-left), correct plural rules, and a tiny framework-agnostic translator that 3d, screen, and flow all share. |
| **Widget registry & dashboard** | Features register themselves without touching the core, declare which surfaces they target, and resolve into one adaptive dashboard per screen size. |
| **Remote control bus** | A UI-only command bus so one FilaMind surface can steer another (navigate, message, locate). It can never move the printer — those still go through the WriteArbiter. |
| **Backup, identity, logging** | Reversible restore points, a stable per-machine id, and a ring-buffer logger that feeds the diagnostics bundle. |

The full public surface is exported from a single entry point; the details of how each piece works
live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

```ts
import { MoonrakerClient, FilaMindSession, FULL_CONTROL } from '@filamind-app/core'

const connector = new MoonrakerClient({ url: 'ws://printer.local:7125/websocket' })
const session = new FilaMindSession(connector, {
  subscriptions: FULL_CONTROL,
  identify: { client_name: 'FilaMind 3d', version: '0.1.0', type: 'web' },
})
await session.start()

// reactive and framework-agnostic — bind these to Pinia, signals, or anything:
session.live.subscribe((live) => {/* dim the UI when the data isn't trustworthy-live */})
session.printer.objects.subscribe((objects) => {/* render telemetry */})
session.prompt.subscribe((dialog) => {/* show a Klipper modal */})
```

Don't know the printer's address? Let the core find it:

```ts
import { resolveMoonrakerUrl, MoonrakerClient } from '@filamind-app/core'

const url = await resolveMoonrakerUrl() // races the likely endpoints, first to open wins
const connector = new MoonrakerClient({ url })
```

There is a worked example for settings, theming, and adding a widget in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#using-the-core).

## Tested on real printers

The core is exercised by the FilaMind suite on two machines that disagree on almost everything that
matters to a control surface. The first is a Sovol SV08: an STM32F103 mainboard, TMC2209 drivers
over UART, a USB toolhead, and a BTT CB1 host. The second is a Voron-class CoreXY: an STM32H723
mainboard, six TMC5160 drivers on a shared software-SPI bus, a CAN toolhead, and a Raspberry Pi 4.
The pieces here that hurt to get wrong — the reconnect and re-seed logic, the Klippy-aware live gate,
the fail-closed write path — are the ones those two printers stress, and the library ships **101
pure-logic tests** that pin that behaviour down without needing a printer attached.

## How it's built

Pure TypeScript in `strict` mode, no UI framework imported anywhere in the core. Reactivity is a
small hand-written observable that each surface adapts to its own framework. Everything that touches
the network — the WebSocket, the discovery probes — is injectable, so the whole library is unit-tested
without a real socket. It builds to a single ESM bundle with type declarations via
[tsup](https://tsup.egoist.dev), and a CI guard keeps the published code free of any reference to
other projects. The deeper design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Languages

The core carries the suite's shared internationalization foundation: metadata for **19 locales**,
the correct CLDR plural rules for each, and a tiny translator that 3d, screen, and flow all use so
they translate identically. The catalogs themselves are drop-in JSON, one folder per locale — adding
a language needs no code change. English and Arabic (right-to-left, with the full Arabic plural set)
ship in the package as a working proof; the surfaces carry the rest.

| | | | |
| --- | --- | --- | --- |
| English | Español | 简体中文 (Simplified Chinese) | 日本語 (Japanese) |
| العربية (Arabic, RTL) | Français | 繁體中文 (Traditional Chinese) | 한국어 (Korean) |
| Deutsch (German) | Русский (Russian) | Português (Brasil) | Tiếng Việt (Vietnamese) |
| Italiano | Nederlands (Dutch) | Polski (Polish) | Bahasa Indonesia |
| Türkçe (Turkish) | Українська (Ukrainian) | हिन्दी (Hindi) | |

## Develop

```bash
npm install
npm run type-check   # tsc --noEmit (strict)
npm test             # vitest run (101 tests, 13 files)
npm run build        # tsup → dist/ (ESM + .d.ts)
```

`npm run dev` rebuilds on change. CI runs the type check, the tests, the build, and the
no-external-references guard on every push and pull request. Releases are cut by bumping the
version and pushing a matching `vX.Y.Z` tag; the workflow builds, publishes to npm (with provenance,
when a token is configured), and creates a GitHub Release from the changelog. The full contributor
and release flow is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#building-testing-and-releasing).

## Documentation

| Document | What's inside |
| -------- | ------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design, key modules, data flow, build/release internals, and conventions |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability privately |

## Support

`@filamind-app/core` is free and open source, built and maintained in spare time. If the suite it
powers saved you a tuning session, or you just want to see it grow, a coffee helps keep the work
going. Code, data, and ideas are just as welcome.

<div align="center">

[![Support on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I2I119XEIV)

</div>

## Credits

Built and maintained by the DeltaFabs team. **Built by Egyptian makers, for world makers.**

- Abdelmonem Awad - <eg2@live.com>
- Ahmed Bebars - <Ahmedbebars1@gmail.com>
- Kareem Salama - <Golden.kiko@gmail.com>

## License

[GPL-3.0-or-later](LICENSE) © 2026 DeltaFabs team.
