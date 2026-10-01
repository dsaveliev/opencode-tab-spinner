// Signal contract: status busy/idle boundaries, arm sources, straggler guards.
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN = pathToFileURL(join(import.meta.dirname, '../src/tab-spinner.js')).href
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const FRAME_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Atlas$/

const tmp = mkdtempSync(join(tmpdir(), 'tab-spinner-sig-'))
const active = []
const track = (h) => { active.push(h); return h }

async function load(tty, tag) {
  const prev = { ...process.env }
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
  // ...while a genuinely new id does
  await hooks.event(ev('message.updated', { info: { id: 'msg_B', role: 'user' }, sessionID: 's1' }))
  await sleep(300)
  titles = readTitles(tty)
  assert.ok(titles.some(t => FRAME_RE.test(t)), 'new id arms')
})
