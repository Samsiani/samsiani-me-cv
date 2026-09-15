// Markup whose data-attributes are the contract with src/main.js. Layouts may pass their own
// class names, but must not change the data-* attributes, `hidden`, or the aria wiring.
import { esc } from './escape.mjs';
import { UI_ICONS } from './icons.mjs';

// [data-copy]: main.js un-hides it when navigator.clipboard exists and swaps the text for data-copied.
export const copyButton = (value, ui, cls = 'copy') =>
  `<button type="button" class="${cls}" data-copy="${esc(value)}" data-copied="${esc(ui.copied)}" hidden aria-label="${esc(ui.copy)}: ${esc(value)}">${esc(ui.copy)}</button>`;

// [data-theme-toggle]: main.js sets aria-pressed and flips html[data-theme].
export const themeToggle = (ui, cls = 'ctl ctl-icon', inner = UI_ICONS.theme) =>
  `<button type="button" class="${cls}" data-theme-toggle aria-label="${esc(ui.theme)}" title="${esc(ui.theme)}">${inner}</button>`;

// [data-print]: hidden without JS; main.js un-hides it and calls window.print().
export const printButton = (ui, cls = 'ctl ctl-primary') =>
  `<button type="button" class="${cls}" data-print hidden aria-label="${esc(ui.print)}"><span class="label-long">${esc(ui.print)}</span><span class="label-short">${esc(ui.printShort)}</span></button>`;

// [data-lang-switch]: main.js remembers the choice in localStorage("lang").
export const langSwitchLink = (c, alt, label, extra = '') =>
  `<a href="${c.altPath}" hreflang="${alt.lang}" lang="${alt.lang}"${extra} data-lang-switch="${alt.lang}">${esc(label)}</a>`;

// a[data-spy="<anchor>"]: main.js marks the visible section with aria-current="location".
export const SECTION_ORDER = ['profile', 'skills', 'abilities', 'workstyle', 'principles', 'experience', 'education', 'contact'];
export const orderedSections = (c) => SECTION_ORDER.map((k) => c.sections[k]);

export const isExternal = (href) => href.startsWith('http');
