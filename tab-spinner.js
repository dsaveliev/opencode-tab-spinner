// tab-spinner — спиннер в заголовке таба терминала (ghostty), как у Claude Code.
// Плагин opencode: события хода приходят ин-процессно, титул пишется OSC 0
// (ESC ]0;...BEL) в /dev/tty процесса TUI — у каждого таба свой, изоляция
// бесплатная. Работает при любом способе запуска opencode.
//
// Заголовок:
//   «⠋ Project» — ход активен (кадры ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, 120 мс/кадр)
//   «✓ Project» — ход закончен
//
// Контракт сигналов (эмпирически сверифицировано на opencode 1.18.x):
//   session.status {status:{type:"busy"|"idle"}} — флопает на границах
//     КАЖДОГО LLM-вызова (не хода); на конце хода даёт мгновенный idle;
//   message.part.delta — пер-токенный стрим; течёт и во время исполнения
//     инструмента; молчит только в reasoning-фазах (~10-30с);
//   message.updated role=user с НОВЫМ id — старт хода. Дубль СТАРОГО id
//     приходит через ~60мс после конца хода (opencode обновляет метаданные
//     сообщения) — обязателен к игнорированию, иначе спиннер воскресает;
//   session.idle / session.error — резервные стопы.
//
// Машина состояний:
//   ВЗВОД:  status:busy | user-сообщение с новым id
//   СТАРТ: message.* при взведённом гейте (после остановки хвостовые
//          message-события игнорируются до нового взвода)
//   СТОП+РАЗРЯД: status:idle | session.idle | session.error
//   СТОП БЕЗ разряда: тишина > SILENCE_MS (reasoning-фаза: ход жив,
//          первый же delta мгновенно перезапускает анимацию)
//
// Env:
//   TAB_SPINNER_TTY         — приёмник титула (умолч. /dev/tty)
//   TAB_SPINNER_SILENCE_MS  — порог тишины (умолч. 12000)
//   TAB_SPINNER_LOG         — файл полного диагностического журнала
//                             (события, решения ARM/START/STOP, титулы);
//                             по умолчанию ВЫКЛ
//   TAB_SPINNER_DEBUG=1     — кратный вывод в stderr
// Запись в недоступный TTY молча пропускается (headless serve/run).

import { appendFileSync, statSync, writeFileSync } from "node:fs"

const TTY = process.env.TAB_SPINNER_TTY || "/dev/tty"
const DBG = process.env.TAB_SPINNER_DEBUG === "1"
const LOG = process.env.TAB_SPINNER_LOG || "" // пусто = не логировать
const FRAME_MS = 120
const SILENCE_MS = Number(process.env.TAB_SPINNER_SILENCE_MS || 12000)
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const BUSY_EVENTS = new Set(["message.part.delta", "message.part.updated", "message.updated"])

const dbg = (m) => { if (DBG) console.error(`[tab-spinner] ${m}`) }

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
  if (text === lastTitle) return // дедуп: пачка idle подряд пишет один ✓
  lastTitle = text
  logEvent("TITLE", "-", `='${text}'`)
  try {
    appendFileSync(TTY, `\x1b]0;${text}\x07`)
  } catch (e) {
    dbg(`title write FAILED: ${e.message}`)
  }
}

export const TabSpinner = async ({ directory }) => {
  const parts = String(directory ?? "").split("/").filter(Boolean)
  const project = parts[parts.length - 1] || "opencode"
  dbg(`loaded, directory=${directory}, TTY=${TTY}`)

  let timer = null
  let frame_i = 0
  let armed = true
  let lastBusyAt = 0
  let lastUserId = "" // хвостовой апдейт старого user-сообщения ≠ новый ход

  const start = () => {
    lastBusyAt = Date.now()
    if (timer) return
    frame_i = 0
    logEvent("START", "-")
    timer = setInterval(() => {
      if (Date.now() - lastBusyAt > SILENCE_MS) {
        stop("silence", false) // визуальный стоп, гейт не трогаем
        return
      }
      title(`${FRAMES[frame_i]} ${project}`)
      frame_i = (frame_i + 1) % FRAMES.length
    }, FRAME_MS)
  }

  const stop = (reason, disarm = true) => {
    if (timer) {
      clearInterval(timer)
      timer = null
      logEvent("STOP", "-", `(${reason}${disarm ? ",disarm" : ""})`)
    }
    if (disarm) armed = false
    title(`✓ ${project}`)
  }

  return {
    event: async ({ event }) => {
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
        armed = true
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
