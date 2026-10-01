# opencode-tab-spinner

[![CI](https://github.com/dsaveliev/opencode-tab-spinner/actions/workflows/ci.yml/badge.svg)](https://github.com/dsaveliev/opencode-tab-spinner/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](#)
[![opencode plugin](https://img.shields.io/badge/opencode-plugin-8A2BE2.svg)](https://opencode.ai/docs/plugins)

An [opencode](https://opencode.ai) plugin that animates your terminal tab
title while the agent is working — the behavior Claude Code users know:
a spinner while the model runs, a check mark when it waits for you.

```
tab title while working:   ⠋ myproject  ⠙ myproject  ⠹ myproject …
tab title when idle:       ✓ myproject
```

Works with any OSC-capable terminal: **Ghostty**, Kitty, WezTerm, iTerm2,
xterm and friends. No configuration required.

## How it works

opencode plugins receive in-process session events. The plugin listens for
them and writes an OSC 0 title sequence to the TUI process's own `/dev/tty`
— so every tab is isolated for free, and the signal is exact:

- `session.status` busy/idle brackets every LLM call and gives an instant
  idle at turn end
- `message.part.delta` (the per-token stream) keeps the animation alive
  through reasoning and tool execution
- a trailing metadata update of your last message (arriving ~60 ms after
  the turn ends) is recognized and ignored — the spinner never resurrects
  after a finished turn

The signal contract was verified empirically against opencode 1.18.x and is
protected by 23 regression tests, several of them rehearsals of real
production incidents.

## Install

### Option A — global file install (recommended, verified)

```bash
git clone https://github.com/dsaveliev/opencode-tab-spinner ~/.config/opencode/opencode-tab-spinner
ln -s ~/.config/opencode/opencode-tab-spinner/src/tab-spinner.js \
      ~/.config/opencode/plugins/tab-spinner.js
```

Every opencode instance (any project, any launch method) picks it up.

### Option B — project-level install

```bash
mkdir -p .opencode/plugins
cp src/tab-spinner.js .opencode/plugins/
```

Scoped to that project only.

### Option C — npm registry (once published)

After the package is published to npm, add to `opencode.json(c)`:

```json
{ "plugin": ["opencode-tab-spinner"] }
```

> Verified limitation (opencode 1.18.x): the config `plugin` array resolves
> only **registry** packages. A `github:` install into the config-dir
> `node_modules` is silently skipped — use Option A until the package is on
> npm (or until opencode lifts this restriction).

## Configuration

Everything is optional environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `TAB_SPINNER_FRAMES` | `braille` | preset `braille` `dots` `ascii` `clock`, or explicit frames separated by spaces/commas |
| `TAB_SPINNER_IDLE` | `✓` | idle glyph |
| `TAB_SPINNER_FRAME_MS` | `120` | frame interval (20–2000) |
| `TAB_SPINNER_TITLE` | `{frame} {project}` | busy title template |
| `TAB_SPINNER_TITLE_IDLE` | `{idle} {project}` | idle title template |
| `TAB_SPINNER_SILENCE_MS` | `12000` | quiet threshold after which the animation pauses visually (200–120000) |
| `TAB_SPINNER_TTY` | `/dev/tty` | title sink (useful for tests) |
| `TAB_SPINNER_LOG` | off | full diagnostic journal file |
| `TAB_SPINNER_DEBUG` | off | `1` — terse stderr diagnostics |

Templates substitute `{frame}`, `{idle}`, `{project}`. All user-supplied
strings are sanitized: escape sequences are stripped so the title can never
be broken or injected.

Examples:

```bash
TAB_SPINNER_FRAMES=clock TAB_SPINNER_IDLE='●' oc
TAB_SPINNER_FRAMES='>> == --' TAB_SPINNER_TITLE='[{frame}] {project}' oc
TAB_SPINNER_TITLE_IDLE='{project} — done' oc
```

## Troubleshooting

Enable the diagnostic journal and read the decision trail
(`ARM` / `START` / `STOP` / `TITLE` lines with reasons):

```bash
TAB_SPINNER_LOG=/tmp/tab-spinner.log opencode
```

- **Spinner runs while nothing happens** — check the journal for
  `~ignored-dupe-user` and `STOP(status=idle)`; if events look sane, file an
  issue with the journal excerpt.
- **Spinner pauses during long thinking** — reasoning phases emit no events;
  raise `TAB_SPINNER_SILENCE_MS`.
- **Nothing appears** — your terminal must support OSC 0 titles (Ghostty,
  Kitty, WezTerm, iTerm2 do); check that the title is not overridden by your
  shell's own integration.

## Compatibility

Verified against opencode **1.18.x**. The plugin degrades gracefully:
unknown event shapes are ignored, an unavailable TTY never crashes headless
`opencode serve` / `opencode run`.

## Development

```bash
npm test        # node --test test/   (23 tests, no dependencies)
npm run check   # node --check src/tab-spinner.js
npm run pack:check
```

Manual e2e recipe (CI cannot drive opencode itself):

```bash
mkdir /tmp/e2e && cd /tmp/e2e
TAB_SPINNER_TTY=/tmp/title.bin opencode run 'reply: pong'
# /tmp/title.bin must contain spinner frames and end with the idle title
```

## License

MIT © Dmitrii Savelyev
