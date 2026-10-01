// opencode-tab-spinner — animates the terminal tab title while an opencode
// session is working, like Claude Code: spinner frames while the agent runs,
// an idle glyph when it waits for input.
//
// The plugin runs inside the opencode TUI process and receives in-process
// session events — the only reliable busy signal. The title is written as an
// OSC 0 sequence (ESC ]0;...BEL) to the process's own /dev/tty, so every tab
// is isolated for free. Works with any OSC-capable terminal (Ghostty, Kitty,
// WezTerm, iTerm2, xterm). Writes to an unavailable TTY are silently skipped
// (headless `opencode serve` / `opencode run` never crash).
//
// Signal contract (verified empirically against opencode 1.18.x):
//   session.status {status:{type:"busy"|"idle"}} — flaps at EVERY LLM-call
//     boundary (not per turn); provides an instant idle at turn end, while
//     session.idle may lag behind its idle timer;
//   message.part.delta — per-token stream; also flows during tool execution;
//     silent only during reasoning phases (~10-30s);
//   message.updated with role=user and a NEW info.id — turn start. A
//     trailing update of the OLD user message arrives ~60ms after turn end
//     (opencode refreshes message metadata) and MUST NOT re-arm — hence the
//     lastUserId guard;
//   session.idle / session.error — fallback stops.
//
// State machine:
//   ARM:         status busy (arms AND starts) | user message with a new id
//                (arms the gate only — a real turn is confirmed by busy or
//                deltas; trailing metadata updates must not resurrect)
//   START:       message.* events while armed (stragglers after a stop are
//                ignored until the next ARM)
//   STOP+DISARM: status idle | session.idle | session.error (instant)
//   STOP visual: silence > silenceMs — reasoning produces no events, so the
//                gate stays armed and the first delta restarts instantly
//
// Configuration (environment variables, all optional):
//   TAB_SPINNER_FRAMES      preset name (braille|dots|ascii|clock) or explicit
//                           frames separated by spaces/commas   [braille]
//   TAB_SPINNER_IDLE        idle glyph                           [✓]
//   TAB_SPINNER_FRAME_MS    frame interval, 20..2000             [120]
//   TAB_SPINNER_TITLE       busy title template                   [{frame} {project}]
//   TAB_SPINNER_TITLE_IDLE  idle title template                   [{idle} {project}]
//   TAB_SPINNER_SILENCE_MS  quiet threshold, 1000..120000        [12000]
//   TAB_SPINNER_TTY         title sink (tests write to a file)   [/dev/tty]
//   TAB_SPINNER_LOG         full diagnostic journal file         [off]
//   TAB_SPINNER_DEBUG       "1" — terse stderr diagnostics       [off]
// All user-supplied strings are sanitized: ESC/BEL are stripped so the OSC
// sequence can never be broken; invalid values fall back to defaults.

import { appendFileSync, closeSync, openSync, statSync, writeFileSync, writeSync } from "node:fs"

const PRESETS = {
  braille: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  dots: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
  ascii: ["|", "/", "-", "\\"],
  clock: ["◐", "◓", "◑", "◒"],
}

// Strip complete escape sequences (CSI, OSC) and stray ESC/BEL so that
// user-supplied strings can never break out of the OSC 0 title sequence.
const stripCtl = (s) => String(s)
  .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
  .replace(/[\x1b\x07]/g, "")

