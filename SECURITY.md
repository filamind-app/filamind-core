# Security Policy

## Reporting a vulnerability

Please report security issues **privately** rather than opening a public issue.
Email the maintainers at <eg2@live.com> with a description, affected versions, and
reproduction steps. We aim to acknowledge within 7 days and to coordinate a fix and
disclosure timeline with you.

FilaMind software ultimately drives 3D-printer hardware through Klipper / Moonraker.
When reporting, please call out any path that could **move an axis, drive a heater,
or run gcode** without the core write-arbiter's *live + Klippy-ready* gate, as well as
anything affecting the Moonraker connection, agent command bus, or settings persistence.

## Supported versions

The latest released version receives security fixes. Before 1.0, only the most recent
minor line is supported.
