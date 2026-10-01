// Config layer: presets, custom frames, templates, sanitization, fallbacks.
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { parseConfig, renderTemplate, PRESETS } from '../src/tab-spinner.js'

test('defaults: braille preset, check idle, 120ms, standard templates', () => {
  const c = parseConfig({})
  assert.deepEqual(c.frames, PRESETS.braille)
  assert.equal(c.idle, '✓')
  assert.equal(c.frameMs, 120)
  assert.equal(c.titleBusy, '{frame} {project}')
  assert.equal(c.titleIdle, '{idle} {project}')
})

test('preset names resolve: dots, ascii, clock', () => {
  assert.deepEqual(parseConfig({ TAB_SPINNER_FRAMES: 'dots' }).frames, PRESETS.dots)
  assert.deepEqual(parseConfig({ TAB_SPINNER_FRAMES: 'ascii' }).frames, PRESETS.ascii)
  assert.deepEqual(parseConfig({ TAB_SPINNER_FRAMES: 'clock' }).frames, PRESETS.clock)
})

test('custom frames: split by spaces or commas, multi-char frames allowed', () => {
  assert.deepEqual(parseConfig({ TAB_SPINNER_FRAMES: 'a b c' }).frames, ['a', 'b', 'c'])
  assert.deepEqual(parseConfig({ TAB_SPINNER_FRAMES: '>> , == , <<' }).frames, ['>>', '==', '<<'])
})

test('invalid frames fall back to braille: unknown preset, single frame, empty', () => {
  assert.deepEqual(parseConfig({ TAB_SPINNER_FRAMES: 'no-such-preset' }).frames, PRESETS.braille)
  assert.deepEqual(parseConfig({ TAB_SPINNER_FRAMES: 'only-one' }).frames, PRESETS.braille)
  assert.deepEqual(parseConfig({ TAB_SPINNER_FRAMES: '   ' }).frames, PRESETS.braille)
})

test('ESC and BEL are stripped from every user string', () => {
  const c = parseConfig({
    TAB_SPINNER_IDLE: 'a\x1b[2Jb\x07c',
    TAB_SPINNER_TITLE: '{frame}\x1b {project}\x07',
    TAB_SPINNER_FRAMES: 'x\x1b y\x07 z',
  })
  assert.equal(c.idle, 'abc')
  assert.ok(!c.titleBusy.includes('\x1b') && !c.titleBusy.includes('\x07'))
  assert.deepEqual(c.frames, ['x', 'y', 'z'])
})

test('frameMs: valid number passes, out-of-range and garbage fall back to 120', () => {
  assert.equal(parseConfig({ TAB_SPINNER_FRAME_MS: '250' }).frameMs, 250)
  assert.equal(parseConfig({ TAB_SPINNER_FRAME_MS: '1' }).frameMs, 120)
  assert.equal(parseConfig({ TAB_SPINNER_FRAME_MS: '99999' }).frameMs, 120)
  assert.equal(parseConfig({ TAB_SPINNER_FRAME_MS: 'fast' }).frameMs, 120)
})

test('silenceMs: same clamping rules', () => {
  assert.equal(parseConfig({ TAB_SPINNER_SILENCE_MS: '5000' }).silenceMs, 5000)
  assert.equal(parseConfig({ TAB_SPINNER_SILENCE_MS: 'junk' }).silenceMs, 12000)
})

test('renderTemplate substitutes frame, idle, project; unknown tokens left as-is', () => {
  assert.equal(renderTemplate('{frame} {project}', { frame: '⠋', idle: '✓', project: 'Atlas' }), '⠋ Atlas')
  assert.equal(renderTemplate('{idle}|{project}', { frame: '⠋', idle: '✓', project: 'X' }), '✓|X')
  assert.equal(renderTemplate('{unknown}', { frame: '⠋', idle: '✓', project: 'X' }), '{unknown}')
})

test('title templates fall back to defaults when emptied by sanitization', () => {
  const c = parseConfig({ TAB_SPINNER_TITLE: '\x1b\x07' })
  assert.equal(c.titleBusy, '{frame} {project}')
})
