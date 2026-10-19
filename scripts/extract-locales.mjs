#!/usr/bin/env node
// Extract every dictionary registered through ctx.locale.register() from installed
// DSH client bundles (and profile plugins), so a language pack can be built from
// the real key set instead of guesswork.
//
//   node scripts/extract-locales.mjs                     # stats to stdout
//   node scripts/extract-locales.mjs --json out.json     # full {ns:{zh,en}} dump
//   node scripts/extract-locales.mjs --locale zh         # dump only zh values
//   node scripts/extract-locales.mjs --root <dir> ...    # add a node_modules root
//
// The bundles are unminified esbuild output, so every dictionary is a plain
// object literal reachable from a `locale.register()` call — including through
// shorthand (`{ zh, en }`), renamed consts (`{ zh: zh$1 }`), object spread
// (`...frequencyZh`) and shared string consts. Anything else is skipped, which
// is why the "no dicts" namespaces below are worth re-checking after a DSH
// upgrade.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const DSH_PKGS = process.env.DSH_PACKAGES
  ?? '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const EXTRA_ROOTS = [
  `${homedir()}/.dsh/profiles/web/node_modules`,
  resolve(import.meta.dirname, '../..'),
]

/** Index every top-level `const|let|var NAME = <value>` in a file. */
function constValues(src) {
  const out = new Map()
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g
  for (const m of src.matchAll(re)) {
    const start = m.index + m[0].length
    if (src[start] === '"' || src[start] === "'" || src[start] === '`') {
      try { out.set(m[1], evalLiteral(src.slice(start, skipString(src, start) + 1), out)) } catch { /* not a plain string */ }
      continue
    }
    if (!'{(['.includes(src[start])) continue
    const end = balanced(src, start)
    if (end < 0) continue
    try { out.set(m[1], evalLiteral(src.slice(start, end + 1), out)) } catch { /* not a literal */ }
  }
  return out
}

/** Split an object-literal body into `{ key, value }` pairs, keeping shorthand. */
function objectMembers(body) {
  const members = []
  let depth = 0
  let start = 1                                   // skip the outer `{`
  const flush = (end) => {
    const entry = body.slice(start, end).trim()
    start = end + 1
    if (!entry) return
    let d = 0
    let colon = -1
    for (let i = 0; i < entry.length; i++) {
      const c = entry[i]
      if (c === '"' || c === "'" || c === '`') { i = skipString(entry, i); continue }
      if (c === '(' || c === '{' || c === '[') d++
      else if (c === ')' || c === '}' || c === ']') d--
      else if (c === ':' && d === 0) { colon = i; break }
    }
    members.push(colon < 0
      ? [entry, undefined]                                  // shorthand: `zh`
      : [entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()])
  }
  for (let i = 1; i < body.length - 1; i++) {                // skip the outer braces
    const c = body[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(body, i); continue }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    else if (c === ',' && depth === 0) flush(i)
  }
  flush(body.length - 1)
  return members
}

/** Scan forward from `start` (first char of an opening bracket) to its match. */
function balanced(src, start) {
  const open = { '(': ')', '{': '}', '[': ']' }[src[start]]
  if (!open) throw new Error(`not a bracket: ${src[start]}`)
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i)
      continue
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) return i }
  }
  return -1
}

/** Return the index of the closing quote of the string starting at `start`. */
function skipString(src, start) {
  const q = src[start]
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue }
    if (src[i] === q) return i
  }
  throw new Error('unterminated string')
}

/** Split `args` text on top-level commas. */
function splitArgs(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts.map(s => s.trim()).filter(Boolean)
}

/** Pull `NAME: { ... }` out of an object-literal body. */
function memberObject(src, member) {
  const re = new RegExp(`(?:^|[{,\\s])${member}\\s*:\\s*\\{`, 'g')
  for (const m of src.matchAll(re)) {
    const brace = src.indexOf('{', m.index + m[0].length - 1)
    const end = balanced(src, brace)
    if (end < 0) continue
    return src.slice(brace, end + 1)
  }
  return undefined
}

function evalLiteral(text, consts) {
  // Dictionary literals reference module-level consts (spread fragments, shared
  // strings), which are out of scope inside `new Function`. `with` is sloppy-mode
  // only, which is exactly what a `new Function` body is, so bind them there.
  if (consts && consts.size) {
    const scope = Object.create(null)
    for (const [k, v] of consts) scope[k] = v
    try {
      // eslint-disable-next-line no-new-func
      return new Function('__c', `with (__c) { return (${text}) }`)(scope)
    } catch { /* fall through to a bare evaluation */ }
  }
  // eslint-disable-next-line no-new-func
  return new Function(`return (${text})`)()
}

