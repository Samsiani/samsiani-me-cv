// Renders one language page. Pure function: (content, ctx) -> HTML string.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');

const icons = {
  theme:
    '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.6a6.4 6.4 0 0 1 0 12.8Z" fill="currentColor"/></svg>',
  menu: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 4.5h12M2 8h12M2 11.5h12"/></svg>',
  arrow: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12 12 4M5.5 4H12v6.5"/></svg>',
};

// "Name · detail" -> name + muted detail
const splitName = (name) => {
  const i = name.indexOf(' · ');
  return i < 0 ? esc(name) : `${esc(name.slice(0, i))} <span class="row-sub">· ${esc(name.slice(i + 3))}</span>`;
};

export function render(c, ctx) {
  const { site, cssHref, jsHref, updated, alt } = ctx;
  const s = c.sections;
  const url = site + c.path;
  const altUrl = site + c.altPath;
  const isKa = c.lang === 'ka';
  const order = [s.profile, s.skills, s.abilities, s.workstyle, s.principles, s.experience, s.education, s.contact];
  const navLinks = (withIdx) =>
    order
      .map((sec, i) => `<a href="#${sec.id}" data-spy="${sec.id}">${withIdx ? `<span class="idx">${pad(i + 1)}</span>` : ''}${esc(sec.title)}</a>`)
      .join('');
  const preload = isKa
    ? ['noto-sans-georgian-georgian-normal-400-700', 'chivo-latin-normal-400-700', 'jetbrains-mono-latin-normal-400-500']
    : ['chivo-latin-normal-400-700', 'jetbrains-mono-latin-normal-400-500'];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: c.hero.name,
    alternateName: isKa ? 'Giorgi Samsiani' : 'George Samsiani',
    jobTitle: c.hero.role,
    description: c.meta.description,
    url,
    email: 'mailto:contact@samsiani.com',
    telephone: '+995599620303',
    address: { '@type': 'PostalAddress', addressLocality: 'Tbilisi', addressCountry: 'GE' },
    sameAs: ['https://github.com/Samsiani', 'https://samsiani.com', 'https://codeon.ge'],
    knowsLanguage: s.education.langs.map((l) => l.name),
    knowsAbout: s.skills.groups.flatMap((g) => g.items.filter((i) => i.level === 'core').map((i) => i.name.split(' · ')[0])),
    worksFor: s.experience.items.filter((e) => e.orgHref).map((e) => ({ '@type': 'Organization', name: e.org, url: e.orgHref })),
  };

  const contactList = `
    <dl class="contact">
      ${c.contact.items
        .map(
          (i) => `<div class="contact-row"><dt>${esc(i.label)}</dt><dd>
            <a href="${esc(i.href)}"${i.href.startsWith('http') ? ' rel="me noopener"' : ''}>${esc(i.value)}</a>
            ${i.copy ? `<button type="button" class="copy" data-copy="${esc(i.value)}" data-copied="${esc(c.ui.copied)}" hidden aria-label="${esc(c.ui.copy)}: ${esc(i.value)}">${esc(c.ui.copy)}</button>` : ''}
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
      const items = g.items.map((i) => `<li class="row"><span class="row-name">${splitName(i.name)}</span><span class="lvl" data-level="${i.level}">${esc(c.ui.levels[i.level])}</span></li>`);
      return `
      <div class="group">
        <div class="group-head"><h3>${esc(g.title)}</h3><p>${esc(g.lead)}</p></div>
        <ul class="rows">${items.join('')}</ul>
      </div>`;
    })
    .join('');

  const nameHtml = esc(c.hero.name).split(' ').join('<br>');

  return `<!doctype html>
<html lang="${c.lang}" dir="${c.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(c.meta.title)}</title>
<meta name="description" content="${esc(c.meta.description)}">
<meta name="author" content="Giorgi Samsiani">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#fafafb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151619" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="${c.lang}" href="${url}">
<link rel="alternate" hreflang="${alt.lang}" href="${altUrl}">
<link rel="alternate" hreflang="x-default" href="${site}/">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(c.meta.title)}">
<meta property="og:description" content="${esc(c.meta.description)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="samsiani.me">
<meta property="og:locale" content="${c.meta.ogLocale}">
<meta property="og:locale:alternate" content="${alt.meta.ogLocale}">
<meta property="og:image" content="${site}/og-${c.lang}.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="${esc(c.hero.name)} — ${esc(c.hero.role)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="profile:first_name" content="${isKa ? 'გიორგი' : 'Giorgi'}">
<meta property="profile:last_name" content="${isKa ? 'სამსიანი' : 'Samsiani'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(c.meta.title)}">
<meta name="twitter:description" content="${esc(c.meta.description)}">
<meta name="twitter:image" content="${site}/og-${c.lang}.png">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
${preload.map((f) => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n')}
<link rel="stylesheet" href="${cssHref}">
<script>(function(){var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('theme');var m=location.search.match(/[?&]theme=(light|dark)/);if(m){t=m[1]}if(t==='dark'||t==='light'){d.dataset.theme=t}}catch(e){}})();</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<a class="skip" href="#main">${esc(c.ui.skip)}</a>

<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="${c.path}"><span class="mark" aria-hidden="true">GS</span><span class="brand-name">${esc(c.hero.name)}</span></a>
    <nav class="topnav" aria-label="${esc(c.ui.nav)}">${navLinks(false)}</nav>
    <div class="controls">
      <nav class="lang" aria-label="${esc(c.ui.language)}">
        <span class="lang-current" aria-current="page" lang="${c.lang}">${esc(c.selfLabel)}</span>
        <a href="${c.altPath}" hreflang="${alt.lang}" lang="${alt.lang}" title="${esc(c.altTitle)}" data-lang-switch="${alt.lang}">${esc(c.altLabel)}</a>
      </nav>
      <button type="button" class="ctl ctl-icon" data-theme-toggle aria-label="${esc(c.ui.theme)}" title="${esc(c.ui.theme)}">${icons.theme}</button>
      <button type="button" class="ctl ctl-primary" data-print hidden aria-label="${esc(c.ui.print)}"><span class="label-long">${esc(c.ui.print)}</span><span class="label-short">${esc(c.ui.printShort)}</span></button>
      <details class="menu">
        <summary aria-label="${esc(c.ui.nav)}">${icons.menu}</summary>
        <nav class="menu-list" aria-label="${esc(c.ui.nav)}">${navLinks(true)}</nav>
      </details>
    </div>
  </div>
</header>

<div class="shell">
  <aside class="rail">
    <p class="eyebrow">${esc(c.hero.eyebrow)}</p>
    <h1 class="name">${nameHtml}</h1>
    <p class="role">${esc(c.hero.role)}</p>
    <p class="subrole">${esc(c.hero.subrole)}</p>
    <div class="rail-block" aria-label="${esc(c.contact.heading)}">${contactList}</div>
    <nav class="railnav rail-block" aria-label="${esc(c.ui.nav)}">${navLinks(true)}</nav>
  </aside>

  <main id="main" class="content">
    <section class="intro" aria-label="${esc(c.ui.atAGlance)}">
      <p class="tagline">${esc(c.hero.tagline)}</p>
      <p class="loc"><span class="dot" aria-hidden="true"></span>${esc(c.hero.location)} · ${esc(c.hero.availability)}</p>
      <ul class="facts">
        ${c.hero.facts.map((f) => `<li><span class="fact-value">${esc(f.value)}</span><span class="fact-label">${esc(f.label)}</span></li>`).join('')}
      </ul>
    </section>

    <section class="sec" id="${s.profile.id}" aria-labelledby="${s.profile.id}-title">
      ${secHead(s.profile, 1)}
      <div class="prose">${s.profile.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      ${secEnd}
    </section>

    <section class="sec" id="${s.skills.id}" aria-labelledby="${s.skills.id}-title">
      ${secHead(s.skills, 2, legend)}
      <div class="ledger">${skillGroups}</div>
      ${secEnd}
    </section>

    <section class="sec" id="${s.abilities.id}" aria-labelledby="${s.abilities.id}-title">
      ${secHead(s.abilities, 3)}
      <ol class="list">
        ${s.abilities.items.map((a, i) => `<li class="item"><div class="item-head"><span class="item-idx" aria-hidden="true">${pad(i + 1)}</span><h3>${esc(a.title)}</h3></div><p>${esc(a.text)}</p></li>`).join('')}
      </ol>
      ${secEnd}
    </section>

    <section class="sec" id="${s.workstyle.id}" aria-labelledby="${s.workstyle.id}-title">
      ${secHead(s.workstyle, 4)}
      <ul class="list">
        ${s.workstyle.items.map((w) => `<li class="item"><div class="item-head"><h3>${esc(w.title)}</h3></div><p>${esc(w.text)}</p></li>`).join('')}
      </ul>
      ${secEnd}
    </section>

    <section class="sec" id="${s.principles.id}" aria-labelledby="${s.principles.id}-title">
      ${secHead(s.principles, 5)}
      <ol class="list">
        ${s.principles.items.map((p, i) => `<li class="item"><div class="item-head"><span class="item-idx" aria-hidden="true">${pad(i + 1)}</span><h3>${esc(p.title)}</h3></div><p>${esc(p.text)}</p></li>`).join('')}
      </ol>
      ${secEnd}
    </section>

    <section class="sec" id="${s.experience.id}" aria-labelledby="${s.experience.id}-title">
      ${secHead(s.experience, 6)}
      <ol class="list">
        ${s.experience.items
          .map(
            (e) => `<li class="item"><div class="item-head"><span class="item-label">${esc(e.period)}</span></div><div><h3>${esc(e.role)} <span class="org">· ${e.orgHref ? `<a href="${esc(e.orgHref)}" rel="noopener">${esc(e.org)}</a>` : esc(e.org)}</span></h3><p>${esc(e.text)}</p></div></li>`
          )
          .join('')}
      </ol>
      ${secEnd}
    </section>

    <section class="sec" id="${s.education.id}" aria-labelledby="${s.education.id}-title">
      ${secHead(s.education, 7)}
      <ul class="list">
        ${s.education.langs.map((l) => `<li class="item"><div class="item-head"><span class="item-label">${esc(l.name)}</span></div><div><p class="lang-level">${esc(l.level)}</p></div></li>`).join('')}
      </ul>
      ${secEnd}
    </section>

    <section class="sec sec-contact" id="${s.contact.id}" aria-labelledby="${s.contact.id}-title">
      ${secHead(s.contact, 8)}
      <a class="big-mail" href="mailto:contact@samsiani.com">contact@samsiani.com ${icons.arrow}</a>
      <div class="cta-row">
        <a class="btn" href="mailto:contact@samsiani.com">${esc(s.contact.cta)}</a>
        <a class="btn ghost" href="https://github.com/Samsiani" rel="me noopener">GitHub</a>
        <a class="btn ghost" href="tel:+995599620303">+995 599 62 03 03</a>
      </div>
      ${secEnd}
    </section>

    <footer class="foot">
      <span>© ${updated.slice(0, 4)} ${esc(c.hero.name)} · ${esc(c.ui.updated)} <time datetime="${updated}">${updated}</time> · ${esc(c.ui.builtWith)}</span>
      <span class="foot-links"><a href="${c.altPath}" hreflang="${alt.lang}" lang="${alt.lang}" data-lang-switch="${alt.lang}">${esc(c.altTitle)}</a><a href="#main">${esc(c.ui.top)} ↑</a></span>
    </footer>
  </main>
</div>

<script src="${jsHref}" defer></script>
</body>
</html>
`;
}
