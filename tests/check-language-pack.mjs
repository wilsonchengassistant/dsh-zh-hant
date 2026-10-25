#!/usr/bin/env node
// Behaviour checks for the language pack. No framework, no browser.
//
//   node tests/check-language-pack.mjs
//
// 1. `apply(ctx)` registers exactly one language and one dictionary per namespace.
// 2. A `zh-Hant` id already owned by another pack is a warning, not a boot failure.
// 3. Every value is a fixed point of the converter — the strongest available
//    statement that no Simplified character survived into the pack. (A leftover
//    设 would convert again, so it fails; the round-trip t2s cannot catch this,
//    because Simplified is what it converts *to*.)
// 4. The key set is identical to the installed bundles' `zh` dictionaries, so no
//    lookup can fall through to a missing key.
import { readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { pipeline } from '../scripts/pipeline.mjs'

const HERE = dirname(new URL(import.meta.url).pathname)
const ROOT = resolve(HERE, '..')
const failures = []
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail && !ok ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/** Load lib/client.js the way the browser module loader does, with a stub ctx. */
function mount(exportsObject = {}) {
  let captured
  globalThis.window = {
    __ModuleLoader__: {
      load(registration) { captured = registration.factory(() => ({})) },
    },
  }
  const source = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  // eslint-disable-next-line no-new-func
  new Function('window', 'module', 'exports', source)(globalThis.window, exportsObject, exportsObject)
  delete globalThis.window
  return captured
}

/** A stand-in for LocaleRuntime recording exactly what the pack asks of it. */
function stubLocale({ failLanguage = false, ownedByOthers = [] } = {}) {
  const calls = { languages: [], dictionaries: [] }
  // Namespaces another owner already holds: the service allows one dictionary
  // per (namespace, locale), so the pack's request for one of these throws.
  const seen = new Set(ownedByOthers)
  return {
    calls,
    addLanguage(input) {
      if (failLanguage || calls.languages.length) throw new Error(`locale "${input.id}" is already registered`)
      calls.languages.push(input)
      return () => calls.languages.splice(calls.languages.indexOf(input), 1)
    },
    register(ns, localeOrDicts, dict) {
      const pair = `${ns} ${typeof localeOrDicts === 'string' ? localeOrDicts : 'dicts'}`
      if (seen.has(pair)) {
        throw new Error(`locale namespace "${ns}" already has locale "${localeOrDicts}"`)
      }
      seen.add(pair)
      calls.dictionaries.push(dict === undefined ? [ns, localeOrDicts] : [ns, localeOrDicts, dict])
      return () => {}
    },
  }
}

function run({ failLanguage = false, ownedByOthers = [] } = {}) {
  const effects = []
  const ctx = {
    locale: stubLocale({ failLanguage, ownedByOthers }),
    effect(fn, label) { effects.push({ fn, label }); return fn() },
  }
  mount().apply(ctx)
  return { ctx, effects, namespaces: Object.keys(mount().DICTIONARIES).length }
}

console.log('\ndsh-zh-hant\n')

// 1 ─ registration shape
{
  const { ctx, effects, namespaces } = run()
  check(ctx.locale.calls.languages.length === 1, 'registers exactly one language')
  const [language] = ctx.locale.calls.languages
  check(language?.id === 'zh-Hant', 'language id is zh-Hant', JSON.stringify(language))
  check(language?.fallback === 'zh', 'falls back to the built-in zh locale', JSON.stringify(language))
  check((language?.label ?? '').includes('繁體'), 'label is self-describing', language?.label)
  check(ctx.locale.calls.dictionaries.length === namespaces,
    `registers a dictionary per namespace (${namespaces})`, `got ${ctx.locale.calls.dictionaries.length}`)
  check(ctx.locale.calls.dictionaries.every(([ns, locale]) => typeof ns === 'string' && locale === 'zh-Hant'),
    'every dictionary uses the three-argument (ns, locale, dict) form')
  check(new Set(ctx.locale.calls.dictionaries.map(([ns]) => ns)).size === namespaces, 'no namespace registered twice')
  check(effects.length === 2, 'language and dictionaries are separate effects', `got ${effects.length}`)
  const total = ctx.locale.calls.dictionaries.reduce((sum, [, , dict]) => sum + Object.keys(dict).length, 0)
  check(total > 2000, `pack carries the full key set (${total} keys)`)
}

// 2 ─ a second pack owning the id must not take the boot down
{
  const { ctx } = run({ failLanguage: true })
  check(ctx.locale.calls.dictionaries.length === 0, 'duplicate id skips dictionaries instead of throwing')
}

// 3 ─ converter fixed point (no Simplified residue)
{
  async function loadOpenCC() {
    for (const dir of [process.env.OPENCC_JS, join(ROOT, 'node_modules'), '/tmp/zhh-build/node_modules'].filter(Boolean)) {
      for (const base of [dir, dirname(dir)]) {
        try {
          const require = createRequire(join(base, 'noop.js'))
          const mod = await import(pathToFileURL(require.resolve('opencc-js')).href)
          return mod.Converter ? mod : mod.default
        } catch { /* next */ }
      }
    }
    return undefined
  }
  const OpenCC = await loadOpenCC()
  if (OpenCC === undefined) {
    console.log('  skip converter fixed-point check (opencc-js not installed)')
  } else {
    const { DICTIONARIES } = mount()
    // Character-level check, not the full idiom profile: `程序 ID` is what
    // OpenCC's Taiwan variant pass legitimately produces for 进程 ID, and running
    // the phrase pass again would rewrite it to 程式 ID. What must never survive
    // is a Simplified-only CHARACTER, which `cn → t` is the right detector for.
    //
    // Two characters are exempt: OpenCC prefers a variant that is itself correct
    // Traditional — 游標 is the standard word for "cursor" (`cn → t` rewrites 游 →
    // 遊), and 社群 is normally written with 群 (`cn → t` rewrites it to 羣).
    // Flagging our own good output would train everyone to ignore this check.
    const TRADITIONAL_VARIANTS = new Set(['游', '群'])
    const convert = pipeline(OpenCC, 't')
    const residue = []
    let values = 0
    for (const [ns, dict] of Object.entries(DICTIONARIES ?? {})) {
      for (const [key, value] of Object.entries(dict)) {
        values++
        const converted = convert(value)
        if (converted === value) continue
        const offending = [...value]
          .filter((char, i) => converted[i] !== char && !TRADITIONAL_VARIANTS.has(char))
        if (offending.length) residue.push(`${ns}/${key}: ${[...new Set(offending)].join('')} in ${value.slice(0, 30)}`)
      }
    }
    check(values > 2000, `checked every value (${values})`)
    check(residue.length === 0, 'no Simplified-only character survives',
      `${residue.length} left, e.g. ${residue.slice(0, 3).join(' | ')}`)
  }
}

// 4 ─ key parity with the installed bundles
{
  const work = join(tmpdir(), `dsh-zh-hant-keys-${process.pid}`)
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'extract-locales.mjs'), '--json', work, '--locale', 'zh'],
      { stdio: ['ignore', 'ignore', 'inherit'] })
    const source = JSON.parse(readFileSync(work, 'utf8'))
    const { DICTIONARIES } = mount()
    const missing = []
    const extra = []
    for (const [ns, dict] of Object.entries(source)) {
      if (DICTIONARIES[ns] === undefined) { missing.push(`${ns} (namespace)`); continue }
      for (const key of Object.keys(dict)) if (!(key in DICTIONARIES[ns])) missing.push(`${ns}/${key}`)
      for (const key of Object.keys(DICTIONARIES[ns])) if (!(key in dict)) extra.push(`${ns}/${key}`)
    }
    check(missing.length === 0, 'covers every installed zh key', missing.slice(0, 5).join(', '))
    check(extra.length === 0, 'invents no keys the app never asks for', extra.slice(0, 5).join(', '))
  } finally {
    execFileSync('/bin/rm', ['-rf', work])
  }
}

