// Dialog signals: an open question/permission dialog freezes the animation
// and shows a dedicated glyph in the tab title until the user answers.
// Event contract (verified against opencode 1.18.31 source):
//   question.asked {id, sessionID, questions, tool?}
//   question.replied {sessionID, requestID, answers}
//   question.rejected {sessionID, requestID}          (dialog dismissed)
//   permission.asked {id, sessionID, permission, patterns, ...}
//   permission.replied {sessionID, requestID, reply}  (once|always|reject)
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

const tmp = mkdtempSync(join(tmpdir(), 'tab-spinner-ask-'))
const active = []
const track = (h) => { active.push(h); return h }

const ENV_KEYS = ['TAB_SPINNER_TTY', 'TAB_SPINNER_LOG', 'TAB_SPINNER_FRAMES',
  'TAB_SPINNER_IDLE', 'TAB_SPINNER_FRAME_MS', 'TAB_SPINNER_TITLE',
  'TAB_SPINNER_TITLE_IDLE', 'TAB_SPINNER_SILENCE_MS', 'TAB_SPINNER_DEBUG',
  'TAB_SPINNER_QUESTION', 'TAB_SPINNER_PERMISSION',
  'TAB_SPINNER_TITLE_QUESTION', 'TAB_SPINNER_TITLE_PERMISSION']

async function load(tty, tag, env = {}) {
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.TAB_SPINNER_TTY = tty
  process.env.TAB_SPINNER_LOG = ''
  Object.assign(process.env, env)
  const mod = await import(`${PLUGIN}?ask=${tag}-${Math.random()}`)
  return mod.TabSpinner
}

const readTitles = (f) => {
  try {
    return [...readFileSync(f, 'utf8').matchAll(/\x1b\]0;([^\x07]*)\x07/g)].map(m => m[1])
  } catch { return [] }
}

const ev = (type, properties = {}) => ({ event: { type, properties } })
const ASKED = (id) => ev('question.asked', {
  id, sessionID: 's1',
  questions: [{ question: 'Proceed?', header: 'Confirm', options: [] }],
})
const REPLIED = (id) => ev('question.replied', { sessionID: 's1', requestID: id, answers: [['Yes']] })
const REJECTED = (id) => ev('question.rejected', { sessionID: 's1', requestID: id })
const PASKED = (id) => ev('permission.asked', { id, sessionID: 's1', permission: 'bash', patterns: ['*'] })
const PREPLIED = (id) => ev('permission.replied', { sessionID: 's1', requestID: id, reply: 'once' })

test.after(() => {
  for (const h of active) { try { h.event(ev('session.idle')) } catch {} }
  rmSync(tmp, { recursive: true, force: true })
})

test('question.asked while spinning freezes the title on the question glyph', async () => {
  const tty = join(tmp, 'a.bin')
  const hooks = track(await (await load(tty, 'freeze'))({ directory: '/x/Atlas' }))
  await hooks.event(ev('message.part.delta'))
  await sleep(300)
  assert.ok(readTitles(tty).some(t => FRAME_RE.test(t)), 'frames flow first')
  await hooks.event(ASKED('que_1'))
  const after = readTitles(tty)
  assert.equal(after[after.length - 1], '? Atlas', 'dialog glyph replaces the frame')
  await sleep(350)
  const titles = readTitles(tty)
  assert.equal(titles.length, after.length, 'no frames while the dialog is open')
  assert.equal(titles[titles.length - 1], '? Atlas')
})

test('question.asked while idle also shows the question glyph', async () => {
  const tty = join(tmp, 'b.bin')
  const hooks = track(await (await load(tty, 'idle-ask'))({ directory: '/x/Atlas' }))
  await hooks.event(ASKED('que_1'))
  await sleep(250)
  const titles = readTitles(tty)
  assert.deepEqual(titles, ['? Atlas'])
})

test('custom question glyph and template are honored and sanitized', async () => {
  const tty = join(tmp, 'c.bin')
  const hooks = track(await (await load(tty, 'custom', {
    TAB_SPINNER_QUESTION: 'Q\x1b[2J!',
    TAB_SPINNER_TITLE_QUESTION: '[{question}] {project}',
  }))({ directory: '/x/Atlas' }))
  await hooks.event(ASKED('que_1'))
  await sleep(150)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '[Q!] Atlas')
})

