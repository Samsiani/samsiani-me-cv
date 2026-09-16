// B · Studio — body markup only. The document shell and <head> live in src/shared/document.mjs.
// Pure function: (c = localize(site, lang), ctx) -> HTML string. Spec: docs/plans/layout-studio.md.
import { esc, pad } from '../../shared/escape.mjs';
import { UI_ICONS } from '../../shared/icons.mjs';
import { copyButton, themeToggle, printButton, langSwitchLink, orderedSections, isExternal } from '../../shared/fragments.mjs';

const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/;
const chars = (s) => [...String(s)];
// Estimated rendered width in px, per-glyph averages measured in Archivo / Noto Sans Georgian on macOS.
// Georgian carries ~10 % headroom: Linux Chromium draws it up to ~8 % wider (whole-pixel glyph advances).
const est = (s, latin, georgian) => chars(s).reduce((n, ch) => n + (GEORGIAN.test(ch) ? georgian : latin), 0);

// Smallest viewport width at which the header nav bar fits on one line (plan §2.3); 'menu' = never.
function navTier(c, order) {
  const nav = order.reduce((n, sec) => n + est(sec.navLabel, 6.3, 9.2), 0) + 20 * (order.length - 1); // 13px links, 20px gaps
  const brand = 40 + est(c.hero.name, 6.6, 8.9); // 30px mark + 10px gap + 13px/500 name
  const controls = 86 + 34 + 28 + est(c.ui.print, 7.0, 9.1) + 24; // lang switch, theme, print (label + padding), 2 gaps
  const need = nav + brand + controls + 64 + 80; // two 32px header gaps + two 40px gutters
  return [1280, 1440, 1600].find((bp) => need <= bp) ?? 'menu';
}

// Longest word of the display name, clamped to the range the CSS knows (plan §3.1).
const nameLen = (c) => Math.min(12, Math.max(4, ...[c.hero.givenName, c.hero.familyName].map((w) => chars(w).length)));

// Longest word of a fact or language value + script flag, for the tile's font-size fit (plan §3.1).
const fitAttrs = (v) => {
  const n = Math.max(0, ...String(v).split(/\s+/).map((w) => chars(w).length));
  return `${n > 6 ? ` data-len="${Math.min(12, n)}"` : ''}${GEORGIAN.test(v) ? ' data-geo' : ''}`;
};

const skillName = (i) => (i.detail ? `${esc(i.label)} <span class="st-sub">· ${esc(i.detail)}</span>` : esc(i.label));

