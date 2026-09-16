// Layout manifest: everything the shared build/head needs to know about this layout.
const SANS_TAIL = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export default {
  id: 'precision',
  label: 'A · Precision',
  description: 'The current design: identity rail on the left, content on the right, skills as a ledger table.',
  thumbnail: 'admin-thumbs/precision.svg',
  // concatenated in this order (joined with "\n") into dist/styles.<hash>.css, then the palette block
  css: ['fonts.css', 'styles.css'],
  // woff2 basenames under src/fonts/ that this layout uses; the build copies only these
  fonts: ['chivo-latin-normal-400-700', 'jetbrains-mono-latin-normal-400-500', 'noto-sans-georgian-georgian-normal-400-700'],
  preload: {
    en: ['chivo-latin-normal-400-700', 'jetbrains-mono-latin-normal-400-500'],
    ka: ['noto-sans-georgian-georgian-normal-400-700', 'chivo-latin-normal-400-700', 'jetbrains-mono-latin-normal-400-500'],
  },
  themeColor: { light: '#fafafb', dark: '#151619' }, // <meta name="theme-color">, = --bg per mode
  manifestBackground: '#111318',
  // The three faces the owner may replace (fonts plan §5.1). `files` names this role's basenames in `fonts`
  // above, `var`/`tail` reproduce the stack styles.css declares, and `weights` is what the layout asks for.
  fontRoles: {
    text: {
      var: '--sans', label: 'Text', help: 'Headings and body text.',
      defaultFamily: 'Chivo', files: ['chivo-latin-normal-400-700'], weights: [400, 600, 700],
      tail: SANS_TAIL, kaTail: 'system-ui, sans-serif',
    },
    label: {
      var: '--mono', label: 'Labels', help: 'Eyebrows, indices and small labels on the English page.',
      defaultFamily: 'JetBrains Mono', files: ['jetbrains-mono-latin-normal-400-500'], weights: [400, 500],
      tail: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', georgianInStack: false,
    },
    georgian: {
      var: null, label: 'Georgian', help: 'Every Georgian letter, on both pages.',
      defaultFamily: 'Noto Sans Georgian', files: ['noto-sans-georgian-georgian-normal-400-700'], weights: [400, 600, 700],
      extraSelectors: ['.lang > [lang="ka"]'],
    },
  },
  // Override mode only: the inline nav is a CSS breakpoint decision today, so the tier the template stamps
  // on .topbar needs the matching rules. Nothing is stamped and nothing is emitted with the default fonts.
  overrideCss: () => [
    '.topbar[data-navfit] .topnav { display: none; }',
    ...[1280, 1440, 1680].map((bp) => `@media (min-width: ${bp}px) { .topbar[data-navfit="${bp}"] .topnav { display: flex; } }`),
  ],
};