// 5 ─ the extractor recognises every registration shape the bundles use
//
// A namespace the extractor cannot parse is a namespace the pack cannot cover:
// the app registers it itself, so it falls back to the shell's own Simplified
// `zh` and shows up as one Simplified screen inside an otherwise Traditional
// app. The parser once missed `directory-browser` because that bundle
// registers from inside `for (const [locale, dict] of dictionaries)`, and the
// gap was invisible — the pack simply had one namespace fewer.
{
  const result = spawnSync(process.execPath, [
    join(ROOT, 'scripts', 'extract-locales.mjs'), '--locale', 'zh', '--strict',
  ], { encoding: 'utf8' })
  check(result.status === 0, 'every registered namespace yields a dictionary',
    (result.stderr || '').trim().split('\n')[0])
}

// 6 ─ one namespace already owned by someone else costs only that namespace
//
// The locale service allows one dictionary per (namespace, locale) and throws
// on a second. A plugin that registers `zh-Hant` for a namespace the pack also
// covers would, in an unguarded loop, abort the registration of every
// namespace after it — 56 of 72 at the time of writing. One bad namespace must
// cost that namespace alone.
{
  const { DICTIONARIES } = mount()
  const all = Object.keys(DICTIONARIES)
  // A realistic case: `dsh-file-download` once registered `fileDownload` +
  // `zh-Hant` itself, which the pack also covers.
  const claimed = ['fileDownload']
  const { ctx, namespaces } = run({ ownedByOthers: claimed.map((ns) => `${ns} zh-Hant`) })
  check(ctx.locale.calls.dictionaries.length === namespaces - claimed.length,
    'a duplicate costs exactly one namespace, not the rest',
    `registered ${ctx.locale.calls.dictionaries.length} of ${namespaces}`)
  check(ctx.locale.calls.dictionaries.length > 0,
    'the remaining namespaces still register')
  check(!ctx.locale.calls.dictionaries.some(([ns, locale]) => ns === 'fileDownload' && locale === 'zh-Hant'),
    'the namespace another owner holds is left to it')
  check(ctx.locale.calls.dictionaries.length >= namespaces - 2,
    `the namespaces after the duplicate still register (${all.length} total)`)
}

console.log(failures.length ? `\n${failures.length} check(s) failed\n` : '\nall checks passed\n')
process.exit(failures.length ? 1 : 0)
