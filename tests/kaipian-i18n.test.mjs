import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 界面文案以中文原文为 key、缺英文就回退中文——缺一条，英文用户就看到一句中文。
// 9-24 查出字幕细调整块（字号 / 位置 / 字色…）一直没英文，就是因为没人数过。
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dict = fs.readFileSync(path.join(root, 'src', 'kaipian', 'i18n.ts'), 'utf-8');
const keys = new Set([...dict.matchAll(/'((?:[^'\\]|\\.)*)'\s*:/g)].map((m) => m[1]));
const LIT = String.raw`'((?:[^'\\]|\\.)*)'`;

test('界面里每条 t(\'中文\') 都有英文', () => {
  const missing = [];
  for (const f of ['Kaipian.tsx', 'Characters.tsx', 'Scenes.tsx']) {
    const src = fs.readFileSync(path.join(root, 'src', 'kaipian', f), 'utf-8');
    const lits = [...src.matchAll(new RegExp(String.raw`\bt\(` + LIT + String.raw`\)`, 'g'))].map((m) => m[1]);
    // field('k', '标签', '占位') 在里面调 t(label) / t(ph)：字面量不在 t( 后面，要单独捞
    for (const m of src.matchAll(new RegExp(String.raw`\bfield\('\w+',\s*` + LIT + String.raw`,\s*` + LIT, 'g'))) lits.push(m[1], m[2]);
    for (const k of new Set(lits)) if (/[一-鿿]/.test(k) && !keys.has(k)) missing.push(`${f}: ${k}`);
  }
  assert.deepEqual(missing, [], `英文界面会露出这些中文：\n${missing.join('\n')}`);
});
