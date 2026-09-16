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
  'hero.facts': L('Facts', 'Up to four value and label pairs; the strip is not shown when there are none.'),
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

// Interface strings: where each one shows (data-model.md §3.4) and, for the ones that stay, why
// (content-editing.md decision D7). A third element means "required": the form shows it as the reason.
const LEGEND_REASON = 'The skills legend is one unit; hide the skills section instead.';
const TABLE_REASON = 'Ledger’s table headers.';
export const UI_NOTES = {
  skip: ['Skip link', 'The first link of the page, for keyboard users.', 'Keyboard users need the skip link.'],
  nav: ['Sections', 'Navigation label and the menu button.', 'Names the section navigation and the menu button.'],
  theme: ['Theme toggle', 'The theme button’s label and tooltip.', 'Name of the theme button.'],
  themeShort: ['Theme (short)', 'Ledger’s visible “Theme” label.', 'Name of the theme button.'],
  print: ['Save as PDF', 'The print button.', 'Text of the print button.'],
  printShort: ['Save as PDF (short)', 'The print button below 480 px.', 'Text of the print button.'],
  language: ['Language', 'Label of the language navigation.', 'The language switch needs both its labels.'],
  langShort: ['Language (short)', 'This page’s own cell in the language switch.', 'The language switch needs both its labels.'],
  langSwitch: ['Language switch', 'Tooltip of the switch and the footer link, shown on the other page.', 'The language switch needs both its labels.'],
  copy: ['Copy', 'The copy chip.', 'Text and state of the copy chip.'],
  copied: ['Copied', 'The copy chip after a click.', 'Text and state of the copy chip.'],
  legend: ['Skills legend', 'Label of the skills legend.', LEGEND_REASON],
  'levels.core': ['Level: core', 'Level label.', LEGEND_REASON],
  'levels.strong': ['Level: strong', 'Level label.', LEGEND_REASON],
  'levels.working': ['Level: working', 'Level label.', LEGEND_REASON],
  'levelHints.core': ['Level hint: core', 'Explanation in the legend.', LEGEND_REASON],
  'levelHints.strong': ['Level hint: strong', 'Explanation in the legend.', LEGEND_REASON],
  'levelHints.working': ['Level hint: working', 'Explanation in the legend.', LEGEND_REASON],
  colGroup: ['Column: group', 'Ledger’s skills table header.', TABLE_REASON],
  colSkill: ['Column: skill', 'Ledger’s skills table header.', TABLE_REASON],
  colDepth: ['Column: depth', 'Ledger’s skills table header.', TABLE_REASON],
  present: ['Present', 'The open end of an experience period.', 'Shown for an open experience period.'],
  atAGlance: ['At a glance', 'Label of the introduction block.', 'Names the introduction for screen readers.'],
  updated: ['Last updated', 'Footer.', 'Footer label and link text.'],
  builtWith: ['Built with', 'Footer.'],
  top: ['Back to top', 'Footer.', 'Footer label and link text.'],
};

// Single lines that may be removed: what the form says once they are gone (decision D3). A path in this
// map also turns the field's Add button into "Add back"; nav, lead and detail keep their own wording.
const OFF_TEXT = {
  'hero.eyebrow': 'Removed: no line above the name.',
  'hero.subrole': 'Removed: no line under the role.',
  'hero.tagline': 'Removed: no tagline in the introduction.',
  'hero.location': 'Removed: not shown in the location line.',
  'hero.availability': 'Removed: not shown in the location line.',
  'sections.skills.groups[].lead': 'Removed: the group shows only its title.',
  'sections.contact.cta': 'Removed: only the big email link and the extra buttons are shown.',
  'ui.builtWith': 'Removed: the footer ends with the date.',
};
const generic = (path) => (path.startsWith('$') ? genericPath(path) : path);
/** What the form says in place of a removed content line ('' for a field that has no wording of its own). */
export const offTextFor = (path) => OFF_TEXT[generic(path)] || '';
/** True for the content lines that can be added back (as opposed to nav, lead and detail). */
export const isContentLine = (path) => generic(path) in OFF_TEXT;

// Lines that can never be removed, and the reason the form gives (decision D8).
const KEEP = {
  'person.givenName': 'The name is always shown.',
  'person.familyName': 'The name is always shown.',
  'person.monogram': 'Drawn in the icons and the social cards.',
  'hero.role': 'Also the job title in the structured data, the social-card text and the app name.',
  'contact.heading': 'Names the contact list for screen readers.',
  'contact.items[].label': 'Names the row for screen readers.',
  'sections.*.title': 'A section needs a title; to remove the section, hide it under Section order.',
  'meta.title': 'Required by search engines.',
  'meta.description': 'Required by search engines.',
};
// Why a list keeps its minimum, and what to do instead (decision D5).
const MIN_NOTES = { 'sections.skills.groups[].items': 'Remove the group instead.' };
export function minNoteFor(path) {
  const g = generic(path);
  return MIN_NOTES[g] || (g.startsWith('sections.') ? 'To remove the whole section, hide it under Section order.' : '');
}

/** Why a required line stays ('' when the form has nothing to add). */
export function keepReason(path) {
  const g = generic(path);
  return KEEP[g] || KEEP[g.replace(/^sections\.[a-z]+\./, 'sections.*.')] || '';
}

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
  // the Section order tab owns the order and what is reported on the section set as a whole
  // ($.sections itself: NO_SECTIONS, NAV_BUDGET); a path inside a section belongs to that section's tab
  sections: ['$.settings.sectionOrder', '$.sections'],
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

/**
 * The content tab that edits a path, or null. The most specific root wins, so "$.sections" belongs to the
 * Section order tab while "$.sections.profile.title" belongs to Profile, and "$.settings.sectionOrder"
 * beats the dashboard's "$.settings".
 */
export function tabOf(path) {
  let best = null;
  for (const [tab, roots] of Object.entries(TAB_ROOTS)) {
    for (const r of roots) if (under(path, r) && (!best || r.length > best.len)) best = { tab, len: r.length };
  }
  return best ? best.tab : null;
}

export function routeForPath(path) {
  const tab = tabOf(path);
  if (tab) return `/content/${tab}`;
  if (SEO_ROOTS.some((r) => under(path, r))) return '/seo';
  if (DASHBOARD_ROOTS.some((r) => under(path, r))) return '/';
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
