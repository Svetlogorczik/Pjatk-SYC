// Small Markdown dialect -> BEM HTML converter used by build.mjs (no dependencies).
//
// Blocks:  ## h2, ### h3, #### h4, paragraphs, - lists, 1. lists (nested by indent),
//          | tables |, ```lang title="…" fences, {{code:name|Title}}, ![caption](img){mod},
//          $$ formula $$, --- (rule), :::type Title … ::: (callouts), raw <html>.
// Inline:  **bold**, *em*, `code`, [text](url), $math$, {+} (author's addition badge),
//          ==mark==, [[Key]].
// Math:    \f{a}{b} fraction, ~{x} overline, _{x} subscript, ^{x} superscript, \sqrt{x}.

import { highlight, esc } from './highlight.mjs';

const CALLOUTS = new Set(['simple', 'own', 'tip', 'warn', 'def', 'example', 'task', 'solution', 'lecture', 'info', 'steps', 'check', 'gallery']);
const ICONS = { simple: '🧒', own: '✚', tip: '💡', warn: '⚠️', def: '📖', example: '🔎', task: '📝', solution: '✅', lecture: '🎓', info: 'ℹ️', steps: '🪜', check: '❓' };

/* ---------- math ---------- */
function readGroup(s, i) {
  // s[i] must be '{' ; returns [content, indexAfterClosingBrace]
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; } // escaped \{ or \}
    if (s[j] === '{') depth++;
    else if (s[j] === '}') { depth--; if (depth === 0) return [s.slice(i + 1, j), j + 1]; }
  }
  throw new Error('Unbalanced braces in math: ' + s);
}

export function renderMath(src) {
  src = src.replace(/\\left|\\right/g, '').replace(/\\,/g, ' ').replace(/ {3,}/g, '  '); // three or more spaces = a wide gap
  let out = '';
  for (let i = 0; i < src.length;) {
    if (src.startsWith('\\f{', i)) {
      const [a, j] = readGroup(src, i + 2);
      const [b, k] = readGroup(src, j);
      out += `<span class="math__frac"><span class="math__num">${renderMath(a)}</span><span class="math__den">${renderMath(b)}</span></span>`;
      i = k;
    } else if (src.startsWith('\\sqrt{', i)) {
      const [a, j] = readGroup(src, i + 5);
      out += `<span class="math__sqrt">√<span class="math__bar">${renderMath(a)}</span></span>`;
      i = j;
    } else if (src.startsWith('~{', i)) {
      const [a, j] = readGroup(src, i + 1);
      out += `<span class="math__bar">${renderMath(a)}</span>`;
      i = j;
    } else if (src.startsWith('_{', i)) {
      const [a, j] = readGroup(src, i + 1);
      out += `<sub class="math__sub">${renderMath(a)}</sub>`;
      i = j;
    } else if (src.startsWith('^{', i)) {
      const [a, j] = readGroup(src, i + 1);
      out += `<sup class="math__sup">${renderMath(a)}</sup>`;
      i = j;
    } else if (src[i] === '\\' && (src[i + 1] === '{' || src[i + 1] === '}')) {
      out += src[i + 1];
      i += 2;
    } else {
      out += esc(src[i]);
      i++;
    }
  }
  return out;
}

/* ---------- inline ---------- */
export function inline(text, ctx) {
  const stash = [];
  const keep = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };

  // code spans
  text = text.replace(/`([^`]+)`/g, (_, c) => keep(`<code class="inline-code">${esc(c)}</code>`));
  // \$ = a literal dollar sign (not math)
  text = text.replace(/\\\$/g, () => keep('$'));
  // inline math
  text = text.replace(/\$([^$\n]+)\$/g, (_, m) => keep(`<span class="math">${renderMath(m)}</span>`));
  // escape & and stray <
  text = text.replace(/&(?![a-zA-Z#][a-zA-Z0-9]*;)/g, '&amp;').replace(/<(?![a-zA-Z/!])/g, '&lt;');
  // badges / keys / marks
  text = text.replace(/\{\+\}/g, () => keep(`<span class="own-badge" title="${esc(ctx.ui.legendOwn)}" aria-label="${esc(ctx.ui.legendOwn)}">✚</span>`));
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_, k) => keep(`<kbd class="kbd">${esc(k)}</kbd>`));
  text = text.replace(/==([^=]+)==/g, '<mark class="mark">$1</mark>');
  // links
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const url = ctx.resolveLink(href);
    const ext = /^https?:/.test(url);
    return keep(`<a class="link${ext ? ' link--external' : ''}" href="${esc(url)}"${ext ? ' target="_blank" rel="noopener"' : ''}>`) + label + keep('</a>');
  });
  // bold / em
  text = text.replace(/\*\*([^*]+(?:\*(?!\*)[^*]+)*)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>');
  // restore
  let prev;
  do { prev = text; text = text.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[+n]); } while (text !== prev);
  return text;
}

/* ---------- blocks ---------- */
const RE = {
  fence: /^```(\w+)?(?:\s+title="([^"]*)")?\s*$/,
  codeRef: /^\{\{code:([\w.-]+)(?:\|(.*))?\}\}$/,
  widget: /^\{\{([\w-]+)(?::([\w-]+))?\}\}$/,
  callout: /^:::(\w+)[ \t]*(.*)$/,
  heading: /^(#{2,4})\s+(.*)$/,
  image: /^!\[(.*)\]\(([^)]+)\)(?:\{([^}]*)\})?$/,
  formula: /^\$\$(.+)\$\$$/,
  listItem: /^(\s*)([-*]|\d+\.)\s+(.*)$/,
  tableSep: /^\|(\s*:?-+:?\s*\|)+\s*$/,
};

