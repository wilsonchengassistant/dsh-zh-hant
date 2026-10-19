// OpenCC conversion pipelines.
//
// A single `cn → twp` pass is NOT a fixed point: `STPhrases` turns 发送 into 發送
// and `TWPhrases` then has nothing Simplified left to rewrite, so 待发送附件 comes
// out as 待發送附件 and only becomes 待傳送附件 on a SECOND pass. Running
// `cn → tw` to completion first and applying the Taiwan variant pass afterwards
// is both more idiomatic and idempotent, which is what makes
// `tests/check-language-pack.mjs` able to assert "no Simplified residue".
//
// opencc-js's `hk` targets are variant-only maps, not S→T conversions — piping
// them after `cn → tw` re-simplifies 設置/網絡 — so there is no Hong Kong
// profile here. `tw` is the conservative choice for readers who want the
// characters changed and nothing else.
export const PROFILES = {
  /** Characters only: 设置 → 設置, 默认 → 默認. */
  t: [['cn', 't']],
  /** Characters plus Taiwan word forms without the phrase pass: 文件 → 文件. */
  tw: [['cn', 'tw']],
  /** Full Taiwan idiom. The default: 檔案, 資料夾, 軟體, 網路, 設定. */
  twp: [['cn', 'tw'], ['tw', 'twp']],
}

/** Build a `(text) => text` converter for one named profile. */
export function pipeline(OpenCC, name = 'twp') {
  const steps = PROFILES[name]
  if (steps === undefined) throw new Error(`unknown profile "${name}" — expected one of ${Object.keys(PROFILES).join(', ')}`)
  const converters = steps.map(([from, to]) => OpenCC.Converter({ from, to }))
  return (text) => converters.reduce((value, convert) => convert(value), text)
}