test('question.replied writes the idle title; the resumed turn spins again', async () => {
  const tty = join(tmp, 'd.bin')
  const hooks = track(await (await load(tty, 'replied'))({ directory: '/x/Atlas' }))
  await hooks.event(ev('message.part.delta'))
  await sleep(250)
  await hooks.event(ASKED('que_1'))
  await hooks.event(REPLIED('que_1'))
  let titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas')
  await hooks.event(ev('message.part.delta')) // the turn continues with the answer
  await sleep(300)
  titles = readTitles(tty)
  assert.ok(titles.some(t => FRAME_RE.test(t)), 'frames restart after the reply')
})

test('question.rejected (dialog dismissed) also returns to idle', async () => {
  const tty = join(tmp, 'e.bin')
  const hooks = track(await (await load(tty, 'rejected'))({ directory: '/x/Atlas' }))
  await hooks.event(ASKED('que_1'))
  await hooks.event(REJECTED('que_1'))
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas')
})

test('REGRESSION: session.idle during an open question must not overwrite the glyph', async () => {
  // Production shape: the LLM-call boundary flaps idle while the question
  // tool blocks on the user. The idle title must not erase the "?".
  const tty = join(tmp, 'f.bin')
  const hooks = track(await (await load(tty, 'idle-flap'))({ directory: '/x/Atlas' }))
  await hooks.event(ASKED('que_1'))
  await hooks.event(ev('session.idle', { sessionID: 's1' }))
  await sleep(250)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '? Atlas')
  assert.ok(!titles.includes('✓ Atlas'), 'no idle glyph while the dialog is open')
})

test('message deltas during an open question do not start the animation', async () => {
  const tty = join(tmp, 'g.bin')
  const hooks = track(await (await load(tty, 'no-spin'))({ directory: '/x/Atlas' }))
  await hooks.event(ASKED('que_1'))
  const after = readTitles(tty).length
  await hooks.event(ev('message.part.delta', { sessionID: 's1' }))
  await hooks.event(ev('message.part.updated', { sessionID: 's1' }))
  await sleep(350)
  const titles = readTitles(tty)
  assert.equal(titles.length, after, 'deltas while a dialog is open never spin')
  assert.equal(titles[titles.length - 1], '? Atlas')
})

test('two concurrent questions: closing one keeps the glyph until the last closes', async () => {
  const tty = join(tmp, 'h.bin')
  const hooks = track(await (await load(tty, 'two-q'))({ directory: '/x/Atlas' }))
  await hooks.event(ASKED('que_1'))
  await hooks.event(ASKED('que_2'))
  await hooks.event(REJECTED('que_1'))
  let titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '? Atlas')
  await hooks.event(REPLIED('que_2'))
  titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas')
})

test('permission.asked shows the permission glyph; replied returns to idle', async () => {
  const tty = join(tmp, 'i.bin')
  const hooks = track(await (await load(tty, 'perm'))({ directory: '/x/Atlas' }))
  await hooks.event(PASKED('per_1'))
  await sleep(150)
  let titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '! Atlas')
  await hooks.event(PREPLIED('per_1'))
  titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas')
})

test('question beats permission when both dialogs are open', async () => {
  const tty = join(tmp, 'j.bin')
  const hooks = track(await (await load(tty, 'both'))({ directory: '/x/Atlas' }))
  await hooks.event(PASKED('per_1'))
  await hooks.event(ASKED('que_1'))
  await hooks.event(REPLIED('que_1'))
  let titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '! Atlas', 'permission glyph resurfaces')
  await hooks.event(PREPLIED('per_1'))
  titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas')
})

test('REGRESSION: session.error clears open dialogs (aborted turn)', async () => {
  const tty = join(tmp, 'k.bin')
  const hooks = track(await (await load(tty, 'err-clear'))({ directory: '/x/Atlas' }))
  await hooks.event(ASKED('que_1'))
  await hooks.event(PASKED('per_1'))
  await hooks.event(ev('session.error', { sessionID: 's1' }))
  await sleep(150)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas', 'error resets the dialog state')
})

test('REGRESSION: a NEW user message clears a stale dialog (aborted run)', async () => {
  // A new prompt aborts the blocked run; no close event is guaranteed to
  // arrive (question interrupt publishes nothing) — the next user message
  // must reset the glyph instead of leaving a stale "?".
  const tty = join(tmp, 'l.bin')
  const hooks = track(await (await load(tty, 'stale'))({ directory: '/x/Atlas' }))
  await hooks.event(ASKED('que_1'))
  await hooks.event(ev('message.updated', { info: { id: 'msg_new', role: 'user' }, sessionID: 's1' }))
  await sleep(150)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas')
  await hooks.event(ev('message.part.delta', { sessionID: 's1' }))
  await sleep(300)
  assert.ok(readTitles(tty).some(t => FRAME_RE.test(t)), 'the new turn spins normally')
})