export function renderBody(c, ctx) {
  const { alt } = ctx;
  const s = c.sections;
  const order = orderedSections(c);
  const navLinks = (withIdx) =>
    order
      .map((sec, i) => `<a href="#${sec.id}" data-spy="${sec.id}">${withIdx ? `<span class="st-menu-idx">${pad(i + 1)}</span>` : ''}${esc(sec.navLabel)}</a>`)
      .join('');

  const head = (sec, i) => `
      <div class="st-head">
        <div class="st-head-title"><span class="st-idx" aria-hidden="true">${pad(i)}</span><h2 id="${sec.id}-title">${esc(sec.title)}</h2></div>
        ${sec.lead ? `<p class="st-lead">${esc(sec.lead)}</p>` : ''}
      </div>`;

  const sq = (l) => `<span class="st-sq" data-level="${l}" aria-hidden="true"></span>`;
  const lvl = (l) => `<span class="st-lvl" data-level="${l}">${sq(l)}<span>${esc(c.ui.levels[l])}</span></span>`;

  const contactRows = c.contact.items
    .map((i) => {
      const ext = isExternal(i.href);
      const link = `<a class="st-clink" href="${esc(i.href)}"${ext ? ' rel="me noopener"' : ''}><span>${esc(i.value)}</span>${ext ? UI_ICONS.arrow : ''}</a>`;
      return `<div class="st-crow"><dt class="sr-only">${esc(i.label)}</dt><dd>${link}${i.copy ? copyButton(i.value, c.ui, 'st-copy') : ''}</dd></div>`;
    })
    .join('');

  const primary = s.contact.primary;
  // links show their label ("GitHub"), email/phone show the value ("+995 599 62 03 03")
  const ghost = (i) =>
    isExternal(i.href)
      ? `<a class="st-btn st-btn--ghost" href="${esc(i.href)}" rel="me noopener">${esc(i.label)}</a>`
      : `<a class="st-btn st-btn--ghost" href="${esc(i.href)}">${esc(i.value)}</a>`;

  // the bento: a removed line leaves no element, and the facts tile is drawn for 1–4 facts only
  const facts = c.hero.facts;
  const meta = [c.hero.location, c.hero.availability].filter(Boolean).join(' · ');
  const nameTile = [
    c.hero.eyebrow ? `<p class="st-eyebrow">${esc(c.hero.eyebrow)}</p>` : '',
    `<h1 class="st-name" data-len="${nameLen(c)}">${esc(c.hero.givenName)}<br>${esc(c.hero.familyName)}</h1>`,
  ].filter(Boolean).join('\n        ');
  const roleLines = [
    `<p class="st-role">${esc(c.hero.role)}</p>`,
    c.hero.subrole ? `<p class="st-subrole">${esc(c.hero.subrole)}</p>` : '',
    c.hero.tagline ? `<p class="st-tagline">${esc(c.hero.tagline)}</p>` : '',
  ].filter(Boolean).join('\n          ');
  const roleTile = [
    `<div>
          ${roleLines}
        </div>`,
    meta ? `<p class="st-loc"><span class="st-dot" aria-hidden="true"></span><span>${esc(meta)}</span></p>` : '',
  ].filter(Boolean).join('\n        ');
  const bento = [
    `<div class="st-tile st-t-name">
        ${nameTile}
      </div>`,
    `<div class="st-tile st-t-role">
        ${roleTile}
      </div>`,
    `<div class="st-tile st-t-contact">
        <p class="st-tile-label" id="hero-contact">${esc(c.contact.heading)}</p>
        <dl class="st-contact" aria-labelledby="hero-contact">${contactRows}</dl>
      </div>`,
    facts.length ? `<ul class="st-facts"${facts.length === 4 ? '' : ` style="--n:${facts.length}"`}>
        ${facts.map((f) => `<li class="st-tile st-fact"${fitAttrs(f.value)}><span class="st-fact-value">${esc(f.value)}</span><span class="st-fact-label">${esc(f.label)}</span></li>`).join('')}
      </ul>` : '',
  ].filter(Boolean).join('\n      ');

  const hero = `<section class="st-hero" aria-label="${esc(c.ui.atAGlance)}">
    <div class="st-wrap st-bento">
      ${bento}
    </div>
  </section>`;

  // one body per section (keyed by its anchor); the band, its number and the head are shared
  const BODY = {
    profile: (sec) => `<div class="st-prose">${sec.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`,
    skills: (sec) => `<p class="st-legend" aria-label="${esc(c.ui.legend)}">
        ${['core', 'strong', 'working'].map((l) => `<span class="st-legend-item">${sq(l)}<span>${esc(c.ui.levels[l])} — ${esc(c.ui.levelHints[l])}</span></span>`).join('')}
      </p>
      <div class="st-groups">
        ${sec.groups
          .map(
            (g) => `
        <div class="st-group">
          <div class="st-group-head"><h3>${esc(g.title)}</h3>${g.lead ? `<p>${esc(g.lead)}</p>` : ''}</div>
          <div class="st-cells-c"><ul class="st-cells">${g.items.map((i) => `<li class="st-cell"><span class="st-cell-name">${skillName(i)}</span>${lvl(i.level)}</li>`).join('')}</ul></div>
        </div>`
          )
          .join('')}
      </div>`,
    abilities: (sec) => `<ol class="st-rows">
        ${sec.items.map((a, i) => `<li class="st-row"><div class="st-row-head"><span class="st-num" aria-hidden="true">${pad(i + 1)}</span><h3>${esc(a.title)}</h3></div><p class="st-row-text">${esc(a.text)}</p></li>`).join('')}
      </ol>`,
    'work-style': (sec) => `<div class="st-cells-c st-cells-c--band"><ul class="st-cells st-cells--2">
        ${sec.items.map((w) => `<li class="st-cell st-cell--text"><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></li>`).join('')}
      </ul></div>`,
    principles: (sec) => `<ol class="st-rows st-rows--wide">
        ${sec.items.map((p, i) => `<li class="st-row"><div class="st-row-head"><span class="st-num" aria-hidden="true">${pad(i + 1)}</span><h3>${esc(p.title)}</h3></div><p class="st-row-text">${esc(p.text)}</p></li>`).join('')}
      </ol>`,
    experience: (sec) => `<ol class="st-rows">
        ${sec.items
          .map(
            (e) => `<li class="st-row"><div class="st-row-meta"><span class="st-period">${esc(e.period)}</span></div><div class="st-row-body"><h3>${esc(e.role)}</h3><p class="st-org">${e.orgHref ? `<a href="${esc(e.orgHref)}" rel="noopener">${esc(e.org)}</a>` : esc(e.org)}</p><p class="st-row-text">${esc(e.text)}</p></div></li>`
          )
          .join('')}
      </ol>`,
    languages: (sec) => `<ul class="st-langs">
        ${sec.langs.map((l) => `<li class="st-tile st-fact"${fitAttrs(l.name)}><span class="st-fact-value">${esc(l.name)}</span><span class="st-fact-label">${esc(l.level)}</span></li>`).join('')}
      </ul>`,
    contact: (sec) => {
      if (!primary) return '';
      const row = [sec.cta ? `<a class="st-btn" href="${esc(primary.href)}">${esc(sec.cta)}</a>` : '', ...sec.buttons.map(ghost)].filter(Boolean);
      return `<div class="st-contact-body">
        <a class="st-bigmail" href="${esc(primary.href)}"><span>${esc(primary.value)}</span>${UI_ICONS.arrow}</a>${row.length ? `
        <div class="st-cta-row">
          ${row.join('\n          ')}
        </div>` : ''}
      </div>`;
    },
  };
  const WRAP = { languages: ' st-lang-band' };
  const band = (sec, n) => `<section class="st-band sec" id="${sec.id}" aria-labelledby="${sec.id}-title">
    <div class="st-wrap${WRAP[sec.id] || ''}">${head(sec, n)}
      ${BODY[sec.id](sec)}
    </div>
  </section>`;

  return `<header class="st-top" data-nav="${navTier(c, order)}">
  <div class="st-top-in">
    <a class="st-brand" href="${c.path}"><span class="st-mark" aria-hidden="true">${esc(ctx.person.monogram)}</span><span class="st-brand-name">${esc(c.hero.name)}</span></a>
    <nav class="st-nav" aria-label="${esc(c.ui.nav)}">${navLinks(false)}</nav>
    <div class="st-ctls">
      <nav class="st-lang" aria-label="${esc(c.ui.language)}">
        <span aria-current="page" lang="${c.lang}">${esc(c.selfLabel)}</span>
        ${langSwitchLink(c, alt, c.altLabel, ` title="${esc(c.altTitle)}"`)}
      </nav>
      ${themeToggle(c.ui, 'st-ctl st-ctl-icon')}
      ${printButton(c.ui, 'st-ctl st-ctl-primary')}
      <details class="st-menu menu">
        <summary aria-label="${esc(c.ui.nav)}">${UI_ICONS.menu}</summary>
        <nav class="st-menu-list" aria-label="${esc(c.ui.nav)}">${navLinks(true)}</nav>
      </details>
    </div>
  </div>
</header>

<main id="main">
  ${[hero, ...order.map((sec, i) => band(sec, i + 1))].join('\n\n  ')}
</main>

<footer class="st-foot">
  <div class="st-wrap st-foot-in">
    <span>© ${esc(ctx.updated.slice(0, 4))} ${esc(c.hero.name)} · ${esc(c.ui.updated)} <time datetime="${esc(ctx.updated)}">${esc(ctx.updated)}</time>${c.ui.builtWith ? ` · ${esc(c.ui.builtWith)}` : ''}</span>
    <span class="st-foot-links">${langSwitchLink(c, alt, c.altTitle)}<a href="#main">${esc(c.ui.top)} ↑</a></span>
  </div>
</footer>`;
}
