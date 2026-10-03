# Changelog

## 1.1.0 — 2026-10-03

Dialog glyphs in the tab title: an open question or tool-confirmation
dialog is now visible at a glance.

- `? project` while the question tool waits for your answer
  (`question.asked` → `question.replied|rejected`)
- `! project` while a tool confirmation dialog is open
  (`permission.asked` → `permission.replied`); `?` wins when both are open
- The animation freezes for the duration of the dialog; the idle glyph
  never overwrites the dialog glyph across the per-LLM-call idle flaps
- Defensive `ASK-CLEAR`: an interrupted question tool publishes no close
  event — a stale glyph is reset by your next message or a session error
- New env vars: `TAB_SPINNER_QUESTION` (`?`), `TAB_SPINNER_PERMISSION` (`!`),
  `TAB_SPINNER_TITLE_QUESTION` (`{question} {project}`),
  `TAB_SPINNER_TITLE_PERMISSION` (`{permission} {project}`); templates gain
  the `{question}` / `{permission}` tokens; all sanitized as before
- Event shapes verified against opencode 1.18.31 source
  (`question/index.ts`, `permission/index.ts`, `plugin/index.ts`)
- Tests 41/41 (new: 12 dialog cases + 3 config cases)

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