function startsBlock(line) {
  return RE.fence.test(line) || RE.callout.test(line) || line === ':::' || RE.heading.test(line) || RE.image.test(line)
    || RE.formula.test(line) || RE.listItem.test(line) || line.startsWith('|') || line === '---' || RE.codeRef.test(line) || RE.widget.test(line);
}

function codeBlock(code, lang, title, ctx) {
  const label = title || (lang ? lang.toUpperCase() : '');
  return `<figure class="code">
<figcaption class="code__bar"><span class="code__title">${esc(label)}</span><button class="code__copy" type="button" data-copy>${esc(ctx.ui.copy)}</button></figcaption>
<pre class="code__pre" tabindex="0"><code class="code__body${lang ? ' code__body--' + lang : ''}">${highlight(code.replace(/\s+$/, ''), lang)}</code></pre>
</figure>`;
}

function figure(caption, src, mods, ctx) {
  const info = ctx.image(src);
  const cls = ['figure'].concat((mods || '').split(/\s+/).filter(Boolean).map((m) => 'figure--' + m.replace(/^\./, '')));
  const source = src.startsWith('lectures/') ? ctx.ui.srcLecture : src.startsWith('labs/') ? ctx.ui.srcLab : '';
  const cap = inline(caption, ctx);
  const alt = esc(caption.replace(/[*`$\\{}[\]]/g, ''));
  return `<figure class="${cls.join(' ')}">
<a class="figure__link" href="${info.url}" data-zoom aria-label="${esc(ctx.ui.zoom)}"><img class="figure__img" src="${info.url}" alt="${alt}" width="${info.w}" height="${info.h}" loading="lazy" decoding="async"></a>
<figcaption class="figure__caption">${cap}${source ? ` <span class="figure__source">${esc(source)}</span>` : ''}</figcaption>
</figure>`;
}

function table(rows, ctx) {
  const split = (l) => {
    // keep `code` and $math$ intact: they may contain "|"
    const hold = [];
    const safe = l.replace(/`[^`]+`|\\\$|\$[^$\n]+\$/g, (m) => { hold.push(m); return `\u0001${hold.length - 1}\u0001`; });
    return safe.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|').replace(/\u0001(\d+)\u0001/g, (_, n) => hold[+n]));
  };
  const head = split(rows[0]);
  const align = split(rows[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
  const cell = (tag, c, i) => `<${tag} class="table__cell${tag === 'th' ? ' table__cell--head' : ''}${align[i] ? ' table__cell--' + align[i] : ''}">${inline(c, ctx)}</${tag}>`;
  const body = rows.slice(2).map((r) => `<tr class="table__row">${split(r).map((c, i) => cell('td', c, i)).join('')}</tr>`).join('\n');
  return `<div class="table-wrap"><table class="table">
<thead class="table__head"><tr class="table__row">${head.map((c, i) => cell('th', c, i)).join('')}</tr></thead>
<tbody class="table__body">
${body}
</tbody></table></div>`;
}

function list(lines, ctx, opts) {
  const first = RE.listItem.exec(lines[0]);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let contentIndent = base + 2;
  for (const line of lines) {
    const m = RE.listItem.exec(line);
    if (m && m[1].length === base) {
      contentIndent = base + m[2].length + 1;
      items.push([m[3]]);
    } else {
      items[items.length - 1].push(line.trim() === '' ? '' : line.slice(Math.min(contentIndent, line.length - line.trimStart().length)));
    }
  }
  const steps = opts && opts.steps;
  const tag = ordered ? 'ol' : 'ul';
  const cls = steps ? 'steps' : 'list' + (ordered ? ' list--ordered' : '');
  const itemCls = steps ? 'steps__item' : 'list__item';
  const html = items.map((it) => {
    let inner = blocks(it, ctx, {});
    const single = inner.match(/^<p class="article__p">([\s\S]*)<\/p>$/);
    if (single && !single[1].includes('<p class="article__p">')) inner = single[1];
    return `<li class="${itemCls}">${inner}</li>`;
  }).join('\n');
  return `<${tag} class="${cls}">\n${html}\n</${tag}>`;
}

export function blocks(lines, ctx, opts = {}) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    let m;

    if ((m = RE.fence.exec(line))) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(codeBlock(buf.join('\n'), m[1] || '', m[2] || '', ctx));
      continue;
    }
    if ((m = RE.codeRef.exec(line))) {
      const c = ctx.code(m[1]);
      out.push(codeBlock(c.code, c.lang, m[2] || c.title || '', ctx));
      i++;
      continue;
    }
    if ((m = RE.widget.exec(line))) {
      out.push(ctx.widget(m[1], m[2]));
      i++;
      continue;
    }
    if ((m = RE.callout.exec(line))) {
      const type = m[1];
      if (!CALLOUTS.has(type)) throw new Error(`Unknown callout type ":::${type}" in ${ctx.file}`);
      const buf = [];
      let depth = 1;
      i++;
      while (i < lines.length) {
        if (RE.callout.test(lines[i])) depth++;
        else if (lines[i].trim() === ':::') { depth--; if (depth === 0) break; }
        buf.push(lines[i++]);
      }
      if (depth !== 0) throw new Error(`Unclosed ":::${type}" in ${ctx.file}`);
      i++;
      const inner = blocks(buf, ctx, { steps: type === 'steps' });
      if (type === 'gallery') { out.push(`<div class="gallery">\n${inner.replaceAll('<figure class="figure', '<figure class="gallery__item figure figure--tile')}\n</div>`); continue; }
      const title = m[2] ? inline(m[2], ctx) : esc(ctx.ui.callout[type]);
      const icon = `<span class="callout__icon" aria-hidden="true">${ICONS[type]}</span>`;
      if (type === 'solution') {
        out.push(`<details class="callout callout--solution">\n<summary class="callout__title">${icon}${title}</summary>\n<div class="callout__body">\n${inner}\n</div>\n</details>`);
      } else {
        out.push(`<div class="callout callout--${type}">\n<p class="callout__title">${icon}${title}</p>\n<div class="callout__body">\n${inner}\n</div>\n</div>`);
      }
      continue;
    }
    if ((m = RE.heading.exec(line))) {
      const level = m[1].length;
      const html = inline(m[2], ctx);
      if (level === 2) {
        const id = 's' + (ctx.toc.length + 1);
        ctx.toc.push({ id, html });
        out.push(`<h2 class="article__h2" id="${id}">${html}</h2>`);
      } else {
        out.push(`<h${level} class="article__h${level}">${html}</h${level}>`);
      }
      i++;
      continue;
    }
    if (line === '---') { out.push('<hr class="article__hr">'); i++; continue; }
    if ((m = RE.formula.exec(line))) { out.push(`<div class="formula"><span class="math">${renderMath(m[1].trim())}</span></div>`); i++; continue; }
    if ((m = RE.image.exec(line))) { out.push(figure(m[1], m[2], m[3], ctx)); i++; continue; }
    if (line.startsWith('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('|')) buf.push(lines[i++]);
      out.push(table(buf, ctx));
      continue;
    }
    if (RE.listItem.test(line)) {
      const buf = [];
      const base = RE.listItem.exec(line)[1].length;
      while (i < lines.length) {
        const l = lines[i];
        const lm = RE.listItem.exec(l);
        const indent = l.length - l.trimStart().length;
        if (l.trim() === '') {
          // blank line: continue the list only if the next non-blank line is indented or another item
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j >= lines.length) break;
          const nl = lines[j];
          const nIndent = nl.length - nl.trimStart().length;
          const nm = RE.listItem.exec(nl);
          if (nIndent > base || (nm && nm[1].length === base)) { buf.push(''); i++; continue; }
          break;
        }
        if ((lm && lm[1].length >= base) || indent > base) { buf.push(l); i++; continue; }
        break;
      }
      out.push(list(buf, ctx, opts));
      continue;
    }
    if (/^<[a-zA-Z!/]/.test(line)) {
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '') buf.push(lines[i++]);
      out.push(buf.join('\n'));
      continue;
    }
    // paragraph
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) buf.push(lines[i++]);
    out.push(`<p class="article__p">${inline(buf.map((l) => l.trim()).join(' '), ctx)}</p>`);
  }
  return out.join('\n');
}

export function render(md, ctx, opts) {
  return blocks(md.replace(/\r\n/g, '\n').split('\n'), ctx, opts);
}
