// tab-spinner — спиннер в заголовке таба терминала (ghostty), как у Claude Code.
// Плагин opencode: события хода приходят ин-процессно, титул пишется OSC 0
// в /dev/tty процесса TUI (у каждого таба свой — изоляция бесплатная).
//
// Состояния заголовка:
//   «⠋ Project» — ход активен: кадры ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, 120 мс/кадр
//   «✓ Project» — ход закончен (session.idle / session.error)
//
// Busy-события: message.part.delta (пер-токенный стрим), message.part.updated,
// message.updated — старт с первого события, останов только по явному
// session.idle/session.error. Никаких эвристик тишины.
//
// Env: TAB_SPINNER_TTY — приёмник титула для тестов (умолч. /dev/tty);
// TAB_SPINNER_DEBUG=1 — диагностический вывод в stderr.
// Запись в недоступный TTY молча пропускается (headless serve/run).
import { appendFileSync } from "node:fs"

const TTY = process.env.TAB_SPINNER_TTY || "/dev/tty"
const DBG = process.env.TAB_SPINNER_DEBUG === "1"
const FRAME_MS = 120
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const BUSY_EVENTS = new Set(["message.part.delta", "message.part.updated", "message.updated"])
const STOP_EVENTS = new Set(["session.idle", "session.error"])

const dbg = (m) => { if (DBG) console.error(`[tab-spinner] ${m}`) }
dbg(`module loaded, TTY=${TTY}`)

function title(text) {
  try {
    appendFileSync(TTY, `\x1b]0;${text}\x07`)
    dbg(`title: ${text}`)
  } catch (e) {
    dbg(`title write FAILED: ${e.message}`)
  }
}

export const TabSpinner = async ({ directory }) => {
  dbg(`factory called, directory=${directory}`)
  const parts = String(directory ?? "").split("/").filter(Boolean)
  const project = parts[parts.length - 1] || "opencode"

  let timer = null
  let frame_i = 0

  const start = () => {
    if (timer) return
    frame_i = 0
    timer = setInterval(() => {
      title(`${FRAMES[frame_i]} ${project}`)
      frame_i = (frame_i + 1) % FRAMES.length
    }, FRAME_MS)
    dbg("animation started")
  }

  const stop = (reason) => {
    if (timer) {
      clearInterval(timer)
      timer = null
      dbg(`animation stopped (${reason})`)
    }
    title(`✓ ${project}`)
  }

  return {
    event: async ({ event }) => {
      const type = event?.type ?? ""
      if (BUSY_EVENTS.has(type)) {
        start()
      } else if (STOP_EVENTS.has(type)) {
        stop(type)
      }
    },
  }
}

export default TabSpinner
