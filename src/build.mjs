// Static site generator for the SYC study site.
// Usage:  node src/build.mjs     (no dependencies, Node 18+)
// Input:  src/content/**.md, src/styles/**.css, src/scripts/app.js, src/assets/img/**
// Output: docs/  (ready for GitHub Pages)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, inline } from './lib/markdown.mjs';
import { esc } from './lib/highlight.mjs';
import { LANGS, LANG_NAMES, UI } from './lib/i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'docs');
const CONTENT = path.join(SRC, 'content');
const IMG_SRC = path.join(SRC, 'assets', 'img');

const pad = (n) => String(n).padStart(2, '0');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const warnings = [];
const warn = (m) => { warnings.push(m); console.warn('  ! ' + m); };

const manifest = JSON.parse(read(path.join(IMG_SRC, 'manifest.json')));
const usedImages = new Set();

/* ---------------- content files ---------------- */
function parseContent(file) {
  const text = read(file);
  const parts = text.split(/^=== (pl|en|ru) ===\s*$/m);
  const shared = parts[0];
  const codes = {};
  shared.replace(/^@@code (\S+)(?: lang=(\w+))?(?: title="([^"]*)")?\n([\s\S]*?)\n@@end\s*$/gm, (_, name, lang, title, code) => {
    codes[name] = { lang: lang || 'cpp', title: title || '', code };
    return '';
  });
  const langs = {};
  for (let i = 1; i < parts.length; i += 2) {
    const lang = parts[i];
    const raw = parts[i + 1].replace(/^\n+/, '');
    const sep = raw.indexOf('\n---\n');
    const meta = {};
    raw.slice(0, sep).split('\n').forEach((l) => { const m = /^(\w+):\s*(.*)$/.exec(l); if (m) meta[m[1]] = m[2].trim(); });
    const rest = raw.slice(sep + 5);
    const [body, cheat] = rest.split(/^=== cheat ===\s*$/m);
    langs[lang] = { meta, body, cheat: cheat || '' };
  }
  return { codes, langs };
}

function loadCode(name, local) {
  if (local[name]) return local[name];
  const f = path.join(CONTENT, 'code', name);
  if (fs.existsSync(f)) {
    const ext = path.extname(name).slice(1);
    return { lang: { ino: 'cpp', c: 'cpp', cpp: 'cpp', asm: 'asm', s: 'asm' }[ext] || '', title: name, code: read(f) };
  }
  throw new Error(`Unknown code reference "${name}"`);
}

/* ---------------- page registry ---------------- */
const pages = [];
const add = (p) => { if (p.src && !fs.existsSync(path.join(CONTENT, p.src))) { warn(`missing source ${p.src}`); return; } pages.push(p); };
add({ id: 'home', kind: 'page', nav: 'home', src: 'pages/home.md', out: 'index.html' });
add({ id: 'grading', kind: 'page', nav: 'grading', src: 'pages/grading.md', out: 'grading.html' });
for (let n = 1; n <= 15; n++) add({ id: 'lec' + n, kind: 'lecture', nav: 'lectures', num: n, src: `lectures/${pad(n)}.md`, out: `lectures/${pad(n)}.html` });
for (let n = 1; n <= 15; n++) add({ id: 'lab' + n, kind: 'lab', nav: 'labs', num: n, src: `labs/${pad(n)}.md`, out: `labs/${pad(n)}.html` });
pages.push({ id: 'lectures', kind: 'list', of: 'lecture', nav: 'lectures', out: 'lectures/index.html' });
pages.push({ id: 'labs', kind: 'list', of: 'lab', nav: 'labs', out: 'labs/index.html' });
pages.push({ id: 'cheats', kind: 'cheats', nav: 'cheats', out: 'cheatsheets.html' });

for (const p of pages) if (p.src) p.data = parseContent(path.join(CONTENT, p.src));
const byId = Object.fromEntries(pages.map((p) => [p.id, p]));
const ofKind = (k) => pages.filter((p) => p.kind === k);

