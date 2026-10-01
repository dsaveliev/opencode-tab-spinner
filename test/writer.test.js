// Title-writer adapter: held fd, dedup, dead-writer guard.
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PLUGIN = pathToFileURL(join(fileURLToPath(new URL('.', import.meta.url)),
  '../src/tab-spinner.js')).href
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const tmp = mkdtempSync(join(tmpdir(), 'tab-spinner-w-'))
const active = []
const track = (h) => { active.push(h); return h }

const ENV_KEYS = ['TAB_SPINNER_TTY', 'TAB_SPINNER_LOG', 'TAB_SPINNER_FRAMES',
  'TAB_SPINNER_IDLE', 'TAB_SPINNER_FRAME_MS', 'TAB_SPINNER_TITLE',
  'TAB_SPINNER_TITLE_IDLE', 'TAB_SPINNER_SILENCE_MS', 'TAB_SPINNER_DEBUG']

async function load(tty, tag, env = {}) {
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.TAB_SPINNER_TTY = tty
  Object.assign(process.env, { TAB_SPINNER_LOG: join(tmp, `${tag}.log`), ...env })
  const mod = await import(`${PLUGIN}?w=${tag}-${Math.random()}`)
  return mod.TabSpinner
}

test.after(() => {
  for (const h of active) { try { h.event({ event: { type: 'session.idle' } }) } catch {} }
  rmSync(tmp, { recursive: true, force: true })
})

test('dead TTY: writer disables after repeated failures and stops attempting', async () => {
  const deadTty = join(tmp, 'a-directory')
  mkdirSync(deadTty) // open('a') on a directory -> EISDIR every attempt
  const log = join(tmp, 'dead.log')
  const hooks = track(await (await load(deadTty, 'dead', { TAB_SPINNER_TTY: deadTty }))({ directory: '/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(1800) // 120ms frames -> far beyond 10 consecutive failures
  const lines = readFileSync(log, 'utf8').split('\n')
  const disabled = lines.filter(l => l.includes('WRITER-DISABLED'))
  assert.equal(disabled.length, 1, `exactly one WRITER-DISABLED, got: ${disabled.length}`)
  // nothing after the disable marker except the marker itself
  const idx = lines.findIndex(l => l.includes('WRITER-DISABLED'))
  assert.ok(lines.slice(idx + 1).every(l => !l.includes('TITLE')),
    'no TITLE attempts after disable')
  // and later events do not throw / resurrect
  await hooks.event({ event: { type: 'session.status', properties: { status: { type: 'busy' } } } })
  await sleep(300)
  const after = readFileSync(log, 'utf8').split('\n')
  assert.equal(after.filter(l => l.includes('WRITER-DISABLED')).length, 1)
})

test('handler never throws on a hostile event payload', async () => {
  const tty = join(tmp, 'hostile.bin')
  const hooks = track(await (await load(tty, 'hostile'))({ directory: '/x/Atlas' }))
  const evil = new Proxy({}, { get() { throw new Error('boom') } })
  await hooks.event({ event: evil }) // must not throw
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(300)
  const raw = readFileSync(tty, 'utf8')
  assert.ok(raw.includes('\x1b]0;'), 'writer still alive after hostile payload')
})
