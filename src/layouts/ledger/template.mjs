// C · Ledger — body markup only. The document shell and <head> live in src/shared/document.mjs.
// Pure function: (c = localize(site, lang), ctx) -> HTML string. No fs, no globals, no hard-coded content.
// Spec: docs/plans/layout-ledger.md. Styles: ./styles.css (class prefix lg-).
import { esc, pad } from '../../shared/escape.mjs';
import { UI_ICONS } from '../../shared/icons.mjs';
import { copyButton, themeToggle, printButton, langSwitchLink, orderedSections, isExternal } from '../../shared/fragments.mjs';

const LEVELS = ['core', 'strong', 'working'];

// Nav-fit (spec §2.4): estimate the header's natural width from the strings it shows and return the
// smallest breakpoint at which the inline section nav fits. Constants were measured with IBM Plex / Noto
// in Chromium on macOS; Georgian carries ~10 % headroom because Linux Chromium draws it up to
// ~8 % wider (whole-pixel glyph advances). The header content is capped at 1440 px, so above that: never.
const FIT = {
  en: { nav: 5.9, gap: 20 },   // IBM Plex Sans 12.5 px: 5.81 px per character
  ka: { nav: 8.5, gap: 14 },   // Noto Sans Georgian 12 px: 7.69 px per character on macOS
};
const CH = { mono14: 9.3, mono12: 7.3, mono12_5: 7.6, btn: 7.4, geo12_5: 8.8 };
const GEO = /[Ⴀ-ჿ]/;
// With the owner's fonts the same sums are measured from the chosen files at the sizes the header really
// uses (fonts plan §5.4); the gaps and fixed paddings below are CSS and never change.
export function navFit(c, ctx) {
  const w = ctx.fonts?.overridden ? ctx.fonts.width : null;
  const k = FIT[c.lang] || FIT.en;
  const labels = orderedSections(c).map((s) => s.navLabel);
  const nav = (w ? labels.reduce((n, l) => n + w('text', l, c.lang === 'ka' ? 12 : 12.5), 0) : labels.join('').length * k.nav) + (labels.length - 1) * k.gap;
  const brand = w
    ? w('label', ctx.person.monogram, 14, { weight: 500 }) + 25 + w('label', ctx.host, 12.5)
    : ctx.person.monogram.length * CH.mono14 + 25 + ctx.host.length * CH.mono12_5;
  const perLabel = (s) => (w
    ? (GEO.test(s) ? w('georgian', s, 12.5) : w('label', s, 12))
    : [...s].reduce((n, ch) => n + (GEO.test(ch) ? CH.geo12_5 : CH.mono12), 0));
  const lang = perLabel(c.selfLabel) + perLabel(c.altLabel) + 7.3 + 12;
  const theme = 18 + perLabel(c.ui.themeShort);
  const printLabel = w
    ? (c.lang === 'ka' ? w('georgian', c.ui.print, 12.5) : w('label', c.ui.print, 11.5, { weight: 500 }))
    : [...c.ui.print].length * (c.lang === 'ka' ? CH.geo12_5 : CH.btn);
  const need = brand + lang + theme + 26 + printLabel + 2 * 16 + nav + 2 * 32 + 2 * 44;
  return 'nav-' + ([1280, 1360, 1440].find((bp) => bp >= need) || 'never');
}

