# Changelog

## 1.0.1 — 2026-10-01

Hardening pass (4-axis review + improve-codebase-architecture skill scan).

- Title-writer adapter: held fd across frames (no per-frame open/close),
  dedup on successful writes only, permanent disable after 10 consecutive
  failures — a dead TTY never leaves a spinning writer behind
- `timer.unref()` — the plugin can never hold the host event loop open
- Event handler wrapped in try/catch: a hostile payload is logged as
  HANDLER-ERROR instead of throwing into the host's dispatch
- Test isolation: suites reset all TAB_SPINNER_* variables (user shell
  exports no longer leak into tests)
- Tests 26/26 (new: dead-writer guard, hostile payload)

## 1.0.0 — 2026-10-01

First public release.

- Spinner in the terminal tab title while an opencode session works;
  idle glyph when it waits for input (Claude Code style)
- Signal contract verified against opencode 1.18.x: per-call
  session.status boundaries, per-token deltas, duplicate-user-message
  guard, reasoning-silence handling — all regression-tested (23 cases)
- Frame presets (braille, dots, ascii, clock) and full title templates
  via environment variables; ESC/BEL sanitization of every string
- Headless-safe: `opencode serve` / `opencode run` never crash
- Zero runtime dependencies, single-file source, MIT license
