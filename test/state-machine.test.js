// State machine: start/stop transitions, intervals, gate semantics.
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN = pathToFileURL(join(fileURLToPath(new URL('.', import.meta.url)),
  '../src/tab-spinner.js')).href
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const BR = new Set('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏')
const FRAME_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Atlas$/

const tmp = mkdtempSync(join(tmpdir(), 'tab-spinner-sm-'))
const active = []
const track = (h) => { active.push(h); return h }

const ENV_KEYS = ['TAB_SPINNER_TTY', 'TAB_SPINNER_LOG', 'TAB_SPINNER_FRAMES',
  'TAB_SPINNER_IDLE', 'TAB_SPINNER_FRAME_MS', 'TAB_SPINNER_TITLE',
  'TAB_SPINNER_TITLE_IDLE', 'TAB_SPINNER_SILENCE_MS', 'TAB_SPINNER_DEBUG']

async function load(tty, tag, env = {}) {
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.TAB_SPINNER_TTY = tty
  process.env.TAB_SPINNER_LOG = ''
  Object.assign(process.env, env)
  const mod = await import(`${PLUGIN}?sm=${tag}-${Math.random()}`)
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

test('busy events start and sustain the frame animation', async () => {
  const tty = join(tmp, 'a.bin')
  const hooks = track(await (await load(tty, 'anim'))({ directory: '/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.updated', properties: {} } })
  await sleep(500)
  const frames = readTitles(tty).filter(t => FRAME_RE.test(t))
  assert.ok(frames.length >= 3, `frames flow (${frames.length}): ${readTitles(tty).slice(0, 3)}`)
  assert.ok(new Set(frames).size >= 3, 'frames vary (not stuck on one glyph)')
})

test('repeated busy events never stack intervals', async () => {
  const tty = join(tmp, 'b.bin')
  const hooks = track(await (await load(tty, 'stack'))({ directory: '/x/Atlas' }))
  for (const t of ['message.part.delta', 'message.part.updated', 'message.updated'])
    await hooks.event({ event: { type: t, properties: {} } })
  await sleep(600)
  const frames = readTitles(tty).filter(t => FRAME_RE.test(t))
  assert.ok(frames.length <= 7, `one interval only: ${frames.length} frames in 600ms`)
})

test('session.idle stops the animation and writes the idle title', async () => {
  const tty = join(tmp, 'c.bin')
  const hooks = track(await (await load(tty, 'idle'))({ directory: '/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(250)
  await hooks.event({ event: { type: 'session.idle', properties: {} } })
  const after = readTitles(tty).length
  await sleep(350)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas')
  assert.equal(titles.length, after, 'no frames after idle')
})

test('session.error also stops the animation', async () => {
  const tty = join(tmp, 'd.bin')
  const hooks = track(await (await load(tty, 'err'))({ directory: '/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.updated', properties: {} } })
  await sleep(250)
  await hooks.event({ event: { type: 'session.error', properties: {} } })
  await sleep(350)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas')
})

test('silence stops visually but keeps the gate armed', async () => {
  const tty = join(tmp, 'e.bin')
  const hooks = track(await (await load(tty, 'silence', { TAB_SPINNER_SILENCE_MS: '400' }))({ directory: '/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(200)
  await sleep(600) // > 400ms quiet -> visual stop, gate stays armed
  const mid = readTitles(tty)
  assert.equal(mid[mid.length - 1], '✓ Atlas', 'silence writes the idle title')
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } }) // reasoning ended
  await sleep(300)
  const frames = readTitles(tty).filter(t => FRAME_RE.test(t))
  assert.ok(frames.length >= 2, `delta after silence restarts frames (${frames.length})`)
})
