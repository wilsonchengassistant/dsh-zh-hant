# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased — 0.1.2

_Not yet published. `npm view dsh-zh-hant version` still reports `0.1.1`._

### Added

- The `directory-browser` namespace — the shell's own directory picker
  (`@deepseek-ai/dsh-client-ui-directory-picker-browse`), 13 keys:
  選擇工作區目錄 · 主目錄 · 新建資料夾 · 資料夾名稱 · 在「{name}」中新建資料夾 ·
  未命名資料夾 · 建立 · 取消 · 開啟 · 編輯路徑 · 載入中… ·
  資料夾過多，僅顯示開頭部分。 · 顯示隱藏檔案.
  The pack goes from **63 namespaces / 2,711 keys** to **64 / 2,724**. Every
  pre-existing namespace is byte-identical — only this one is new.

### Fixed

- **The extractor now reads a dictionary registered from inside a loop.**
  `dsh-client-ui-directory-picker-browse` registers with

  ```js
  const dictionaries = [["zh", { … }], ["en", { … }]]
  for (const [locale, dict] of dictionaries)
    ctx.locale.register(LOCALE_NS, locale, dict)
  ```

  a shape the parser did not recognise: at the call site it saw two unresolved
  shorthand names (`{ locale, dict }`), produced no pairs, and dropped the
  namespace with a `NO DICTIONARY FOUND` line and no error. The parser now maps
  the loop variable back to the collection it iterates and reads the
  `[locale, dict]` pairs from there. Without this the namespace fell back to
  the shell's own Simplified `zh`, so a Traditional user saw one Simplified
  screen inside an otherwise Traditional app.

### Changed

- `extract-locales.mjs --strict` now exits non-zero when a registered namespace
  yields no dictionary, and `npm test` asserts it. A namespace the pack cannot
  cover is not a rounding error — the app registers it itself, so the gap
  degrades silently. That is exactly why the `directory-browser` gap went
  unnoticed: nothing failed, the pack simply had one namespace fewer. The
  build itself stays lenient, so an unrecognised shape in a future DSH release
  cannot block a rebuild.
- The README's coverage counts (62 namespaces / 2,699 keys) were stale — they
  had not been updated since 0.1.0. They now match the build (64 / 2,724).

## 0.1.1 — 2026-10-21

- Cover the `quickWorkspace` namespace registered by `dsh-quick-workspace`.
  The namespace set goes 62 → 63 with no other namespace or key count
  changing. Traditional users had seen that namespace fall back to Simplified.

## 0.1.0 — 2026-10-19

First public release.

- Registers `zh-Hant` (繁體中文) in the shared locale catalog with `fallback: zh`
  and a dictionary for every namespace the installed web GUI registers.
- The dictionary is generated, not hand-written: `scripts/extract-locales.mjs`
  reads every `ctx.locale.register()` call site out of the installed client
  bundles, and `scripts/build-dictionaries.mjs` converts the values with
  OpenCC `cn → tw → twp` and splices them into `src/client.js`.
- `cn → tw` is run to completion before the Taiwan variant pass, because a
  single `cn → twp` pass is not a fixed point.
- `fallback` is `zh`, not `en`: a key a future DSH release adds degrades to
  Simplified instead of dropping an English string into a Chinese menu.
- Third-party copy is left alone on purpose — `dshmarket` never calls
  `ctx.locale`, so its 「插件市场」 panel title stays as it is.
- No Host patch, no change to any other plugin, zero runtime dependencies.
