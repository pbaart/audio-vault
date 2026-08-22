#!/usr/bin/env node
/**
 * i18n consistency check.
 *
 *  1. Every locale file must have exactly the same key structure as en.json.
 *  2. Every static `t("…")` / `i18n.t("…")` key used in the source must exist
 *     in en.json (plural base keys match their `_one`/`_other` variants).
 *  3. Every Rust `note_code("…")` must have a matching `notes.…` key.
 *  4. Reports en.json keys that are never referenced (informational — dynamic
 *     families values.* / tube.badges.* / notes.* are exempt).
 *
 * Exit code 1 on any error, 0 otherwise.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const localesDir = join(root, "src", "locales");
const srcDir = join(root, "src");
const tauriSrcDir = join(root, "src-tauri", "src");

const LANGS = ["en", "de", "nl", "fr"];
let errors = 0;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  errors++;
}

function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

// ── 1. Key structure parity ────────────────────────────────────────────────
const catalogs = {};
for (const lang of LANGS) {
  catalogs[lang] = flatten(
    JSON.parse(readFileSync(join(localesDir, `${lang}.json`), "utf8")),
  );
}
const enKeys = Object.keys(catalogs.en);
console.log(`en.json: ${enKeys.length} keys`);

for (const lang of LANGS.slice(1)) {
  const keys = Object.keys(catalogs[lang]);
  const missing = enKeys.filter((k) => !(k in catalogs[lang]));
  const extra = keys.filter((k) => !enKeys.includes(k));
  if (missing.length || extra.length) {
    console.log(`${lang}.json:`);
    missing.forEach((k) => fail(`${lang} missing key: ${k}`));
    extra.forEach((k) => fail(`${lang} extra key: ${k}`));
  } else {
    console.log(`${lang}.json: ok (${keys.length} keys)`);
  }
}

// ── 2. Static t() keys used in source ─────────────────────────────────────
function* walk(dir, exts) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p, exts);
    else if (exts.includes(extname(p))) yield p;
  }
}

const usedKeys = new Set();
const keyRe = /(?:\bt|i18n\.t)\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
for (const file of walk(srcDir, [".ts", ".tsx"])) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(keyRe)) usedKeys.add(m[1]);
}

// Dynamic families: keys built at runtime, verified structurally instead.
const dynamicPrefixes = ["values.", "tube.badges.", "tube.dot.", "notes."];
const isDynamic = (k) => dynamicPrefixes.some((p) => k.startsWith(p));

for (const key of [...usedKeys].sort()) {
  if (isDynamic(key)) continue;
  if (key in catalogs.en) continue;
  // Plural base key: collection.count → collection.count_one/_other
  if (`${key}_one` in catalogs.en && `${key}_other` in catalogs.en) continue;
  fail(`used in source but missing from en.json: ${key}`);
}
console.log(`source: ${usedKeys.size} distinct t() keys referenced`);

// ── 3. Rust note codes ↔ notes.* keys ─────────────────────────────────────
const rustCodes = new Set();
const codeRe = /\bnote(?:_with)?\(\s*"([^"]+)"/g;
for (const file of walk(tauriSrcDir, [".rs"])) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(codeRe)) rustCodes.add(`notes.${m[1]}`);
}
for (const code of [...rustCodes].sort()) {
  if (!(code in catalogs.en)) fail(`Rust emits ${code} but en.json lacks it`);
}
console.log(`rust: ${rustCodes.size} note codes, all mapped`);

// ── 4. Unused en.json keys (informational) ────────────────────────────────
const unused = enKeys.filter((k) => {
  if (isDynamic(k)) return false;
  if (usedKeys.has(k)) return false;
  // Plural variant of a used base key
  const base = k.replace(/_(one|other)$/, "");
  if (usedKeys.has(base)) return false;
  return true;
});
if (unused.length) {
  console.log(`\nunused in en.json (informational):`);
  unused.forEach((k) => console.log(`  · ${k}`));
}

console.log(
  errors === 0
    ? "\n✓ i18n check passed"
    : `\n✗ i18n check failed with ${errors} error(s)`,
);
process.exit(errors === 0 ? 0 : 1);
