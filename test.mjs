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

async function case1_probe_on_part_updated() {
  const tty = join(tmp, 'probe.bin')
  const TabSpinner = await loadPlugin(tty, 'part')
  const hooks = await TabSpinner({ directory: '/Users/x/Atlas' })
  await hooks.event({ event: { type: 'message.part.updated', properties: {} } })
  const out = readFileSync(tty, 'utf8')
  assert.match(out, /^\x1b\]0;PROBE Atlas \d+\x07$/, 'титул = OSC 0 "PROBE Atlas <ts>"')
  console.log('ok  1 - message.part.updated пишет PROBE-титул')
}

async function case2_probe_on_message_updated() {
  const tty = join(tmp, 'probe2.bin')
  const TabSpinner = await loadPlugin(tty, 'msg')
  const hooks = await TabSpinner({ directory: '/Users/x/Atlas' })
  await hooks.event({ event: { type: 'message.updated', properties: {} } })
  assert.match(readFileSync(tty, 'utf8'), /^\x1b\]0;PROBE Atlas \d+\x07$/)
  console.log('ok  2 - message.updated тоже триггерит титул')
}

async function case3_headless_guard() {
  const tty = join(tmp, 'no-such-dir', 'tty')
  const TabSpinner = await loadPlugin(tty, 'guard')
  const hooks = await TabSpinner({ directory: '/Users/x/Atlas' })
  await hooks.event({ event: { type: 'message.part.updated', properties: {} } }) // не должен бросить
  console.log('ok  3 - недоступный TTY не роняет хук (headless guard)')
}

async function case4_project_fallback() {
  const tty = join(tmp, 'probe4.bin')
  const TabSpinner = await loadPlugin(tty, 'fallback')
  const hooks = await TabSpinner({ directory: '/' })
  await hooks.event({ event: { type: 'message.part.updated', properties: {} } })
  assert.match(readFileSync(tty, 'utf8'), /^\x1b\]0;PROBE opencode \d+\x07$/)
  console.log('ok  4 - пустой directory -> opencode')
}

for (const c of [case1_probe_on_part_updated, case2_probe_on_message_updated,
                 case3_headless_guard, case4_project_fallback]) {
  try { await c() }
  catch (e) { failed++; console.error(`FAIL ${c.name}: ${e.message}`) }
}

rmSync(tmp, { recursive: true, force: true })
if (failed) { console.error(`\n${failed} провалено`); process.exit(1) }
console.log('\nвсе кейсы зелёные')
