// A · Precision — body markup only. The document shell and <head> live in src/shared/document.mjs.
// Pure function: (c = localize(site, lang), ctx) -> HTML string.
import { esc, pad } from '../../shared/escape.mjs';
import { UI_ICONS, CONTACT_ICONS } from '../../shared/icons.mjs';
import { copyButton, themeToggle, printButton, langSwitchLink, orderedSections, isExternal } from '../../shared/fragments.mjs';

// label + muted detail (replaces splitName(): localize() already split "Name · detail")
const skillName = (i) => (i.detail ? `${esc(i.label)} <span class="row-sub">· ${esc(i.detail)}</span>` : esc(i.label));

// Nav fit. With the layout's own fonts the inline nav is a pure CSS decision (styles.css: EN from 1440 px,
// both from 1680 px) and nothing is stamped. With the owner's fonts (fonts plan §5.4) the header's natural
// width is measured from the chosen files and the tier goes on .topbar; layout.mjs supplies the rules that
// read it. The controls are a block of fixed widths — the language switch, the theme toggle and the print
// button, the menu being hidden at every tier — read once in Chromium from the seed build at 1920 px.
const CONTROLS = { en: 249, ka: 276 };
function navFit(c, ctx, order) {
  if (!ctx.fonts?.overridden) return '';
  const w = ctx.fonts.width;
  const nav = order.reduce((n, sec) => n + w('text', sec.navLabel, 13), 0) + 22 * (order.length - 1);
  const brand = 31 + 11 + w('text', c.hero.name, 13, { weight: 500 }); // 31px mark + gap + 13px/500 name
  const need = nav + brand + (CONTROLS[c.lang] ?? CONTROLS.en) + 2 * 40 + 2 * 36; // two gutters, two header gaps
  return ` data-navfit="${[1280, 1440, 1680].find((bp) => need <= bp) ?? 'never'}"`;
}

