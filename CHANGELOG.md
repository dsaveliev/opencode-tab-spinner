# Changelog

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
