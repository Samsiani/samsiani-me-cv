// C · Ledger — body markup only. The document shell and <head> live in src/shared/document.mjs.
// Pure function: (c = localize(site, lang), ctx) -> HTML string. No fs, no globals, no hard-coded content.
// Spec: docs/plans/layout-ledger.md. Styles: ./styles.css (class prefix lg-).
import { esc, pad } from '../../shared/escape.mjs';
import { UI_ICONS } from '../../shared/icons.mjs';
import { copyButton, themeToggle, printButton, langSwitchLink, orderedSections, isExternal } from '../../shared/fragments.mjs';

const LEVELS = ['core', 'strong', 'working'];

// Nav-fit (spec §2.4): estimate the header's natural width from the strings it shows and return the
// smallest breakpoint at which the inline section nav fits. Constants were measured with IBM Plex / Noto
// in Chromium and carry ~2 % headroom. The header content is capped at 1440 px, so above that: never.
const FIT = {
  en: { nav: 5.9, gap: 20 },   // IBM Plex Sans 12.5 px: 5.81 px per character
  ka: { nav: 7.8, gap: 14 },   // Noto Sans Georgian 12 px: 7.69 px per character
};
const CH = { mono14: 9.3, mono12: 7.3, mono12_5: 7.6, btn: 7.4, geo12_5: 8.2 };
export function navFit(c, ctx) {
  const k = FIT[c.lang] || FIT.en;
  const labels = orderedSections(c).map((s) => s.navLabel);
  const nav = labels.join('').length * k.nav + (labels.length - 1) * k.gap;
  const brand = ctx.person.monogram.length * CH.mono14 + 25 + ctx.host.length * CH.mono12_5;
  const perLabel = (s) => [...s].reduce((w, ch) => w + (/[Ⴀ-ჿ]/.test(ch) ? CH.geo12_5 : CH.mono12), 0);
  const lang = perLabel(c.selfLabel) + perLabel(c.altLabel) + 7.3 + 12;
  const theme = 18 + perLabel(c.ui.themeShort);
  const print = 26 + [...c.ui.print].length * (c.lang === 'ka' ? CH.geo12_5 : CH.btn);
  const need = brand + lang + theme + print + 2 * 16 + nav + 2 * 32 + 2 * 44;
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
      <p class="lg-eyebrow">${c.hero.eyebrow.split(' · ').map((p) => `<span>${esc(p)}</span>`).join('')}</p>
      <h1>${esc(c.hero.name)}</h1>
      <p class="lg-roleline"><span class="lg-role">${esc(c.hero.role)}</span><span class="lg-meta">${esc(c.hero.location)} · ${esc(c.hero.availability)}</span></p>
      <p class="lg-subrole">${esc(c.hero.subrole)}</p>
      <p class="lg-tagline">${esc(c.hero.tagline)}</p>
      <table class="lg-kv" aria-label="${esc(c.contact.heading)}"><colgroup><col class="k"><col><col></colgroup><tbody>${c.contact.items
        .map(
          (i) => `
        <tr><th scope="row">${esc(i.label)}</th><td><a class="u-link" href="${esc(i.href)}"${isExternal(i.href) ? ' rel="me noopener"' : ''}>${esc(i.value)}</a></td><td class="c">${i.copy ? copyButton(i.value, c.ui, 'lg-copy copy') : ''}</td></tr>`
        )
        .join('')}
      </tbody></table>
      <ul class="lg-facts" style="--n:${facts.length}">${facts.map((f) => `<li><span class="lg-fv">${esc(f.value)}</span><span class="lg-fl">${esc(f.label)}</span></li>`).join('')}</ul>
    </div>
  </section>

  ${open(s.profile)}
      <div class="lg-prose">${s.profile.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
  ${close}

  ${open(s.skills)}
      <table class="lg-skills" role="table" aria-labelledby="${s.skills.id}-title" aria-describedby="skills-legend">
        <colgroup><col class="g"><col><col class="d"></colgroup>
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">${esc(c.ui.colGroup)}</th><th role="columnheader" scope="col">${esc(c.ui.colSkill)}</th><th role="columnheader" scope="col">${esc(c.ui.colDepth)}</th></tr></thead>${skillRows}
      </table>
      ${legend}
  ${close}

  ${open(s.abilities)}
      <ol class="lg-list">${s.abilities.items.map((a, i) => `<li class="lg-li">${hang(s.abilities, i)}<h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></li>`).join('')}</ol>
  ${close}

  ${open(s.workstyle)}
      <ul class="lg-list lg-list--split">${s.workstyle.items.map((w) => `<li class="lg-li"><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></li>`).join('')}</ul>
  ${close}

  ${open(s.principles)}
      <ol class="lg-list lg-list--split">${s.principles.items.map((p, i) => `<li class="lg-li">${hang(s.principles, i)}<h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></li>`).join('')}</ol>
  ${close}

  ${open(s.experience)}
      <ol class="lg-list lg-exp">${s.experience.items
        .map((e) => `<li class="lg-li"><p class="lg-period">${esc(e.period)}</p><div><h3>${esc(e.role)} <span class="lg-org">· ${e.orgHref ? `<a class="u-link" href="${esc(e.orgHref)}" rel="noopener">${esc(e.org)}</a>` : esc(e.org)}</span></h3><p>${esc(e.text)}</p></div></li>`)
        .join('')}</ol>
  ${close}

  ${open(s.education)}
      <dl class="lg-list lg-langs">${s.education.langs.map((l) => `<div class="lg-li"><dt>${esc(l.name)}</dt><dd>${esc(l.level)}</dd></div>`).join('')}</dl>
  ${close}

  ${open(s.contact, ' lg-sec--contact')}${
    primary
      ? `
      <a class="lg-bigmail" href="${esc(primary.href)}">${esc(primary.value)}${UI_ICONS.arrow}</a>
      <div class="lg-cta"><a class="lg-btn lg-btn--primary" href="${esc(primary.href)}">${esc(s.contact.cta)}</a>${s.contact.buttons.map(button).join('')}</div>`
      : ''
  }
  ${close}

  <footer class="lg-foot">
    <span>© ${ctx.updated.slice(0, 4)} ${esc(c.hero.name)} · ${esc(c.ui.updated)} <time datetime="${ctx.updated}">${ctx.updated}</time> · ${esc(c.ui.builtWith)}</span>
    <span class="lg-foot-links">${langSwitchLink(c, alt, c.altTitle)}<a href="#main">${esc(c.ui.top)} ↑</a></span>
  </footer>
</main>`;
}
