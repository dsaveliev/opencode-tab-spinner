// Headless guard and sanitization of runtime-derived strings.
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN = pathToFileURL(join(import.meta.dirname, '../src/tab-spinner.js')).href
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const tmp = mkdtempSync(join(tmpdir(), 'tab-spinner-hard-'))
const active = []
const track = (h) => { active.push(h); return h }

async function load(tty, tag) {
  const prev = { ...process.env }
  process.env.TAB_SPINNER_TTY = tty
  process.env.TAB_SPINNER_LOG = ''
  const mod = await import(`${PLUGIN}?hard=${tag}-${Math.random()}`)
  return mod.TabSpinner
}

const readTitles = (f) => {
  try {
    return [...readFileSync(f, 'utf8').matchAll(/\x1b\]0;([^\x07]*)\x07/g)].map(m => m[1])
  } catch { return [] }
}

test.after(() => {
  for (const h of active) { try { h.event({ event: { type: 'session.idle' } }) } catch {} }
  rmSync(tmp, { recursive: true, force: true })
})

test('headless guard: unwritable TTY never throws', async () => {
  const tty = join(tmp, 'no-such-dir', 'tty')
  const hooks = track(await (await load(tty, 'guard'))({ directory: '/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(200)
  await hooks.event({ event: { type: 'session.idle', properties: {} } }) // must not throw
})

test('empty directory falls back to "opencode" project name', async () => {
  const tty = join(tmp, 'fallback.bin')
  const hooks = track(await (await load(tty, 'fallback'))({ directory: '/' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(250)
  assert.ok(readTitles(tty).some(t => / opencode$/.test(t)))
})

test('REGRESSION: ESC/BEL in the directory name cannot break the OSC title', async () => {
  const tty = join(tmp, 'esc.bin')
  const hooks = track(await (await load(tty, 'esc'))({ directory: '/x/at\x1b\x07las' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(250)
  const raw = readFileSync(tty, 'utf8')
  const m = raw.match(/\x1b\]0;([^\x07]*)\x07/)
  assert.ok(m, 'title written')
  assert.ok(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] atlas$/.test(m[1]),
    `project name sanitized: ${JSON.stringify(m[1])}`)
  assert.ok(!raw.includes('at\x1b'), 'no raw ESC leaked into the stream')
})
