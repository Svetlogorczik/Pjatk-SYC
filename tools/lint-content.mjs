// Content sanity checks:  node tools/lint-content.mjs
//  - Cyrillic letters that slipped into the Polish / English sections (look-alike characters)
//  - sections of different structure between languages (number of headings, figures, code blocks)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content');
let problems = 0;

for (const dir of ['pages', 'lectures', 'labs']) {
  for (const file of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.md')).sort()) {
    const text = fs.readFileSync(path.join(ROOT, dir, file), 'utf8');
    const parts = text.split(/^=== (pl|en|ru) ===\s*$/m);
    const stats = {};
    for (let i = 1; i < parts.length; i += 2) {
      const lang = parts[i];
      const body = parts[i + 1];
      if (lang !== 'ru') {
        body.split('\n').forEach((line, n) => {
          const m = /[Ѐ-ӿ]+/.exec(line);
          if (m) { problems++; console.log(`${dir}/${file} [${lang}] Cyrillic "${m[0]}" in: ${line.trim().slice(0, 90)}`); }
        });
      }
      stats[lang] = {
        h2: (body.match(/^## /gm) || []).length,
        h3: (body.match(/^### /gm) || []).length,
        img: (body.match(/^!\[/gm) || []).length,
        code: (body.match(/^\{\{code:|^```\w/gm) || []).length,
        callouts: (body.match(/^:::\w/gm) || []).length,
        tables: (body.match(/^\|[-: |]+\|\s*$/gm) || []).length,
        formulas: (body.match(/^\$\$/gm) || []).length,
      };
    }
    const langs = Object.keys(stats);
    for (const key of Object.keys(stats[langs[0]] || {})) {
      const values = langs.map((l) => stats[l][key]);
      if (new Set(values).size > 1) { problems++; console.log(`${dir}/${file}: different number of "${key}" → ${langs.map((l, i) => l + '=' + values[i]).join(', ')}`); }
    }
    if (langs.length !== 3) { problems++; console.log(`${dir}/${file}: languages found: ${langs.join(', ')}`); }
  }
}
console.log(problems ? `${problems} problem(s)` : 'Content OK');