export function renderBody(c, ctx) {
  const { alt } = ctx;
  const s = c.sections;
  const order = orderedSections(c);
  const num = (sec) => order.indexOf(sec) + 1; // numbers follow the section order, never hard-coded

  const navLinks = (withNumbers) =>
    order
      .map((sec) => `<a href="#${sec.id}" data-spy="${sec.id}">${withNumbers ? `<span class="n" aria-hidden="true">${pad(num(sec))}</span><span class="t">${esc(sec.navLabel)}</span>` : esc(sec.navLabel)}</a>`)
      .join('');
  const idx = (sec) => `<div class="lg-idx" aria-hidden="true"><span class="lg-n">${pad(num(sec))}</span></div>`;
  const head = (sec) => `<h2 id="${sec.id}-title">${esc(sec.title)}</h2>${sec.lead ? `<p class="lg-lead">${esc(sec.lead)}</p>` : ''}`;
  const open = (sec, extra = '') => `<section class="lg-row lg-sec${extra}" id="${sec.id}" aria-labelledby="${sec.id}-title">${idx(sec)}<div class="lg-body">${head(sec)}`;
  const close = `</div></section>`;
  const mark = (level) => `<span class="lg-dm" data-level="${level}" aria-hidden="true"></span>`;
  const hang = (sec, i) => `<span class="lg-hang" aria-hidden="true">${num(sec)}.${i + 1}</span>`;

  // skills: a real table; explicit roles keep the semantics when the S tier changes display (spec §3.2)
  const skillRows = s.skills.groups
    .map(
      (g) => `
      <tbody class="lg-grp" role="rowgroup">${g.items
        .map(
          (it, i) => `
        <tr role="row">${i === 0 ? `<th role="rowheader" scope="rowgroup" rowspan="${g.items.length}"><h3>${esc(g.title)}</h3>${g.lead ? `<p class="lg-glead">${esc(g.lead)}</p>` : ''}</th>` : ''}<td role="cell" class="lg-item">${esc(it.label)}${it.detail ? ` <span class="sub">· ${esc(it.detail)}</span>` : ''}</td><td role="cell" class="lg-depth">${mark(it.level)}${esc(c.ui.levels[it.level])}</td></tr>`
        )
        .join('')}
      </tbody>`
    )
    .join('');
  const legend = `<p class="lg-legend" id="skills-legend"><span class="lg-leg">${esc(c.ui.legend)} —</span> ${LEVELS.map(
    (l, i) => `<span class="lg-leg">${mark(l)}${esc(c.ui.levels[l])}: ${esc(c.ui.levelHints[l])}${i < LEVELS.length - 1 ? '<span class="dot" aria-hidden="true">·</span>' : ''}</span>`
  ).join(' ')}</p>`;

  const facts = c.hero.facts.slice(0, 4);
  const primary = s.contact.primary;
  // external links show their label ("GitHub"); mailto/tel show the value ("+995 599 62 03 03")
  const button = (i) => (isExternal(i.href) ? `<a class="lg-btn" href="${esc(i.href)}" rel="me noopener">${esc(i.label)}</a>` : `<a class="lg-btn" href="${esc(i.href)}">${esc(i.value)}</a>`);
  // the visible word is the accessible name (WCAG 2.5.3): the fragment's aria-label/title get themeShort
  const theme = themeToggle({ ...c.ui, theme: c.ui.themeShort }, 'lg-theme', `${UI_ICONS.theme}<span class="lg-theme-t">${esc(c.ui.themeShort)}</span>`);

  // the hero: every line under the name may be gone, and so may the facts strip
  const meta = [c.hero.location, c.hero.availability].filter(Boolean).join(' · ');
  const heroParts = [
    c.hero.eyebrow ? `<p class="lg-eyebrow">${c.hero.eyebrow.split(' · ').map((p) => `<span>${esc(p)}</span>`).join('')}</p>` : '',
    `<h1>${esc(c.hero.name)}</h1>`,
    `<p class="lg-roleline"><span class="lg-role">${esc(c.hero.role)}</span>${meta ? `<span class="lg-meta">${esc(meta)}</span>` : ''}</p>`,
    c.hero.subrole ? `<p class="lg-subrole">${esc(c.hero.subrole)}</p>` : '',
    c.hero.tagline ? `<p class="lg-tagline">${esc(c.hero.tagline)}</p>` : '',
    `<table class="lg-kv" aria-label="${esc(c.contact.heading)}"><colgroup><col class="k"><col><col></colgroup><tbody>${c.contact.items
      .map(
        (i) => `
        <tr><th scope="row">${esc(i.label)}</th><td><a class="u-link" href="${esc(i.href)}"${isExternal(i.href) ? ' rel="me noopener"' : ''}>${esc(i.value)}</a></td><td class="c">${i.copy ? copyButton(i.value, c.ui, 'lg-copy copy') : ''}</td></tr>`
      )
      .join('')}
      </tbody></table>`,
    facts.length ? `<ul class="lg-facts" style="--n:${facts.length}">${facts.map((f) => `<li><span class="lg-fv">${esc(f.value)}</span><span class="lg-fl">${esc(f.label)}</span></li>`).join('')}</ul>` : '',
  ].filter(Boolean);

  // one body per section (keyed by its anchor); the row, its number and the head are shared
  const BODY = {
    profile: (sec) => `<div class="lg-prose">${sec.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`,
    skills: (sec) => `<table class="lg-skills" role="table" aria-labelledby="${sec.id}-title" aria-describedby="skills-legend">
        <colgroup><col class="g"><col><col class="d"></colgroup>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">${esc(c.ui.colGroup)}</th><th role="columnheader" scope="col">${esc(c.ui.colSkill)}</th><th role="columnheader" scope="col">${esc(c.ui.colDepth)}</th></tr></thead>${skillRows}
      </table>
      ${legend}`,
    abilities: (sec) => `<ol class="lg-list">${sec.items.map((a, i) => `<li class="lg-li">${hang(sec, i)}<h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></li>`).join('')}</ol>`,
    'work-style': (sec) => `<ul class="lg-list lg-list--split">${sec.items.map((w) => `<li class="lg-li"><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></li>`).join('')}</ul>`,
    principles: (sec) => `<ol class="lg-list lg-list--split">${sec.items.map((p, i) => `<li class="lg-li">${hang(sec, i)}<h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></li>`).join('')}</ol>`,
    experience: (sec) => `<ol class="lg-list lg-exp">${sec.items
        .map((e) => `<li class="lg-li"><p class="lg-period">${esc(e.period)}</p><div><h3>${esc(e.role)} <span class="lg-org">· ${e.orgHref ? `<a class="u-link" href="${esc(e.orgHref)}" rel="noopener">${esc(e.org)}</a>` : esc(e.org)}</span></h3><p>${esc(e.text)}</p></div></li>`)
        .join('')}</ol>`,
    languages: (sec) => `<dl class="lg-list lg-langs">${sec.langs.map((l) => `<div class="lg-li"><dt>${esc(l.name)}</dt><dd>${esc(l.level)}</dd></div>`).join('')}</dl>`,
    contact: (sec) => {
      if (!primary) return '';
      const row = [sec.cta ? `<a class="lg-btn lg-btn--primary" href="${esc(primary.href)}">${esc(sec.cta)}</a>` : '', ...sec.buttons.map(button)].join('');
      return `<a class="lg-bigmail" href="${esc(primary.href)}">${esc(primary.value)}${UI_ICONS.arrow}</a>${row ? `
      <div class="lg-cta">${row}</div>` : ''}`;
    },
  };
  const CLASS = { contact: ' lg-sec--contact' };
  const section = (sec) => {
    const body = BODY[sec.id](sec);
    return `${open(sec, CLASS[sec.id] || '')}${body ? `\n      ${body}` : ''}\n  ${close}`;
  };

  return `<header class="lg-top ${navFit(c, ctx)}">
  <div class="lg-top-in">
    <a class="lg-brand" href="${c.path}"><span class="lg-gs">${esc(ctx.person.monogram)}</span><span class="lg-bsep" aria-hidden="true"></span><span class="lg-domain">${esc(ctx.host)}</span><span class="sr-only"> — ${esc(c.hero.name)}</span></a>
    <nav class="lg-nav" aria-label="${esc(c.ui.nav)}">${navLinks(false)}</nav>
    <div class="lg-ctl">
      <nav class="lg-lang" aria-label="${esc(c.ui.language)}"><span aria-current="page" lang="${c.lang}">${esc(c.selfLabel)}</span><span class="slash" aria-hidden="true">/</span>${langSwitchLink(c, alt, c.altLabel, ` title="${esc(c.altTitle)}"`)}</nav>
      ${theme}
      ${printButton(c.ui, 'lg-pdf')}
      <details class="menu lg-menu"><summary>${UI_ICONS.menu}<span class="lg-menu-t">${esc(c.ui.nav)}</span></summary><nav class="lg-menu-list" aria-label="${esc(c.ui.nav)}">${navLinks(true)}</nav></details>
    </div>
  </div>
</header>

<main id="main" class="lg-page">
  <section class="lg-row lg-hero" aria-label="${esc(c.ui.atAGlance)}">
    <div class="lg-idx" aria-hidden="true"><span class="lg-n">00</span></div>
    <div class="lg-body">
      ${heroParts.join('\n      ')}
    </div>
  </section>

  ${order.map(section).join('\n\n  ')}

  <footer class="lg-foot">
    <span>© ${esc(ctx.updated.slice(0, 4))} ${esc(c.hero.name)} · ${esc(c.ui.updated)} <time datetime="${esc(ctx.updated)}">${esc(ctx.updated)}</time>${c.ui.builtWith ? ` · ${esc(c.ui.builtWith)}` : ''}</span>
    <span class="lg-foot-links">${langSwitchLink(c, alt, c.altTitle)}<a href="#main">${esc(c.ui.top)} ↑</a></span>
  </footer>
</main>`;
}
