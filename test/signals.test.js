// Signal contract: status busy/idle boundaries, arm sources, straggler guards.
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN = pathToFileURL(join(fileURLToPath(new URL('.', import.meta.url)),
  '../src/tab-spinner.js')).href
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const FRAME_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Atlas$/

const tmp = mkdtempSync(join(tmpdir(), 'tab-spinner-sig-'))
const active = []
const track = (h) => { active.push(h); return h }

const ENV_KEYS = ['TAB_SPINNER_TTY', 'TAB_SPINNER_LOG', 'TAB_SPINNER_FRAMES',
  'TAB_SPINNER_IDLE', 'TAB_SPINNER_FRAME_MS', 'TAB_SPINNER_TITLE',
  'TAB_SPINNER_TITLE_IDLE', 'TAB_SPINNER_SILENCE_MS', 'TAB_SPINNER_DEBUG']

async function load(tty, tag) {
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.TAB_SPINNER_TTY = tty
  process.env.TAB_SPINNER_LOG = ''
  const mod = await import(`${PLUGIN}?sig=${tag}-${Math.random()}`)
  return mod.TabSpinner
}

const readTitles = (f) => {
  try {
    return [...readFileSync(f, 'utf8').matchAll(/\x1b\]0;([^\x07]*)\x07/g)].map(m => m[1])
  } catch { return [] }
}
const ev = (type, properties = {}) => ({ event: { type, properties } })
const STATUS = (t, sid) => ev('session.status', { status: { type: t }, sessionID: sid })

test.after(() => {
  for (const h of active) { try { h.event(STATUS('idle')) } catch {} }
  rmSync(tmp, { recursive: true, force: true })
})

test('message events alone (armed by default) trigger frames', async () => {
  const tty = join(tmp, 'a.bin')
  const hooks = track(await (await load(tty, 'msg'))({ directory: '/x/Atlas' }))
  await hooks.event(ev('message.part.updated'))
  await sleep(200)
  assert.ok(readTitles(tty).some(t => FRAME_RE.test(t)))
})

test('session.status busy starts, idle stops instantly', async () => {
  const tty = join(tmp, 'b.bin')
  const hooks = track(await (await load(tty, 'status'))({ directory: '/x/Atlas' }))
  await hooks.event(STATUS('busy', 's1'))
  await sleep(300)
  const mid = readTitles(tty).filter(t => FRAME_RE.test(t))
  assert.ok(mid.length >= 2, `status busy starts frames (${mid.length})`)
  await hooks.event(STATUS('idle', 's1'))
  const after = readTitles(tty).length
  await sleep(300)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas')
  assert.equal(titles.length, after, 'no frames after status idle')
})

test('status idle while already idle is a no-op (single idle title)', async () => {
  const tty = join(tmp, 'c.bin')
  const hooks = track(await (await load(tty, 'noop'))({ directory: '/x/Atlas' }))
  await hooks.event(STATUS('idle', 's1'))
  await sleep(300)
  const titles = readTitles(tty)
  assert.ok(titles.length <= 1 && titles.every(t => t === '✓ Atlas'))
})

test('straggler message events after a stop are ignored until the next ARM', async () => {
  const tty = join(tmp, 'd.bin')
  const hooks = track(await (await load(tty, 'straggler'))({ directory: '/x/Atlas' }))
  await hooks.event(STATUS('busy', 's1'))
  await sleep(250)
  await hooks.event(STATUS('idle', 's1'))
  const after = readTitles(tty).length
  await sleep(100)
  await hooks.event(ev('message.part.updated', { sessionID: 's1' })) // trailing straggler
  await sleep(400)
  const titles = readTitles(tty)
  assert.equal(titles.length, after, 'straggler does not restart the animation')
  assert.equal(titles[titles.length - 1], '✓ Atlas')
})

test('REGRESSION: user message after a stop arms the gate but does NOT start the animation (run-mode straggler)', async () => {
  // Journal rehearsal: STOP(status=idle) -> idle title -> 200ms later a
  // role=user update arrives; in run mode it may carry a fresh/empty id.
  // It must arm the gate (a real turn follows) but never spin by itself.
  const tty = join(tmp, 'g.bin')
  const hooks = track(await (await load(tty, 'straggler2'))({ directory: '/x/Atlas' }))
  await hooks.event(STATUS('busy', 's1'))
  await sleep(200)
  await hooks.event(STATUS('idle', 's1'))
  const after = readTitles(tty).length
  await sleep(120)
  await hooks.event(ev('message.updated', { info: { id: 'msg_z', role: 'user' }, sessionID: 's1' }))
  await sleep(500)
  let titles = readTitles(tty)
  assert.equal(titles.length, after, 'user message alone does not spin')
  assert.equal(titles[titles.length - 1], '✓ Atlas')
  // ...but the gate is armed: the first delta of the real turn starts frames
  await hooks.event(ev('message.part.delta', { sessionID: 's1' }))
  await sleep(300)
  titles = readTitles(tty)
  assert.ok(titles.some(t => FRAME_RE.test(t)), 'armed gate lets the first delta start frames')
})

test('a NEW user message id arms a new turn', async () => {
  const tty = join(tmp, 'e.bin')
  const hooks = track(await (await load(tty, 'rearm'))({ directory: '/x/Atlas' }))
  await hooks.event(STATUS('idle', 's1')) // disarm
  await sleep(100)
  await hooks.event(ev('message.updated', { info: { id: 'msg_B', role: 'user' }, sessionID: 's1' }))
  await hooks.event(ev('message.part.delta', { sessionID: 's1' }))
  await sleep(300)
  assert.ok(readTitles(tty).some(t => FRAME_RE.test(t)), 'new user id re-arms')
})

test('REGRESSION: duplicate update of the OLD user message must not re-arm', async () => {
  // Journal rehearsal: STOP(status=idle) -> title -> 58ms later the same
  // message id arrives with role=user (metadata refresh). Not a new turn.
  const tty = join(tmp, 'f.bin')
  const hooks = track(await (await load(tty, 'dupe'))({ directory: '/x/Atlas' }))
  await hooks.event(ev('message.updated', { info: { id: 'msg_A', role: 'user' }, sessionID: 's1' }))
  await sleep(150)
  await hooks.event(STATUS('idle', 's1'))
  const after = readTitles(tty).length
  await hooks.event(ev('message.updated', { info: { id: 'msg_A', role: 'user' }, sessionID: 's1' }))
  await sleep(400)
  let titles = readTitles(tty)
  assert.equal(titles.length, after, 'duplicate id does not restart')
  assert.equal(titles[titles.length - 1], '✓ Atlas')
  // ...while a genuinely new id arms the gate and the first delta spins
  await hooks.event(ev('message.updated', { info: { id: 'msg_B', role: 'user' }, sessionID: 's1' }))
  await hooks.event(ev('message.part.delta', { sessionID: 's1' }))
  await sleep(300)
  titles = readTitles(tty)
  assert.ok(titles.some(t => FRAME_RE.test(t)), 'new id arms, delta starts')
})
