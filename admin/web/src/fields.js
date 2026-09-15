// Schema paths → input ids, English labels and help texts, and the screen that edits each path.
// The form is generated from buildSchema() (GET /registry); this file only adds labels (admin-ops.md §6.5).
import { nextTick } from 'vue';
import { navigate, route } from './router.js';

/** "$.hero.facts[2].label.ka" → "f-hero-facts-2-label-ka" */
export const fieldId = (path) => 'f' + path.replace(/^\$/, '').replace(/\[(\d+)\]/g, '-$1').replace(/\./g, '-');

/** "$.sections.skills.groups[2].items[0].name" → "sections.skills.groups[].items[].name" */
export const genericPath = (path) => path.replace(/^\$\.?/, '').replace(/\[\d+\]/g, '[]');

const L = (label, help = '') => ({ label, help });
const LABELS = {
  'person.givenName': L('Given name', 'Shown on its own line at display size.'),
  'person.familyName': L('Family name'),
  'person.monogram': L('Monogram', '1–3 capital letters or digits; drawn in the icons and the social cards.'),
  'person.alternateName': L('Alternate name', 'Structured data (JSON-LD alternateName); search engines only.'),
  'person.address': L('Address', 'Structured data only.'),
  'person.address.locality': L('Locality'),
  'person.address.country': L('Country code', 'Two capital letters (ISO 3166-1), e.g. GE.'),
  'person.sameAs': L('Profiles (sameAs)', 'https: links that identify you in structured data. Up to 8.'),
  'person.sameAs[]': L('Profile link', 'https:// only.'),
  'meta.title': L('Page title', 'The <title> and the social title. Search engines cut it after about 60 characters.'),
  'meta.description': L('Page description', 'The meta and social description; search engines cut it after about 160 characters.'),
  'hero.eyebrow': L('Eyebrow', 'The small line above the name.'),
  'hero.role': L('Role'),
  'hero.subrole': L('Subrole'),
  'hero.tagline': L('Tagline'),
  'hero.location': L('Location'),
  'hero.availability': L('Availability'),
  'hero.facts': L('Facts', 'Exactly four value and label pairs.'),
  'hero.facts[]': L('Fact'),
  'hero.facts[].value': L('Value', 'Short: up to 7 Latin or 4 Georgian letters per word.'),
  'hero.facts[].label': L('Label'),
  'contact.heading': L('Heading', 'Names the contact rail for screen readers; Studio shows it.'),
  'contact.items': L('Contact items', 'Shown in this order.'),
  'contact.items[]': L('Contact item'),
  'contact.items[].label': L('Label'),
  'contact.items[].value': L('Shown text', 'The visible text, the same in both languages.'),
  'contact.items[].href': L('Link', 'https://, mailto: or tel:'),
  'contact.items[].icon': L('Icon'),
  'contact.items[].copy': L('Show copy button'),
  'sections.*.nav': L('Navigation label', 'A shorter label for the navigation; without it the title is used.'),
  'sections.*.title': L('Title'),
  'sections.*.lead': L('Lead', 'The line under the title.'),
  'sections.*.items': L('Items'),
  'sections.*.items[]': L('Item'),
  'sections.*.items[].title': L('Title'),
  'sections.*.items[].text': L('Text'),
  'sections.profile.paragraphs': L('Paragraphs', 'Each paragraph is its own item; line breaks are not stored.'),
  'sections.profile.paragraphs[]': L('Paragraph'),
  'sections.profile.paragraphs[].text': L('Paragraph'),
  'sections.skills.groups': L('Skill groups'),
  'sections.skills.groups[]': L('Group'),
  'sections.skills.groups[].title': L('Group title'),
  'sections.skills.groups[].lead': L('Group lead'),
  'sections.skills.groups[].items': L('Skills'),
  'sections.skills.groups[].items[]': L('Skill'),
  'sections.skills.groups[].items[].name': L('Name'),
  'sections.skills.groups[].items[].detail': L('Detail'),
  'sections.skills.groups[].items[].level': L('Level'),
  'sections.experience.items[]': L('Position'),
  'sections.experience.items[].from': L('From', 'Year, 1970–2100.'),
  'sections.experience.items[].to': L('To'),
  'sections.experience.items[].role': L('Role'),
  'sections.experience.items[].org': L('Organisation'),
  'sections.experience.items[].orgHref': L('Organisation link', 'https:// only; leave empty for no link.'),
  'sections.experience.items[].text': L('Text'),
  'sections.languages.items[]': L('Language'),
  'sections.languages.items[].name': L('Language'),
  'sections.languages.items[].proficiency': L('Proficiency'),
  'sections.contact.cta': L('Button text', 'The main button next to the email address.'),
  'sections.contact.primary': L('Primary email', 'The big address and the main button use this contact item (mailto: items only).'),
  'sections.contact.buttons': L('Buttons', 'Up to three more buttons, chosen and ordered from the contact items.'),
  'settings.updated': L('Last updated'),
};

