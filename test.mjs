// Тесты Task 1 (probe): tab-spinner.js пишет OSC 0 PROBE-титул по событиям хода.
// Запуск: node test.mjs (из каталога tab-spinner/).
// TAB_SPINNER_TTY читается плагином при импорте, поэтому каждый кейс —
// свежий import с cache-busting параметром.
import { strict as assert } from 'node:assert'
import { readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PLUGIN_URL = new URL('./tab-spinner.js', import.meta.url).href

async function loadPlugin(tty, tag) {
  const prev = process.env.TAB_SPINNER_TTY
  process.env.TAB_SPINNER_TTY = tty
  const mod = await import(`${PLUGIN_URL}?case=${tag}`)
  if (prev === undefined) delete process.env.TAB_SPINNER_TTY
  else process.env.TAB_SPINNER_TTY = prev
  return mod.TabSpinner
}

const tmp = mkdtempSync(join(tmpdir(), 'tab-spinner-test-'))
let failed = 0
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const readTitles = (f) => {
  try {
    const raw = readFileSync(f, 'utf8')
    return [...raw.matchAll(/\x1b\]0;([^\x07]*)\x07/g)].map(m => m[1])
  } catch { return [] }
}

async function case1_probe_on_part_updated() {
  const tty = join(tmp, 'probe.bin')
  const TabSpinner = await loadPlugin(tty, 'part')
  const hooks = track(await TabSpinner({ directory: '/Users/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.updated', properties: {} } })
  await sleep(200)
  const titles = readTitles(tty)
  assert.ok(titles.some(t => /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Atlas$/.test(t)),
    `message.part.updated запускает кадры, есть: ${titles.slice(0,3)}`)
  console.log('ok  1 - message.part.updated запускает анимацию')
}

async function case2_probe_on_message_updated() {
  const tty = join(tmp, 'probe2.bin')
  const TabSpinner = await loadPlugin(tty, 'msg')
  const hooks = track(await TabSpinner({ directory: '/Users/x/Atlas' }))
  await hooks.event({ event: { type: 'message.updated', properties: {} } })
  await sleep(200)
  const titles = readTitles(tty)
  assert.ok(titles.some(t => /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Atlas$/.test(t)), 'message.updated тоже триггерит')
  console.log('ok  2 - message.updated запускает анимацию')
}