export function renderBody(c, ctx) {
  const { alt } = ctx;
  const s = c.sections;
  const order = orderedSections(c);
  const navLinks = (withIdx) =>
    order
      .map((sec, i) => `<a href="#${sec.id}" data-spy="${sec.id}">${withIdx ? `<span class="idx">${pad(i + 1)}</span>` : ''}${esc(sec.navLabel)}</a>`)
      .join('');

  const contactList = `
    <dl class="contact">
      ${c.contact.items
        .map(
          (i) => `<div class="contact-row"><dt>${CONTACT_ICONS[i.icon] || ''}<span class="sr-only">${esc(i.label)}</span></dt><dd>
            <a href="${esc(i.href)}"${isExternal(i.href) ? ' rel="me noopener"' : ''}>${esc(i.value)}</a>
            ${i.copy ? copyButton(i.value, c.ui) : ''}
          </dd></div>`
        )
        .join('')}
    </dl>`;

  const secHead = (sec, i, extra = '') => `
    <span class="sec-idx" aria-hidden="true">${pad(i)}</span>
    <div class="sec-body">
      <h2 id="${sec.id}-title">${esc(sec.title)}</h2>
      ${sec.lead ? `<p class="lead">${esc(sec.lead)}</p>` : ''}
      ${extra}`;
  const secEnd = `</div>`;

  const legend = `
    <p class="legend" aria-label="${esc(c.ui.legend)}">
      ${['core', 'strong', 'working'].map((l) => `<span><span class="lvl" data-level="${l}">${esc(c.ui.levels[l])}</span> — ${esc(c.ui.levelHints[l])}</span>`).join('')}
    </p>`;

  const skillGroups = s.skills.groups
    .map((g) => {
      const items = g.items.map((i) => `<li class="row"><span class="row-name">${skillName(i)}</span><span class="lvl" data-level="${i.level}">${esc(c.ui.levels[i.level])}</span></li>`);
      return `
      <div class="group">
        <div class="group-head"><h3>${esc(g.title)}</h3>${g.lead ? `<p>${esc(g.lead)}</p>` : ''}</div>
        <ul class="rows">${items.join('')}</ul>
      </div>`;
    })
    .join('');

  const nameHtml = `${esc(c.hero.givenName)}<br>${esc(c.hero.familyName)}`;
  const primary = s.contact.primary;
  // links show their label ("GitHub"), email/phone show the value ("+995 599 62 03 03")
  const ghost = (i) =>
    isExternal(i.href)
      ? `<a class="btn ghost" href="${esc(i.href)}" rel="me noopener">${esc(i.label)}</a>`
      : `<a class="btn ghost" href="${esc(i.href)}">${esc(i.value)}</a>`;

  // the rail: a removed line leaves no element and no blank line behind it
  const rail = [
    c.hero.eyebrow ? `<p class="eyebrow">${esc(c.hero.eyebrow)}</p>` : '',
    `<h1 class="name">${nameHtml}</h1>`,
    `<p class="role">${esc(c.hero.role)}</p>`,
    c.hero.subrole ? `<p class="subrole">${esc(c.hero.subrole)}</p>` : '',
    `<div class="rail-block" aria-label="${esc(c.contact.heading)}">${contactList}</div>`,
    `<nav class="railnav rail-block" aria-label="${esc(c.ui.nav)}">${navLinks(true)}</nav>`,
  ].filter(Boolean).join('\n    ');

  // the introduction: the strip is drawn for 1–4 facts (--n only when it is not the default 4) and the
  // whole block disappears once the tagline, the location line and the facts are all gone
  const facts = c.hero.facts;
  const meta = [c.hero.location, c.hero.availability].filter(Boolean).join(' · ');
  const introParts = [
    c.hero.tagline ? `<p class="tagline">${esc(c.hero.tagline)}</p>` : '',
    meta ? `<p class="loc"><span class="dot" aria-hidden="true"></span>${esc(meta)}</p>` : '',
    facts.length ? `<ul class="facts"${facts.length === 4 ? '' : ` style="--n:${facts.length}"`}>
        ${facts.map((f) => `<li><span class="fact-value">${esc(f.value)}</span><span class="fact-label">${esc(f.label)}</span></li>`).join('')}
      </ul>` : '',
  ].filter(Boolean);
  const intro = introParts.length ? `<section class="intro" aria-label="${esc(c.ui.atAGlance)}">
      ${introParts.join('\n      ')}
    </section>` : '';

  // one body per section (keyed by its anchor); the wrapper, the number and the head are shared
  const BODY = {
    profile: (sec) => `<div class="prose">${sec.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`,
    skills: () => `<div class="ledger">${skillGroups}</div>`,
    abilities: (sec) => `<ol class="list">
        ${sec.items.map((a, i) => `<li class="item"><div class="item-head"><span class="item-idx" aria-hidden="true">${pad(i + 1)}</span><h3>${esc(a.title)}</h3></div><p>${esc(a.text)}</p></li>`).join('')}
      </ol>`,
    'work-style': (sec) => `<ul class="list">
        ${sec.items.map((w) => `<li class="item"><div class="item-head"><h3>${esc(w.title)}</h3></div><p>${esc(w.text)}</p></li>`).join('')}
      </ul>`,
    principles: (sec) => `<ol class="list">
        ${sec.items.map((p, i) => `<li class="item"><div class="item-head"><span class="item-idx" aria-hidden="true">${pad(i + 1)}</span><h3>${esc(p.title)}</h3></div><p>${esc(p.text)}</p></li>`).join('')}
      </ol>`,
    experience: (sec) => `<ol class="list">
        ${sec.items
          .map(
            (e) => `<li class="item"><div class="item-head"><span class="item-label">${esc(e.period)}</span></div><div><h3>${esc(e.role)} <span class="org">· ${e.orgHref ? `<a href="${esc(e.orgHref)}" rel="noopener">${esc(e.org)}</a>` : esc(e.org)}</span></h3><p>${esc(e.text)}</p></div></li>`
          )
          .join('')}
      </ol>`,
    languages: (sec) => `<ul class="list">
        ${sec.langs.map((l) => `<li class="item"><div class="item-head"><span class="item-label">${esc(l.name)}</span></div><div><p class="lang-level">${esc(l.level)}</p></div></li>`).join('')}
      </ul>`,
    contact: (sec) => {
      if (!primary) return '';
      const row = [sec.cta ? `<a class="btn" href="${esc(primary.href)}">${esc(sec.cta)}</a>` : '', ...sec.buttons.map(ghost)].filter(Boolean);
      return `<a class="big-mail" href="${esc(primary.href)}">${esc(primary.value)} ${UI_ICONS.arrow}</a>${row.length ? `
      <div class="cta-row">
        ${row.join('\n        ')}
      </div>` : ''}`;
    },
  };
  const EXTRA = { skills: legend };
  const CLASS = { contact: ' sec-contact' };
  const section = (sec, n) => `<section class="sec${CLASS[sec.id] || ''}" id="${sec.id}" aria-labelledby="${sec.id}-title">
      ${secHead(sec, n, EXTRA[sec.id] || '')}
      ${BODY[sec.id](sec)}
      ${secEnd}
    </section>`;

  return `<header class="topbar"${navFit(c, ctx, order)}>
  <div class="topbar-inner">
    <a class="brand" href="${c.path}"><span class="mark" aria-hidden="true">${esc(ctx.person.monogram)}</span><span class="brand-name">${esc(c.hero.name)}</span></a>
    <nav class="topnav" aria-label="${esc(c.ui.nav)}">${navLinks(false)}</nav>
    <div class="controls">
      <nav class="lang" aria-label="${esc(c.ui.language)}">
        <span class="lang-current" aria-current="page" lang="${c.lang}">${esc(c.selfLabel)}</span>
        ${langSwitchLink(c, alt, c.altLabel, ` title="${esc(c.altTitle)}"`)}
      </nav>
      ${themeToggle(c.ui)}
      ${printButton(c.ui)}
      <details class="menu">
        <summary aria-label="${esc(c.ui.nav)}">${UI_ICONS.menu}</summary>
        <nav class="menu-list" aria-label="${esc(c.ui.nav)}">${navLinks(true)}</nav>
      </details>
    </div>
  </div>
</header>

<div class="shell">
  <aside class="rail">
    ${rail}
  </aside>

  <main id="main" class="content">
    ${[intro, ...order.map((sec, i) => section(sec, i + 1))].filter(Boolean).join('\n\n    ')}

    <footer class="foot">
      <span>© ${esc(ctx.updated.slice(0, 4))} ${esc(c.hero.name)} · ${esc(c.ui.updated)} <time datetime="${esc(ctx.updated)}">${esc(ctx.updated)}</time>${c.ui.builtWith ? ` · ${esc(c.ui.builtWith)}` : ''}</span>
      <span class="foot-links">${langSwitchLink(c, alt, c.altTitle)}<a href="#main">${esc(c.ui.top)} ↑</a></span>
    </footer>
  </main>
</div>`;
}