// Interface strings: where each one shows (data-model.md §3.4)
export const UI_NOTES = {
  skip: ['Skip link', 'The first link of the page, for keyboard users.'],
  nav: ['Sections', 'Navigation label and the menu button.'],
  theme: ['Theme toggle', 'The theme button’s label and tooltip.'],
  themeShort: ['Theme (short)', 'Ledger’s visible “Theme” label.'],
  print: ['Save as PDF', 'The print button.'],
  printShort: ['Save as PDF (short)', 'The print button below 480 px.'],
  language: ['Language', 'Label of the language navigation.'],
  langShort: ['Language (short)', 'This page’s own cell in the language switch.'],
  langSwitch: ['Language switch', 'Tooltip of the switch and the footer link, shown on the other page.'],
  copy: ['Copy', 'The copy chip.'],
  copied: ['Copied', 'The copy chip after a click.'],
  legend: ['Skills legend', 'Label of the skills legend.'],
  'levels.core': ['Level: core', 'Level label.'],
  'levels.strong': ['Level: strong', 'Level label.'],
  'levels.working': ['Level: working', 'Level label.'],
  'levelHints.core': ['Level hint: core', 'Explanation in the legend.'],
  'levelHints.strong': ['Level hint: strong', 'Explanation in the legend.'],
  'levelHints.working': ['Level hint: working', 'Explanation in the legend.'],
  colGroup: ['Column: group', 'Ledger’s skills table header.'],
  colSkill: ['Column: skill', 'Ledger’s skills table header.'],
  colDepth: ['Column: depth', 'Ledger’s skills table header.'],
  present: ['Present', 'The open end of an experience period.'],
  atAGlance: ['At a glance', 'Label of the introduction block.'],
  updated: ['Last updated', 'Footer.'],
  builtWith: ['Built with', 'Footer.'],
  top: ['Back to top', 'Footer.'],
};

function lookup(g) {
  if (LABELS[g]) return LABELS[g];
  const star = g.replace(/^sections\.[a-z]+\./, 'sections.*.');
  if (LABELS[star]) return LABELS[star];
  if (g.startsWith('ui.')) {
    const n = UI_NOTES[g.slice(3)];
    if (n) return L(n[0], n[1]);
  }
  return null;
}

/** English label for a $.path or generic path. */
export function labelFor(path) {
  const g = path.startsWith('$') ? genericPath(path) : path;
  const hit = lookup(g);
  if (hit) return hit.label;
  const last = g.split('.').pop().replace('[]', '');
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase();
}
export function helpFor(path) {
  const g = path.startsWith('$') ? genericPath(path) : path;
  return lookup(g)?.help || '';
}

// ------------------------------------------------------------------ which screen edits a path
export const TAB_ROOTS = {
  person: ['$.person.givenName', '$.person.familyName', '$.person.monogram', '$.hero'],
  contact: ['$.contact'],
  profile: ['$.sections.profile'],
  skills: ['$.sections.skills'],
  abilities: ['$.sections.abilities'],
  workstyle: ['$.sections.workstyle'],
  principles: ['$.sections.principles'],
  experience: ['$.sections.experience'],
  languages: ['$.sections.languages'],
  talk: ['$.sections.contact'],
  ui: ['$.ui'],
};
export const SEO_ROOTS = ['$.meta', '$.person.alternateName', '$.person.address', '$.person.sameAs'];
export const DASHBOARD_ROOTS = ['$.settings'];

const under = (p, root) => p === root || p.startsWith(root + '.') || p.startsWith(root + '[');

export function routeForPath(path) {
  if (DASHBOARD_ROOTS.some((r) => under(path, r))) return '/';
  if (SEO_ROOTS.some((r) => under(path, r))) return '/seo';
  for (const [tab, roots] of Object.entries(TAB_ROOTS)) if (roots.some((r) => under(path, r))) return `/content/${tab}`;
  if (path === '$.sections') return '/content/profile';
  return '/content/person';
}

/** Candidate element ids for a path, most specific first ("…name.ka", "…name", "…items[0]", …). */
function candidates(path) {
  const out = [];
  let p = path;
  while (p && p !== '$') {
    out.push(fieldId(p));
    const cut = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['));
    if (cut <= 1) break;
    p = p.slice(0, cut);
  }
  return out;
}

/** Go to the screen that edits `path` and focus its input (or the closest element that has an id). */
export async function focusPath(path) {
  const target = routeForPath(path);
  navigate(target, { focusHeading: false });
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (let i = 0; i < 60 && route.path !== target; i++) await frame(); // the hashchange arrives as a task
  await nextTick();
  await frame();
  for (const id of candidates(path)) {
    const el = document.getElementById(id);
    if (!el) continue;
    for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) d.open = true;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    return true;
  }
  return false;
}
