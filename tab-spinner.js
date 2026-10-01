// tab-spinner — спиннер в заголовке таба терминала (ghostty), как у Claude Code.
// Плагин opencode: события хода приходят ин-процессно, титул пишется OSC 0
// в /dev/tty процесса TUI (у каждого таба свой — изоляция бесплатная).
//
// Состояния заголовка:
//   «⠋ Project» — ход активен: кадры ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, 120 мс/кадр
//   «✓ Project» — ход закончен
//
// Машина состояний (после инцидентов «крутится после конца» и «prerывisto»):
//   ВЗВОД:  session.status{type:busy} | message.updated с info.role=user
//   СТАРТ: message.part.delta / message.part.updated / message.updated —
//          только когда взведено; после остановки хвостовые message-события
//          игнорируются до нового взвода (гейт armed)
//   СТОП+РАЗРЯД: session.status{type:idle} | session.idle | session.error
//   СТОП БЕЗ разряда (только ✓): тишина дольше SILENCE_MS — модель в фазе
//          reasoning не шлёт событий, но ход продолжается; первый же
//          delta/busy мгновенно перезапускает анимацию. Разряд гейта на
//          тишине недопустим — проверено инцидентом: 10с думания разряжали
//          гейт и весь дальнейший стрим игнорировался.
//
// Эмпирика TUI (лог /tmp/tab-spinner-events.log, 2026-10-01):
//   - session.status флопает per-LLM-вызов (busy на старте вызова, idle на
//     конце), не per-ход; статус-события в TUI ЕСТЬ;
//   - дельты текут и во время исполнения инструмента (1023 шт за 18с);
//   - единственные «тихие» окна — reasoning-фазы (~10с).
const SILENCE_MS = Number(process.env.TAB_SPINNER_SILENCE_MS || 12000)
//
// ДИАГНОСТИКА: каждый session/message-событие пишется в TAB_SPINNER_LOG
// (умолч. /tmp/tab-spinner-events.log) — снимок реального потока TUI для
// калибровки сигналов. Убрать после стабилизации.
//
// Env: TAB_SPINNER_TTY — приёмник титула для тестов (умолч. /dev/tty);
// TAB_SPINNER_DEBUG=1 — диагностический вывод в stderr;
// TAB_SPINNER_LOG — файл лога событий (пусто = не логировать).
// Запись в недоступный TTY молча пропускается (headless serve/run).
import { appendFileSync, statSync, writeFileSync } from "node:fs"

const TTY = process.env.TAB_SPINNER_TTY || "/dev/tty"
const DBG = process.env.TAB_SPINNER_DEBUG === "1"
const LOG = process.env.TAB_SPINNER_LOG === "" ? null
  : process.env.TAB_SPINNER_LOG || "/tmp/tab-spinner-events.log"
const FRAME_MS = 120
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const BUSY_EVENTS = new Set(["message.part.delta", "message.part.updated", "message.updated"])

const dbg = (m) => { if (DBG) console.error(`[tab-spinner] ${m}`) }
dbg(`module loaded, TTY=${TTY}, LOG=${LOG}`)

if (LOG) {
  try {
    if (statSync(LOG).size > 512 * 1024) writeFileSync(LOG, "")
  } catch { /* файла ещё нет — норма */ }
}

function logEvent(type, sid, extra = "") {
  if (!LOG) return
  try { appendFileSync(LOG, `${Date.now()} pid=${process.pid} ${type}${extra} ${sid}\n`) } catch {}
}

let lastTitle = ""
function title(text) {
  if (text === lastTitle) return // дедуп: 12 idle подряд не пишут 12 ✓
  lastTitle = text
  logEvent("TITLE", "-", `='${text}'`)
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
  let armed = true
  let lastBusyAt = 0

  const start = () => {
    lastBusyAt = Date.now()
    if (timer) return
    frame_i = 0
    logEvent("START", "-")
    timer = setInterval(() => {
      if (Date.now() - lastBusyAt > SILENCE_MS) {
        stop("silence", false) // визуальный стоп без разряда: reasoning-фаза
        return
      }
      title(`${FRAMES[frame_i]} ${project}`)
      frame_i = (frame_i + 1) % FRAMES.length
    }, FRAME_MS)
    dbg("animation started")
  }

  const stop = (reason, disarm = true) => {
    if (timer) {
      clearInterval(timer)
      timer = null
      logEvent("STOP", "-", `(${reason}${disarm ? ",disarm" : ""})`)
      dbg(`animation stopped (${reason})`)
    }
    if (disarm) armed = false
    title(`✓ ${project}`)
  }

  return {
    event: async ({ event }) => {
      const type = event?.type ?? ""
      const p = event?.properties ?? {}
      const sid = p.sessionID ?? ""
      if (type.startsWith("session.") || type.startsWith("message.")) {
        logEvent(type, sid)
      }

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
        armed = true // новое пользовательское сообщение = новый ход
        logEvent("ARM", sid, "=user-msg")
        start()
        return
      }
      if (BUSY_EVENTS.has(type)) {
        if (armed) {
          start()
        } else {
          logEvent(`${type}~ignored-disarmed`, sid)
        }
      }
    },
  }
}

export default TabSpinner
