// Layout manifest: everything the shared build/head needs to know about this layout.
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
};
