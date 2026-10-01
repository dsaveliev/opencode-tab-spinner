# Spec: opencode-tab-spinner

Status: IMPLEMENTED — v1.0.0 shipped 2026-10-01. Amendments:
- plugin loader requires every export to be a plugin factory →
  test surface attached as TabSpinner properties (single file kept);
- user message arms the gate only (run-mode straggler fix);
- config-array resolves registry packages only on 1.18.x (README C).

## Objective

A production-grade opencode plugin that animates the terminal tab title while
an opencode session is working — the behavior Claude Code users know: a
spinner while the agent runs, a check mark when it waits for input.

**Target users.** opencode CLI users on OSC-capable terminals (Ghostty,
Kitty, WezTerm, iTerm2, modern xterm). Install-and-forget: no configuration
required, everything customizable via environment variables.

**Why a plugin.** The title channel is owned by the process that runs in the
tab. A plugin runs inside the opencode TUI process and receives in-process
session events — the only reliable busy signal (verified empirically on
opencode 1.18.x; the SSE `/event` endpoint does not carry message events, and
the database commits too coarsely).

**Success looks like:**
- `"plugin": ["opencode-tab-spinner"]` in opencode config — installed, working
- Zero runtime dependencies, single source file
- All verified signal-contract lessons covered by regression tests
- Published to npm and GitHub with CI

## Tech Stack

- Plain ESM JavaScript. Runtime dependencies: none (`node:fs` only).
- Runs inside opencode's embedded Bun runtime; tests run on Node >= 18
  using the built-in `node:test` runner (no dev dependencies).
- npm as the distribution package; GitHub for source and CI.

## Commands

```
Test:        node --test test/
Syntax gate: node --check src/tab-spinner.js
Pack check:  npm pack --dry-run        (verifies shipped file list)
Release:     npm publish               (manual, CI must be green)
```

No build step: the source ships as-is.

## Project Structure

```
src/tab-spinner.js        → the entire plugin runtime (single file)
test/*.test.js            → node:test suites, one per concern:
                             signals, state machine, config env,
                             sanitization, headless guard
.github/workflows/ci.yml  → node matrix 18/20/22, node --test
SPEC.md                   → this document
README.md                 → install (npm + file), env reference, troubleshooting
CHANGELOG.md              → semver, starts at 1.0.0
LICENSE                   → MIT
package.json              → name opencode-tab-spinner, exports map
```

The plugin file is named `src/tab-spinner.js` (referenced by both
`package.json` main/exports and the file-install symlink path documented in
README).

## Code Style

English comments and docs. ESM. Named + default export of the plugin factory.
`const`-first, small pure helpers, no classes, no dependencies.

```js
// Verified signal contract (opencode 1.18.x):
//   session.status {status:{type:"busy"|"idle"}} — flaps per LLM call;
//   a trailing update of the OLD user message arrives ~60ms after turn
//   end and MUST NOT re-arm the animation (compare info.id).

export const TabSpinner = async ({ directory }) => {
  const project = sanitize(basename(directory))
  return {
    event: async ({ event }) => { /* dispatch on event.type */ },
  }
}
export default TabSpinner
```

## Configuration Surface (env)

| Variable | Default | Meaning |
|---|---|---|
| `TAB_SPINNER_TTY` | `/dev/tty` | title sink (tests write to a file) |
| `TAB_SPINNER_SILENCE_MS` | `12000` | quiet threshold (reasoning phases) |
| `TAB_SPINNER_FRAMES` | `braille` | preset `braille`/`dots`/`ascii`/`clock` or explicit frames separated by spaces or commas |
| `TAB_SPINNER_IDLE` | `✓` | idle glyph |
| `TAB_SPINNER_FRAME_MS` | `120` | frame interval |
| `TAB_SPINNER_TITLE` | `{frame} {project}` | busy title template |
| `TAB_SPINNER_TITLE_IDLE` | `{idle} {project}` | idle title template |
| `TAB_SPINNER_LOG` | (off) | full diagnostic journal file |
| `TAB_SPINNER_DEBUG` | (off) | `1` → terse stderr diagnostics |

All user-supplied strings (frames, glyphs, templates, project name) are
sanitized: ESC and BEL characters are stripped so the OSC 0 sequence can
never be broken or injected. Invalid values fall back to defaults.

## State Machine (behavioral contract)

```
ARM:    session.status busy  |  message.updated role=user with a NEW info.id
START:  message.* events while armed (stragglers after a stop are ignored
        until the next ARM)
STOP+DISARM: session.status idle | session.idle | session.error  (instant)
STOP (visual only, gate stays armed): silence > SILENCE_MS — the model
        produces no events during reasoning; first delta restarts instantly
```

## Testing Strategy

- `node:test`, tests in `test/`, no external runner or dev dependencies.
- **Unit (all CI):** state machine transitions, dupe-user guard, silence
  semantics, env parsing/validation/sanitization, headless guard (unwritable
  TTY never throws), project-name fallback.
- **Manual e2e (documented recipe, not CI):** `TAB_SPINNER_TTY=/tmp/x
  opencode run 'reply: pong'` in a scratch directory must produce frames and
  a final idle title. CI cannot drive opencode itself.
- Any change to signal handling must keep every existing regression case
  green — the cases encode four production incidents.

## Boundaries

- **Always:** `node --test` green before every commit; zero runtime and dev
  dependencies; plugin stays a single source file; TDD for behavior changes;
  headless (`opencode serve`/`run` without a TTY) never crashes.
- **Ask first:** adding any dependency (runtime or dev); changing default
  env values; changing state-machine semantics; npm publish; changing CI.
- **Never:** weaken the verified signal contract (the four lessons below);
  delete or weaken a regression test to make a change pass; commit build
  artifacts or the diagnostic log; ship without the sanitization guard.

### The four verified lessons (regression-protected)

1. SSE `/event` carries no busy signal in 1.18.x — never rely on it.
2. `session.status` flaps per LLM call, not per turn; `session.idle` may lag.
3. A trailing update of the old user message (~60ms after turn end) must not
   re-arm — arm only on a new `info.id`.
4. Reasoning phases emit no events; silence must stop the animation visually
   but must NOT disarm the gate.

## Success Criteria

- [ ] `node --test` green locally and in CI on Node 18/20/22
- [ ] `npm pack --dry-run` ships exactly: src/, README, LICENSE, CHANGELOG,
      package.json (no test/, no .github/)
- [ ] Scratch-config install via `"plugin": ["opencode-tab-spinner"]` loads
      and animates (manual e2e recipe executed and documented)
- [ ] All 15 existing regression cases migrated to `node:test` and green,
      plus new cases for env parsing and sanitization of user strings
- [ ] README (English): npm install, file install, env table, troubleshooting
- [ ] MIT LICENSE, CHANGELOG 1.0.0, package.json with exports map
- [ ] GitHub Actions workflow: matrix test + syntax gate

## Open Questions

- GitHub repository URL and npm ownership (`opencode-tab-spinner` assumed
  unscoped and available; to be verified at publish time).
- Migration commit language: history is in Russian; keep as-is (git history
  is immutable context) — only new commits are English. Confirm.