async function case3_headless_guard() {
  const tty = join(tmp, 'no-such-dir', 'tty')
  const TabSpinner = await loadPlugin(tty, 'guard')
  const hooks = track(await TabSpinner({ directory: '/Users/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(200)
  await hooks.event({ event: { type: 'session.idle', properties: {} } }) // не должен бросить
  console.log('ok  3 - недоступный TTY не роняет хук (headless guard)')
}

async function case4_project_fallback() {
  const tty = join(tmp, 'probe4.bin')
  const TabSpinner = await loadPlugin(tty, 'fallback')
  const hooks = track(await TabSpinner({ directory: '/' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(200)
  assert.ok(readTitles(tty).some(t => t.endsWith(' opencode')), 'кадр с fallback-именем opencode')
  console.log('ok  4 - пустой directory -> opencode')
}

async function case5_busy_events_animate_frames() {
  const tty = join(tmp, 'anim.bin')
  const TabSpinner = await loadPlugin(tty, 'anim')
  const hooks = track(await TabSpinner({ directory: '/Users/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(500)
  const titles = readTitles(tty)
  const frames = titles.filter(t => /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Atlas$/.test(t))
  assert.ok(frames.length >= 3, `кадры анимации идут (получено ${frames.length}): ${titles.slice(0,5)}`)
  assert.ok(new Set(frames).size >= 3, 'кадры разные (не залип на одном глифе)')
  await hooks.event({ event: { type: 'session.idle', properties: {} } })
  console.log('ok  5 - busy-событие запускает непрерывную анимацию кадров')
}

async function case6_idle_stops_and_writes_check() {
  const tty = join(tmp, 'idle.bin')
  const TabSpinner = await loadPlugin(tty, 'idle')
  const hooks = track(await TabSpinner({ directory: '/Users/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await sleep(250)
  await hooks.event({ event: { type: 'session.idle', properties: {} } })
  const after = readTitles(tty).length
  await sleep(350)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas', 'последний титул = "✓ Atlas"')
  assert.equal(titles.length, after, 'после idle кадров больше нет (интервал остановлен)')
  console.log('ok  6 - session.idle гасит анимацию и пишет "✓ Atlas"')
}

async function case7_error_stops_animation() {
  const tty = join(tmp, 'err.bin')
  const TabSpinner = await loadPlugin(tty, 'err')
  const hooks = track(await TabSpinner({ directory: '/Users/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.updated', properties: {} } })
  await sleep(250)
  await hooks.event({ event: { type: 'session.error', properties: {} } })
  await sleep(350)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas', 'session.error тоже гасит анимацию')
  console.log('ok  7 - session.error гасит анимацию')
}

async function case8_no_stacked_intervals() {
  const tty = join(tmp, 'stack.bin')
  const TabSpinner = await loadPlugin(tty, 'stack')
  const hooks = track(await TabSpinner({ directory: '/Users/x/Atlas' }))
  await hooks.event({ event: { type: 'message.part.delta', properties: {} } })
  await hooks.event({ event: { type: 'message.part.updated', properties: {} } })
  await hooks.event({ event: { type: 'message.updated', properties: {} } })
  await sleep(600)
  const titles = readTitles(tty).filter(t => /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Atlas$/.test(t))
  assert.ok(titles.length <= 7, `один интервал: за 600мс не больше ~5 кадров, есть ${titles.length}`)
  console.log('ok  8 - повторные busy-события не плодят интервалы')
}

const active = []
const track = (hooks) => { active.push(hooks); return hooks }

async function case9_status_busy_starts_idle_stops() {
  const tty = join(tmp, 'status.bin')
  const TabSpinner = await loadPlugin(tty, 'status')
  const hooks = track(await TabSpinner({ directory: '/Users/x/Atlas' }))
  await hooks.event({ event: { type: 'session.status',
    properties: { status: { type: 'busy' } } } })
  await sleep(300)
  const mid = readTitles(tty).filter(t => /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Atlas$/.test(t))
  assert.ok(mid.length >= 2, `session.status busy запускает кадры (есть ${mid.length})`)
  await hooks.event({ event: { type: 'session.status',
    properties: { status: { type: 'idle' } } } })
  const after = readTitles(tty).length
  await sleep(300)
  const titles = readTitles(tty)
  assert.equal(titles[titles.length - 1], '✓ Atlas',
    'session.status idle мгновенно гасит и пишет ✓')
  assert.equal(titles.length, after, 'после status=idle кадров нет')
  console.log('ok  9 - session.status busy/idle — авторитетные границы хода')
}

async function case10_status_idle_without_busy_is_noop() {
  const tty = join(tmp, 'noop.bin')
  const TabSpinner = await loadPlugin(tty, 'noop')
  const hooks = track(await TabSpinner({ directory: '/Users/x/Atlas' }))
  await hooks.event({ event: { type: 'session.status',
    properties: { status: { type: 'idle' } } } })
  await sleep(300)
  const titles = readTitles(tty)
  assert.equal(titles.filter(t => t !== '✓ Atlas').length, 0,
    'idle без анимации не плодит кадры (один ✓ максимум)')
  assert.ok(titles.length <= 1, 'ровно один ✓ и ничего больше')
  console.log('ok  10 - status=idle в idle-состоянии — no-op с одним ✓')
}

for (const c of [case1_probe_on_part_updated, case2_probe_on_message_updated,
                 case3_headless_guard, case4_project_fallback,
                 case5_busy_events_animate_frames, case6_idle_stops_and_writes_check,
                 case7_error_stops_animation, case8_no_stacked_intervals,
                 case9_status_busy_starts_idle_stops, case10_status_idle_without_busy_is_noop]) {
  try { await c() }
  catch (e) { failed++; console.error(`FAIL ${c.name}: ${e.message}`) }
}

for (const h of active) { try { await h.event({ event: { type: 'session.idle' } }) } catch {} }
rmSync(tmp, { recursive: true, force: true })
if (failed) { console.error(`\n${failed} провалено`); process.exit(1) }
console.log('\nвсе кейсы зелёные')
