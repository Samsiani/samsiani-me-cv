// C · Ledger — layout manifest (contract: docs/plans/data-model.md §8.2; spec: docs/plans/layout-ledger.md).
// CSS string literal for @page content: admin-edited text must not break out of the <style> element.
const cssString = (s) => '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/</g, '\\3C ').replace(/\n/g, '\\A ') + '"';

export default {
  id: 'ledger',
  label: 'C · Ledger',
  description: 'Pure white, IBM Plex, numbered index column, skills as a table.',
  thumbnail: 'admin-thumbs/ledger.svg',
  // concatenated in this order (joined with "\n") into dist/styles.<hash>.css, then the palette block
  css: ['fonts.css', 'styles.css'],
  // woff2 basenames under src/fonts/; the build copies only these
  fonts: ['ibm-plex-sans-latin-wght-100-700', 'ibm-plex-mono-latin-400', 'ibm-plex-mono-latin-500', 'noto-sans-georgian-georgian-normal-400-700'],
  preload: {
    en: ['ibm-plex-sans-latin-wght-100-700', 'ibm-plex-mono-latin-400', 'ibm-plex-mono-latin-500'],
    ka: ['noto-sans-georgian-georgian-normal-400-700', 'ibm-plex-sans-latin-wght-100-700', 'ibm-plex-mono-latin-400', 'ibm-plex-mono-latin-500'],
  },
  themeColor: { light: '#ffffff', dark: '#0d1013' }, // <meta name="theme-color"> = --paper per mode
  manifestBackground: '#0d1013',
  // Optional hook (one line in shared/document.mjs renderHead, spec §9.2): the printed running footer
  // "name · host". Without the hook the PDF still gets "n / N" page numbers from styles.css.
  headExtra: (c, ctx) => `<style media="print">@page{@bottom-left{content:${cssString(`${c.hero.name} · ${ctx.host}`)}}}</style>`,
  // The three faces the owner may replace (fonts plan §5.1). `files` names this role's basenames in `fonts`
  // above, `var`/`tail` reproduce the stack styles.css declares, and `weights` is what the layout asks for.
  // Ledger needs no override CSS: its nav tier is a class the template stamps in both modes.
  fontRoles: {
    text: {
      var: '--sans', label: 'Text', help: 'Headings and body text.',
      defaultFamily: 'IBM Plex Sans', files: ['ibm-plex-sans-latin-wght-100-700'], weights: [300, 400, 500],
      tail: 'system-ui, -apple-system, "Segoe UI", sans-serif', kaTail: 'system-ui, sans-serif',
    },
    label: {
      var: '--mono', label: 'Labels', help: 'Index numbers, periods and small labels on the English page.',
      defaultFamily: 'IBM Plex Mono', files: ['ibm-plex-mono-latin-400', 'ibm-plex-mono-latin-500'], weights: [400, 500],
      tail: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', georgianInStack: true,
    },
    georgian: {
      var: null, label: 'Georgian', help: 'Every Georgian letter, on both pages.',
      defaultFamily: 'Noto Sans Georgian', files: ['noto-sans-georgian-georgian-normal-400-700'], weights: [350, 400],
      extraSelectors: ['.lg-lang [lang="ka"]'],
    },
  },
};
