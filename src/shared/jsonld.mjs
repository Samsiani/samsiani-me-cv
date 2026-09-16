// schema.org Person for one language page. Key order matches the live output.
// Structured data describes what the page shows: a hidden section contributes nothing.
export function personJsonLd(c, ctx) {
  const s = c.sections;
  const shown = new Set(c.sectionOrder);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: c.hero.name,
    alternateName: ctx.person.alternateName[c.lang],
    jobTitle: c.hero.role,
    description: c.meta.description,
    url: ctx.siteUrl + c.path,
  };
  if (ctx.email) ld.email = ctx.email; // "mailto:…" form, as shipped today
  if (ctx.telephone) ld.telephone = ctx.telephone; // "+995…"
  ld.address = { '@type': 'PostalAddress', addressLocality: ctx.person.address.locality, addressCountry: ctx.person.address.country };
  ld.sameAs = ctx.person.sameAs;
  if (shown.has('education')) ld.knowsLanguage = s.education.langs.map((l) => l.name);
  if (shown.has('skills')) ld.knowsAbout = s.skills.groups.flatMap((g) => g.items.filter((i) => i.level === 'core').map((i) => i.label));
  // current roles only (to === null) that have a public URL
  if (shown.has('experience')) ld.worksFor = s.experience.items.filter((e) => e.orgHref && e.to == null).map((e) => ({ '@type': 'Organization', name: e.org, url: e.orgHref }));
  return ld;
}