/** Find every locale.register() call site in one client bundle. */
function harvest(file) {
  const src = readFileSync(file, 'utf8')
  const consts = constValues(src)
  const found = []
  const re = /locale\s*\.\s*register\s*\(/g
  for (const m of src.matchAll(re)) {
    const open = src.indexOf('(', m.index + m[0].length - 1)
    const close = balanced(src, open)
    if (close < 0) continue
    const args = splitArgs(src.slice(open + 1, close))
    if (args.length < 2) continue

    const nsArg = args[0]
    const ns = nsArg.startsWith('"') ? JSON.parse(nsArg) : consts.get(nsArg)
    if (typeof ns !== 'string') continue

    const pairs = []
    if (args[1].startsWith('"')) {
      // register(ns, 'ja', { ... }) — one locale per call
      const locale = JSON.parse(args[1])
      if (!args[2]) continue
      pairs.push([locale, evalLiteral(args[2], consts)])
    } else {
      // register(ns, { zh, en }) — values may be inline or a module-level const
      const body = args[1].startsWith('{') ? args[1] : `{${args.slice(1).join(',')}}`
      for (const [key, value] of objectMembers(body)) {
        // Values are inline literals, module-level consts (`{ zh, en }`), or
        // references to esbuild-renamed consts (`{ zh: zh$1, en: en$1 }`).
        const dict = value === undefined || /^[\w$]+$/.test(value)
          ? consts.get(value ?? key)
          : evalLiteral(value, consts)
        if (dict && typeof dict === 'object') pairs.push([key.replace(/^["']|["']$/g, ''), dict])
      }
    }
    found.push({ ns, pairs, file })
  }
  return found
}

/** Yield `<pkg>/lib/client.js` for every package under one node_modules root. */
function* bundles(root) {
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return }
  const dirs = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name === '.bin' || e.name === '.pnpm') continue
    if (e.name.startsWith('@')) dirs.push(...readdirSync(join(root, e.name), { withFileTypes: true })
      .filter(s => s.isDirectory()).map(s => join(root, e.name, s.name)))
    else dirs.push(join(root, e.name))
  }
  for (const d of dirs) {
    const f = join(d, 'lib', 'client.js')
    try { statSync(f); yield f } catch { /* not a client plugin */ }
  }
}

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const localeAt = args.indexOf('--locale')
const only = localeAt >= 0 ? args[localeAt + 1] : undefined

const roots = [DSH_PKGS, ...EXTRA_ROOTS]
for (let i = 0; i < args.length - 1; i++) if (args[i] === '--root') roots.push(resolve(args[i + 1]))
const files = new Set()
for (const r of roots) for (const f of bundles(r)) files.add(f)

const merged = new Map()
const sources = new Map()
let sites = 0
for (const f of [...files].sort()) {
  let hits
  try { hits = harvest(f) } catch (err) {
    console.error(`  ! ${f}: ${err.message}`)
    continue
  }
  for (const { ns, pairs } of hits) {
    sites++
    if (!merged.has(ns)) merged.set(ns, {})
    for (const [locale, dict] of pairs) {
      const target = merged.get(ns)
      target[locale] = { ...(target[locale] ?? {}), ...dict }
    }
    sources.set(ns, [...new Set([...(sources.get(ns) ?? []), f.replace(DSH_PKGS, 'dsh')])])
  }
}

if (jsonAt >= 0) {
  const out = only
    ? Object.fromEntries([...merged].map(([ns, d]) => [ns, only in d ? d[only] : undefined]).filter(([, d]) => d))
    : Object.fromEntries([...merged].sort(([a], [b]) => a.localeCompare(b)))
  const target = resolve(args[jsonAt + 1] ?? 'dsh-locales.json')
  writeFileSync(target, JSON.stringify(out, null, 1))
  console.log(`wrote ${target}`)
}

const rows = [...merged].sort(([a], [b]) => a.localeCompare(b))
let keys = 0
const empty = []
console.log(`\n${files.size} bundles scanned, ${sites} register() sites, ${rows.length} namespaces\n`)
for (const [ns, d] of rows) {
  const zh = Object.keys(d.zh ?? {}).length
  const en = Object.keys(d.en ?? {}).length
  if (zh === 0) empty.push(ns)
  keys += Math.max(zh, en)
  console.log(`  ${ns.padEnd(34)} zh:${String(zh).padStart(4)}  en:${String(en).padStart(4)}  ${(sources.get(ns) ?? [])[0] ?? ''}`)
}
console.log(`\n  TOTAL distinct keys (max of zh/en): ${keys}`)
if (empty.length) console.log(`  NO DICTIONARY FOUND: ${empty.join(', ')}\n`)
else console.log('')