const meta = (p, lang) => {
  if (p.data) {
    const l = p.data.langs[lang];
    if (!l) throw new Error(`${p.src}: missing language section "${lang}"`);
    return l.meta;
  }
  const ui = UI[lang];
  if (p.id === 'lectures') return { title: ui.lectures };
  if (p.id === 'labs') return { title: ui.labs };
  return { title: ui.cheats };
};

/* ---------------- helpers ---------------- */
const relOf = (out) => '../'.repeat(out.split('/').length - 1);

function makeCtx(page, lang) {
  const rel = relOf(page.out);
  const ui = UI[lang];
  const ctx = {
    ui, lang, rel, file: `${page.src || page.id} [${lang}]`, toc: [],
    resolveLink(href) {
      let m;
      if ((m = /^lec:(\d+)(#.*)?$/.exec(href))) return `${rel}lectures/${pad(m[1])}.html${m[2] || ''}`;
      if ((m = /^lab:(\d+)(#.*)?$/.exec(href))) return `${rel}labs/${pad(m[1])}.html${m[2] || ''}`;
      if ((m = /^page:(\w+)(#.*)?$/.exec(href))) {
        const t = byId[m[1]];
        if (!t) { warn(`${ctx.file}: unknown link ${href}`); return '#'; }
        return rel + t.out + (m[2] || '');
      }
      return href;
    },
    image(src) {
      if (!manifest[src]) { warn(`${ctx.file}: missing image ${src}`); return { url: '#', w: 1, h: 1 }; }
      usedImages.add(src);
      return { url: `${rel}../assets/img/${src}`, w: manifest[src][0], h: manifest[src][1] };
    },
    code(name) { return loadCode(name, page.data ? page.data.codes : {}); },
    widget(name, arg) { return widget(name, arg, ctx); },
  };
  return ctx;
}

const kicker = (p, ui) => (p.kind === 'lecture' ? `${ui.lecture} ${p.num}` : p.kind === 'lab' ? `${ui.lab} ${p.num}` : '');

function cards(kind, ctx) {
  const ui = ctx.ui;
  return `<ul class="cards">\n${ofKind(kind).map((p) => {
    const m = meta(p, ctx.lang);
    return `<li class="cards__item"><a class="card" href="${ctx.rel}${p.out}">
<span class="card__num">${p.num}</span>
<span class="card__body"><span class="card__kicker">${esc(kicker(p, ui))}</span><span class="card__title">${inline(m.title, ctx)}</span>${m.lead ? `<span class="card__text">${inline(m.lead, ctx)}</span>` : ''}</span>
</a></li>`;
  }).join('\n')}\n</ul>`;
}

function schedule(ctx) {
  const ui = ctx.ui;
  const t = {
    pl: { first: 'Data pierwszego wykładu', firstLab: 'Data pierwszych ćwiczeń', hint: 'Wpisz daty z planu zajęć — tabela sama policzy kolejne tygodnie (co 7 dni, bez świąt; dane zostają tylko w Twojej przeglądarce).', pts: 'Punkty', none: '— (bez punktów)', clear: 'Wyczyść' },
    en: { first: 'Date of the first lecture', firstLab: 'Date of the first lab', hint: 'Enter the dates from your timetable — the table works out the following weeks (every 7 days, holidays ignored; the data stays in your browser only).', pts: 'Points', none: '— (not graded)', clear: 'Clear' },
    ru: { first: 'Дата первой лекции', firstLab: 'Дата первой лабораторной', hint: 'Введите даты из расписания — таблица сама посчитает следующие недели (каждые 7 дней, без учёта праздников; данные остаются только в вашем браузере).', pts: 'Баллы', none: '— (без баллов)', clear: 'Сбросить' },
  }[ctx.lang];
  const rows = [];
  for (let n = 1; n <= 15; n++) {
    const lec = byId['lec' + n], lab = byId['lab' + n];
    const cell = (p) => (p ? `<a class="link" href="${ctx.rel}${p.out}">${inline(meta(p, ctx.lang).title, ctx)}</a>` : '—');
    rows.push(`<tr class="table__row">
<td class="table__cell table__cell--center">${n}</td>
<td class="table__cell">${cell(lec)}<span class="schedule__date" data-date="lecture" data-week="${n}"></span></td>
<td class="table__cell">${cell(lab)}<span class="schedule__date" data-date="lab" data-week="${n}"></span></td>
<td class="table__cell table__cell--center">${n === 1 ? t.none : '5'}</td>
</tr>`);
  }
  return `<div class="schedule" data-schedule data-locale="${ctx.lang}">
<div class="schedule__controls">
<label class="schedule__field"><span class="schedule__label">${t.first}</span><input class="schedule__input" type="date" data-start="lecture"></label>
<label class="schedule__field"><span class="schedule__label">${t.firstLab}</span><input class="schedule__input" type="date" data-start="lab"></label>
<button class="button button--ghost" type="button" data-schedule-clear>${t.clear}</button>
</div>
<p class="schedule__hint">${t.hint}</p>
<div class="table-wrap"><table class="table">
<thead class="table__head"><tr class="table__row"><th class="table__cell table__cell--head">${ui.week}</th><th class="table__cell table__cell--head">${ui.lecture}</th><th class="table__cell table__cell--head">${ui.lab}</th><th class="table__cell table__cell--head">${t.pts}</th></tr></thead>
<tbody class="table__body">
${rows.join('\n')}
</tbody></table></div>
</div>`;
}

function widget(name, arg, ctx) {
  if (name === 'cards') return cards(arg === 'labs' ? 'lab' : 'lecture', ctx);
  if (name === 'schedule') return schedule(ctx);
  throw new Error(`${ctx.file}: unknown widget {{${name}}}`);
}

/* ---------------- templates ---------------- */
function layout(page, lang, { title, main, sidebar, description }) {
  const ui = UI[lang];
  const rel = relOf(page.out);
  const assets = `${rel}../assets`;
  const nav = [['home', ui.home, 'index.html'], ['lectures', ui.lectures, 'lectures/index.html'], ['labs', ui.labs, 'labs/index.html'], ['grading', ui.grading, 'grading.html'], ['cheats', ui.cheats, 'cheatsheets.html']];
  const navHtml = nav.map(([id, label, href]) => `<li class="nav__item"><a class="nav__link${page.nav === id ? ' nav__link--active' : ''}" href="${rel}${href}"${page.nav === id ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`).join('\n');
  const langHtml = LANGS.map((l) => `<a class="lang-switch__link${l === lang ? ' lang-switch__link--active' : ''}" href="${rel}../${l}/${page.out}" hreflang="${l}" lang="${l}" data-lang="${l}" title="${LANG_NAMES[l]}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`).join('');
  const alternates = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${rel}../${l}/${page.out}">`).join('\n');
  const fullTitle = page.id === 'home' ? ui.siteTitle : `${title} — SYC`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || ui.description)}">
${alternates}
<link rel="icon" href="${assets}/favicon.svg" type="image/svg+xml">
<script>(function(){try{var t=localStorage.getItem('syc-theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t);localStorage.setItem('syc-lang','${lang}')}catch(e){}})();</script>
<link rel="stylesheet" href="${assets}/css/style.css">
</head>
<body class="page${sidebar ? ' page--with-sidebar' : ''}">
<a class="skip-link" href="#main">${esc(ui.skip)}</a>
<header class="header">
<div class="header__inner">
<a class="logo" href="${rel}index.html"><span class="logo__mark">SYC</span><span class="logo__text">${esc(ui.siteShort)}</span></a>
<button class="header__burger" type="button" aria-expanded="false" aria-controls="nav" data-nav-toggle><span class="header__burger-box" aria-hidden="true"></span><span class="header__burger-label">${esc(ui.menu)}</span></button>
<nav class="nav" id="nav" aria-label="${esc(ui.menu)}">
<ul class="nav__list">
${navHtml}
</ul>
</nav>
<div class="header__tools">
<div class="lang-switch" role="group" aria-label="${esc(ui.language)}">${langHtml}</div>
<button class="theme-toggle" type="button" data-theme-toggle aria-label="${esc(ui.theme)}" title="${esc(ui.theme)}"><span class="theme-toggle__icon theme-toggle__icon--light" aria-hidden="true">☀️</span><span class="theme-toggle__icon theme-toggle__icon--dark" aria-hidden="true">🌙</span></button>
</div>
</div>
</header>
<div class="layout${sidebar ? ' layout--with-sidebar' : ''}">
${sidebar || ''}
<main class="layout__main" id="main">
${main}
</main>
</div>
<footer class="footer">
<div class="footer__inner">
<p class="footer__text">${esc(ui.footer)}</p>
<p class="footer__text footer__text--muted">${esc(ui.footerNote)}</p>
</div>
</footer>
<dialog class="modal" data-modal aria-label="${esc(ui.cheatTitle)}">
<div class="modal__bar"><p class="modal__title">📋 ${esc(ui.cheatTitle)}</p><button class="modal__close" type="button" data-modal-close aria-label="${esc(ui.close)}">✕</button></div>
<div class="modal__body" data-modal-body></div>
</dialog>
<dialog class="lightbox" data-lightbox aria-label="${esc(ui.zoom)}">
<button class="lightbox__close" type="button" data-lightbox-close aria-label="${esc(ui.close)}">✕</button>
<img class="lightbox__img" alt="" data-lightbox-img>
<p class="lightbox__caption" data-lightbox-caption></p>
</dialog>
<script>window.SYC_UI=${JSON.stringify({ copy: ui.copy, copied: ui.copied, copyFail: ui.copyFail })};</script>
<script src="${assets}/js/app.js" defer></script>
</body>
</html>
`;
}

function sidebarHtml(page, lang, toc) {
  const ui = UI[lang];
  const rel = relOf(page.out);
  let html = '<aside class="sidebar" data-sidebar>\n';
  if (toc.length >= 2) {
    html += `<nav class="toc" aria-label="${esc(ui.onThisPage)}">
<p class="toc__title">${esc(ui.onThisPage)}</p>
<ol class="toc__list">
${toc.map((t) => `<li class="toc__item"><a class="toc__link" href="#${t.id}">${t.html}</a></li>`).join('\n')}
</ol>
</nav>\n`;
  }
  if (page.kind === 'lecture' || page.kind === 'lab') {
    const label = page.kind === 'lecture' ? ui.allLectures : ui.allLabs;
    html += `<nav class="side-nav" aria-label="${esc(label)}">
<p class="side-nav__title">${esc(label)}</p>
<ol class="side-nav__list">
${ofKind(page.kind).map((p) => `<li class="side-nav__item"><a class="side-nav__link${p === page ? ' side-nav__link--active' : ''}" href="${rel}${p.out}"${p === page ? ' aria-current="page"' : ''}><span class="side-nav__num">${p.num}</span><span class="side-nav__text">${esc(stripMd(meta(p, lang).short || meta(p, lang).title))}</span></a></li>`).join('\n')}
</ol>
</nav>\n`;
  }
  return html + '</aside>';
}

const stripMd = (s) => s.replace(/[*`$]/g, '');

function legend(ui) {
  return `<p class="legend"><span class="own-badge" aria-hidden="true">✚</span> <span class="legend__text">= ${esc(ui.legendOwn)}</span></p>`;
}

function pager(page, lang) {
  const ui = UI[lang];
  const rel = relOf(page.out);
  const list = ofKind(page.kind);
  const i = list.indexOf(page);
  const link = (p, dir) => (p ? `<a class="pager__link pager__link--${dir}" href="${rel}${p.out}"><span class="pager__dir">${dir === 'prev' ? '← ' + esc(ui.prev) : esc(ui.next) + ' →'}</span><span class="pager__title">${esc(kicker(p, ui))}: ${esc(stripMd(meta(p, lang).title))}</span></a>` : '<span class="pager__link pager__link--empty"></span>');
  return `<nav class="pager" aria-label="${esc(ui.prev)} / ${esc(ui.next)}">\n${link(list[i - 1], 'prev')}\n${link(list[i + 1], 'next')}\n</nav>`;
}

function related(page, lang) {
  const ui = UI[lang];
  const rel = relOf(page.out);
  let target = null, label = '';
  if (page.kind === 'lecture') { target = byId['lab' + (page.num + 1)]; label = ui.relatedLab; }
  if (page.kind === 'lab') { target = byId['lec' + Math.max(page.num - 1, 1)]; label = ui.relatedLecture; }
  if (!target) return '';
  return `<a class="button button--ghost" href="${rel}${target.out}">${esc(label)}: ${esc(kicker(target, ui))} →</a>`;
}

/* ---------------- render pages ---------------- */
const cheatStore = {}; // lang -> [{page, html}]

function renderContentPage(page, lang) {
  const ui = UI[lang];
  const ctx = makeCtx(page, lang);
  const l = page.data.langs[lang];
  const body = render(l.body, ctx);
  const toc = ctx.toc.slice();
  let cheat = '';
  if (l.cheat.trim()) {
    const cctx = makeCtx(page, lang);
    cctx.toc = [];
    const chtml = render(l.cheat, cctx).replace(/<h2 class="article__h2" id="[^"]*">/g, '<h3 class="article__h3">').replace(/<\/h2>/g, '</h3>');
    (cheatStore[lang] ||= []).push({ page, html: chtml });
    cheat = `<section class="cheat" id="cheat" data-cheat>
<h2 class="cheat__title">📋 ${esc(ui.cheatTitle)}</h2>
<p class="cheat__hint">${esc(ui.cheatHint)}</p>
<div class="cheat__body">
${chtml}
</div>
</section>`;
  }
  const isUnit = page.kind === 'lecture' || page.kind === 'lab';
  const actions = [];
  if (cheat) actions.push(`<a class="button button--primary" href="#cheat" data-cheat-open>📋 ${esc(ui.cheatBtn)}</a>`);
  const rel = related(page, lang);
  if (rel) actions.push(rel);
  const main = `<article class="article article--${page.kind}">
<header class="article__header">
${isUnit ? `<p class="article__kicker">${esc(kicker(page, ui))}</p>` : ''}
<h1 class="article__title">${inline(l.meta.title, ctx)}</h1>
${l.meta.lead ? `<p class="article__lead">${inline(l.meta.lead, ctx)}</p>` : ''}
${actions.length ? `<div class="article__actions">${actions.join('\n')}</div>` : ''}
${legend(ui)}
</header>
<div class="article__body">
${body}
</div>
${cheat}
${isUnit ? pager(page, lang) : ''}
</article>
${cheat ? `<a class="fab" href="#cheat" data-cheat-open title="${esc(ui.cheatBtn)}"><span class="fab__icon" aria-hidden="true">📋</span><span class="fab__label">${esc(ui.cheatBtn)}</span></a>` : ''}`;
  const sidebar = isUnit || toc.length >= 3 ? sidebarHtml(page, lang, toc) : '';
  return layout(page, lang, { title: stripMd(isUnit ? `${kicker(page, ui)}. ${l.meta.title}` : l.meta.title), main, sidebar, description: l.meta.lead ? stripMd(l.meta.lead) : '' });
}

function renderListPage(page, lang) {
  const ui = UI[lang];
  const ctx = makeCtx(page, lang);
  const title = page.of === 'lecture' ? ui.lectures : ui.labs;
  const main = `<article class="article article--list">
<header class="article__header"><h1 class="article__title">${esc(title)}</h1></header>
<div class="article__body">
${cards(page.of, ctx)}
</div>
</article>`;
  return layout(page, lang, { title, main });
}

function renderCheatsPage(page, lang) {
  const ui = UI[lang];
  const rel = relOf(page.out);
  const items = cheatStore[lang] || [];
  const toc = items.map((it, i) => ({ id: 'c' + (i + 1), html: `${esc(kicker(it.page, ui))}. ${esc(stripMd(meta(it.page, lang).title))}` }));
  const main = `<article class="article article--cheats">
<header class="article__header">
<h1 class="article__title">${esc(ui.cheats)}</h1>
<p class="article__lead">${esc(ui.cheatHint)}</p>
<div class="article__actions"><button class="button button--primary" type="button" data-print>🖨️ ${esc(ui.printAll)}</button></div>
${legend(ui)}
</header>
<div class="article__body">
${items.map((it, i) => `<section class="cheat cheat--inline" id="c${i + 1}">
<h2 class="cheat__title"><a class="link" href="${rel}${it.page.out}">${esc(kicker(it.page, ui))}. ${esc(stripMd(meta(it.page, lang).title))}</a></h2>
<div class="cheat__body">
${it.html.replaceAll(`"${relOf(it.page.out)}`, `"${rel}`)}
</div>
</section>`).join('\n')}
</div>
</article>`;
  return layout(page, lang, { title: ui.cheats, main, sidebar: sidebarHtml(page, lang, toc) });
}

/* ---------------- build ---------------- */
console.log('Building SYC site…');
fs.rmSync(OUT, { recursive: true, force: true });

for (const lang of LANGS) {
  for (const page of pages) {
    let html;
    if (page.kind === 'list') html = renderListPage(page, lang);
    else if (page.kind === 'cheats') html = renderCheatsPage(page, lang);
    else html = renderContentPage(page, lang);
    write(path.join(OUT, lang, page.out), html);
  }
}

// styles: base first, then blocks (alphabetical)
const cssDirs = ['base', 'blocks'];
let css = '/* Generated from src/styles — edit the sources, not this file. */\n';
for (const d of cssDirs) {
  const dir = path.join(SRC, 'styles', d);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.css')).sort()) css += `\n/* ===== ${d}/${f} ===== */\n` + read(path.join(dir, f));
}
write(path.join(OUT, 'assets', 'css', 'style.css'), css);
write(path.join(OUT, 'assets', 'js', 'app.js'), read(path.join(SRC, 'scripts', 'app.js')));
write(path.join(OUT, 'assets', 'favicon.svg'), read(path.join(SRC, 'assets', 'favicon.svg')));
for (const img of usedImages) {
  const dst = path.join(OUT, 'assets', 'img', img);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(IMG_SRC, img), dst);
}
write(path.join(OUT, '.nojekyll'), '');
write(path.join(OUT, 'index.html'), `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SYC — Systemy cyfrowe i podstawy elektroniki</title>
<script>(function(){var l='pl';try{var s=localStorage.getItem('syc-lang');var n=(navigator.language||'pl').slice(0,2).toLowerCase();l=s||(['pl','en','ru'].indexOf(n)>=0?n:(n==='uk'||n==='be'?'ru':'pl'))}catch(e){}location.replace(l+'/index.html')})();</script>
<noscript><meta http-equiv="refresh" content="0; url=pl/index.html"></noscript>
</head>
<body>
<p><a href="pl/index.html">Polski</a> · <a href="en/index.html">English</a> · <a href="ru/index.html">Русский</a></p>
</body>
</html>
`);
write(path.join(OUT, '404.html'), `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>404 — SYC</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>404</h1><p>Nie ma takiej strony · Page not found · Страница не найдена</p>
<p><a href="./">← SYC</a></p></body></html>
`);

if (process.argv.includes('--unused')) {
  const unused = Object.keys(manifest).filter((k) => !usedImages.has(k));
  console.log(`Unused images (${unused.length}):\n` + unused.join('\n'));
}
console.log(`Done: ${pages.length} pages × ${LANGS.length} languages, ${usedImages.size} images, ${warnings.length} warning(s).`);
