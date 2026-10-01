// tab-spinner — probe-версия (Task 1 из tasks/plan.md).
// Доказательство связки «событие хода ин-процессно -> OSC 0 титул терминала».
// На message-событиях пишет "PROBE <project> <ts>"; полная анимация — Task 2.
//
// Env: TAB_SPINNER_TTY — приёмник титула для тестов (умолч. /dev/tty).
// Запись в недоступный TTY молча пропускается (headless serve/run).
import { appendFileSync } from "node:fs"

const TTY = process.env.TAB_SPINNER_TTY || "/dev/tty"
const DBG = process.env.TAB_SPINNER_DEBUG === "1"
const dbg = (m) => { if (DBG) console.error(`[tab-spinner] ${m}`) }
dbg(`module loaded, TTY=${TTY}`)

function title(text) {
  try {
    appendFileSync(TTY, `\x1b]0;${text}\x07`)
    dbg(`title written: ${text}`)
  } catch (e) {
    dbg(`title write FAILED: ${e.message}`)
  }
}

export const TabSpinner = async ({ directory }) => {
  dbg(`factory called, directory=${directory}`)
  const parts = String(directory ?? "").split("/").filter(Boolean)
  const project = parts[parts.length - 1] || "opencode"
  const probe = () => title(`PROBE ${project} ${Date.now()}`)
  return {
    event: async ({ event }) => {
      const type = event?.type ?? ""
      dbg(`event: ${type}`)
      if (type === "message.part.updated" || type === "message.updated") {
        probe()
      }
    },
  }
}

export default TabSpinner
