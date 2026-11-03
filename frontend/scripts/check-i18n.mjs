// Fails when the locale files drift: keys present in one language but not the
// other, or keys no longer referenced anywhere in src/. Keys must be referenced
// as full string literals (t('section.key')) — there is no dynamic key building.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LOCALES = ['en', 'fr']
const SRC = new URL('../src/', import.meta.url).pathname

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return v && typeof v === 'object' ? flatten(v, key) : [key]
  })

const sources = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'i18n' ? [] : sources(p)
    return /\.tsx?$/.test(name) ? [readFileSync(p, 'utf8')] : []
  })

const keys = Object.fromEntries(
  LOCALES.map((l) => [l, new Set(flatten(JSON.parse(readFileSync(join(SRC, 'i18n', `${l}.json`), 'utf8'))))]),
)
const code = sources(SRC).join('\n')
const problems = []

for (const a of LOCALES) {
  for (const b of LOCALES) {
    if (a === b) continue
    for (const k of keys[a]) if (!keys[b].has(k)) problems.push(`${k}: in ${a}.json but missing from ${b}.json`)
  }
}

// i18next plural forms (key_one, key_other, …) are referenced by their base key.
const referenced = (k) => [k, k.replace(/_(zero|one|two|few|many|other)$/, '')].some(
  (candidate) => ['\'', '"', '`'].some((q) => code.includes(`${q}${candidate}${q}`)),
)
for (const k of keys.en) if (!referenced(k)) problems.push(`${k}: not referenced in src/`)

if (problems.length) {
  console.error(`i18n check failed (${problems.length}):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`i18n OK: ${keys.en.size} keys, ${LOCALES.join('/')} in sync, all referenced`)
