#!/usr/bin/env node
// Build lib/client.js from src/client.js + the Simplified Chinese dictionaries that
// the installed DSH client bundles actually register.
//
//   node scripts/build-dictionaries.mjs                  # twp (Taiwan idiom), default
//   node scripts/build-dictionaries.mjs --profile hk     # Hong Kong idiom
//   node scripts/build-dictionaries.mjs --profile t      # character-only conversion
//   node scripts/build-dictionaries.mjs --check          # fail if lib/ is stale
//
// Why generated rather than hand-written: the web GUI has ~2,700 translation keys
// across ~63 namespaces, and DeepSeek ships new ones with every release. The only
// maintainable source of truth is the `zh` dictionary the running build already
// contains, so this reads it out of the installed bundles and converts it.
//
// opencc-js is a BUILD-time dependency only. Nothing is converted in the browser:
// `node scripts/build-dictionaries.mjs` runs offline against a local checkout, and
// the published plugin carries a plain object literal and zero dependencies.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pipeline } from './pipeline.mjs'

const HERE = dirname(new URL(import.meta.url).pathname)
const ROOT = resolve(HERE, '..')
const MARKER = 'var DICTIONARIES = null /* @generated */'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i < 0 ? fallback : argv[i + 1]
}
const profile = flag('profile', 'twp')
const check = argv.includes('--check')

/** opencc-js is optional and dev-only; look for it wherever it was installed. */
async function loadOpenCC() {
  const candidates = [
    process.env.OPENCC_JS,
    join(ROOT, 'node_modules'),
    '/tmp/zhh-build/node_modules',
  ].filter(Boolean)
  for (const dir of candidates) {
    // `dir` may be a node_modules directory or the project holding it.
    for (const base of [dir, dirname(dir)]) {
      try {
        const require = createRequire(join(base, 'noop.js'))
        const mod = await import(pathToFileURL(require.resolve('opencc-js')).href)
        return mod.Converter ? mod : mod.default
      } catch { /* try the next candidate */ }
    }
  }
  throw new Error(
    'opencc-js not found. Build-time only:\n'
    + '  mkdir -p .build && cd .build && npm init -y && npm i opencc-js@1.4.2\n'
    + '  cd - && OPENCC_JS=$PWD/.build/node_modules node scripts/build-dictionaries.mjs',
  )
}
const work = mkdtempSync(join(tmpdir(), 'dsh-zh-hant-'))
try {
  // 1. Harvest the installed `zh` dictionaries: { "<namespace>": { "<key>": "<zh>" } }.
  const dump = join(work, 'zh.json')
  execFileSync(process.execPath, [join(HERE, 'extract-locales.mjs'), '--json', dump, '--locale', 'zh'],
    { stdio: ['ignore', 'ignore', 'inherit'] })
  const source = JSON.parse(readFileSync(dump, 'utf8'))

  // 2. Convert every value. Keys are opaque identifiers — never translate them,
  //    and never let a value with no Chinese in it drift.
  const OpenCC = await loadOpenCC()
  const convert = pipeline(OpenCC, profile)
  const out = {}
  let keys = 0
  let changed = 0
  for (const [ns, dict] of Object.entries(source)) {
    const target = {}
    for (const [key, value] of Object.entries(dict)) {
      const next = typeof value === 'string' ? convert(value) : value
      target[key] = next
      keys++
      if (next !== value) changed++
    }
    out[ns] = target
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))

  // 3. Splice the generated literal into the source template.
  const template = readFileSync(join(ROOT, 'src', 'client.js'), 'utf8')
  if (!template.includes(MARKER)) throw new Error(`src/client.js no longer contains ${MARKER}`)
  const literal = JSON.stringify(sorted, null, 0)
  const built = template.replace(MARKER, `var DICTIONARIES = ${literal}`)

  if (check) {
    const current = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
    if (current !== built) {
      console.error('lib/client.js is stale — run: npm run build')
      process.exit(1)
    }
    console.log(`lib/client.js is up to date (${keys} keys, profile ${profile})`)
  } else {
    writeFileSync(join(ROOT, 'lib', 'client.js'), built)
    const namespaces = Object.keys(sorted).length
    console.log(
      `wrote lib/client.js — ${namespaces} namespaces, ${keys} keys `
      + `(${changed} converted, profile ${profile}, ${(built.length / 1024).toFixed(0)} KB)`,
    )
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