const num = (raw, fallback, min, max) => {
  const n = Number(raw)
  return raw !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

function parseConfig(env = process.env) {
  const rawFrames = stripCtl(env.TAB_SPINNER_FRAMES ?? "").trim()
  let frames = PRESETS.braille
  if (PRESETS[rawFrames]) {
    frames = PRESETS[rawFrames]
  } else if (rawFrames) {
    const custom = rawFrames.split(/[\s,]+/).filter(Boolean)
    if (custom.length >= 2) frames = custom
  }
  return {
    frames,
    idle: stripCtl(env.TAB_SPINNER_IDLE ?? "") || "✓",
    frameMs: num(env.TAB_SPINNER_FRAME_MS, 120, 20, 2000),
    silenceMs: num(env.TAB_SPINNER_SILENCE_MS, 12000, 200, 120000),
    titleBusy: stripCtl(env.TAB_SPINNER_TITLE ?? "") || "{frame} {project}",
    titleIdle: stripCtl(env.TAB_SPINNER_TITLE_IDLE ?? "") || "{idle} {project}",
    tty: stripCtl(env.TAB_SPINNER_TTY ?? "") || "/dev/tty",
    log: stripCtl(env.TAB_SPINNER_LOG ?? ""),
    debug: env.TAB_SPINNER_DEBUG === "1",
  }
}

function renderTemplate(tpl, vars) {
  return tpl.replace(/\{(frame|idle|project)\}/g, (_, key) => vars[key])
}

const BUSY_EVENTS = new Set(["message.part.delta", "message.part.updated", "message.updated"])

const dbg = (enabled, m) => { if (enabled) console.error(`[tab-spinner] ${m}`) }

function makeLogger(file) {
  if (!file) return () => {}
  try {
    if (statSync(file).size > 512 * 1024) writeFileSync(file, "")
  } catch { /* file does not exist yet — fine */ }
  return (type, sid, extra = "") => {
    try { appendFileSync(file, `${Date.now()} pid=${process.pid} ${type}${extra} ${sid}\n`) } catch {}
  }
}

// The one real seam of this module: everything that touches the terminal.
// Holds the fd open across frames, dedups successful writes, and disables
// itself permanently after MAX_FAILURES consecutive failures so a dead TTY
// (headless run, closed tab) never leaves a spinning writer behind.
function makeTitleWriter(cfg, logEvent, dbg) {
  const MAX_FAILURES = 10
  let fd = null
  let lastTitle = ""
  let failures = 0
  let disabled = false

  const write = (text) => {
    if (disabled) return
    if (text === lastTitle) return // a burst of idles writes one idle title
    try {
      if (fd === null) fd = openSync(cfg.tty, "a")
      writeSync(fd, `\x1b]0;${text}\x07`)
      failures = 0
      lastTitle = text
      logEvent("TITLE", "-", `='${text}'`)
    } catch (e) {
      failures++
      if (fd !== null) {
        try { closeSync(fd) } catch {}
        fd = null // force a reopen: the old fd may be stale
      }
      if (failures >= MAX_FAILURES) {
        disabled = true
        logEvent("WRITER-DISABLED", "-", `(${failures} consecutive failures)`)
        dbg(cfg.debug, `title writer disabled after ${failures} failures: ${e.message}`)
      }
    }
  }
  write.isDisabled = () => disabled
  return write
}

export const TabSpinner = async ({ directory }) => {
  const cfg = parseConfig()
  const logEvent = makeLogger(cfg.log)
  dbg(cfg.debug, `loaded, directory=${directory}, tty=${cfg.tty}`)

  const parts = String(directory ?? "").split("/").filter(Boolean)
  const project = stripCtl(parts[parts.length - 1] || "opencode")

  const title = makeTitleWriter(cfg, logEvent, (m) => dbg(cfg.debug, m))

  const busyTitle = (frame) => renderTemplate(cfg.titleBusy, { frame, idle: cfg.idle, project })
  const idleTitle = () => renderTemplate(cfg.titleIdle, { frame: "", idle: cfg.idle, project })

  let timer = null
  let frame_i = 0
  let armed = true
  let lastBusyAt = 0
  let lastUserId = "" // trailing updates of the old user message are not a new turn

  const start = () => {
    if (title.isDisabled()) return // dead TTY: never spin a dead writer
    lastBusyAt = Date.now()
    if (timer) return
    frame_i = 0
    logEvent("START", "-")
    timer = setInterval(() => {
      if (Date.now() - lastBusyAt > cfg.silenceMs) {
        stop("silence", false) // visual stop only: the gate stays armed
        return
      }
      title(busyTitle(cfg.frames[frame_i]))
      frame_i = (frame_i + 1) % cfg.frames.length
    }, cfg.frameMs)
    // Never hold the host process open: if opencode tears down without a
    // stop event, the unref'd timer dies with the event loop.
    if (typeof timer.unref === "function") timer.unref()
  }

  const stop = (reason, disarm = true) => {
    if (timer) {
      clearInterval(timer)
      timer = null
      logEvent("STOP", "-", `(${reason}${disarm ? ",disarm" : ""})`)
    }
    if (disarm) armed = false
    title(idleTitle())
  }

  return {
    event: async ({ event }) => {
      // A hostile payload must never throw into the host's event dispatch.
      try {
        const type = event?.type ?? ""
        const p = event?.properties ?? {}
        const sid = p.sessionID ?? ""

        if (type === "session.status") {
          const status = p.status?.type
          logEvent(type, sid, `:${status ?? "?"}`)
          if (status === "busy") {
            armed = true
            logEvent("ARM", sid, "=status-busy")
            start()
          } else if (status === "idle") {
            stop("status=idle")
          }
          return
        }
        if (type === "session.idle" || type === "session.error") {
          stop(type)
          return
        }
        if (type === "message.updated" && p.info?.role === "user") {
          const mid = p.info.id ?? ""
          if (mid && mid === lastUserId) {
            logEvent(`${type}~ignored-dupe-user`, sid)
            return
          }
          if (mid) lastUserId = mid
          // Arms the GATE only, never starts the animation: a real turn is
          // always confirmed by status:busy or deltas within ~1s, while the
          // trailing metadata update (fresh/empty id in run mode, ~200ms
          // after the stop) must not resurrect the spinner by itself.
          armed = true
          logEvent("ARM", sid, "=user-msg(gate)")
          return
        }
        if (BUSY_EVENTS.has(type)) {
          if (armed) {
            start()
          } else {
            logEvent(`${type}~ignored-disarmed`, sid)
          }
        }
      } catch (e) {
        logEvent("HANDLER-ERROR", "-", `(${e.message})`)
        dbg(cfg.debug, `event handler error: ${e.message}`)
      }
    },
  }
}

// Test surface: attached as properties so the file keeps exactly two
// exports (TabSpinner + default). opencode's plugin loader skips the whole
// file if any export is not a plugin factory.
TabSpinner.parseConfig = parseConfig
TabSpinner.renderTemplate = renderTemplate
TabSpinner.PRESETS = PRESETS

export default TabSpinner
