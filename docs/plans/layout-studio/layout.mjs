// B · Studio — layout manifest. Fields = data-model plan §layout meta (id, css, fonts, preload,
// themeColor, manifestBackground) + admin plan §5.1 registry (name, description, thumbnail)
// + defaultTheme (Studio is dark-first; see docs/plans/layout-studio.md §4.2).
export default {
  id: 'studio',
  label: 'B · Studio',
  name: 'B · Studio',
  description: 'Dark-first. Bento hero, wide Archivo headings, hairline bands, skills as a three-column table.',
  thumbnail: 'admin-thumbs/studio.svg',
  // concatenated in this order (joined with "\n") into dist/styles.<hash>.css, then the palette block
  css: ['fonts.css', 'styles.css'],
  // woff2 basenames under src/fonts/ that this layout uses; the build copies only these
  fonts: ['archivo-latin-wdth-wght', 'jetbrains-mono-latin-normal-400-500', 'noto-sans-georgian-georgian-normal-400-700'],
  preload: {
    en: ['archivo-latin-wdth-wght', 'jetbrains-mono-latin-normal-400-500'],
    ka: ['noto-sans-georgian-georgian-normal-400-700', 'archivo-latin-wdth-wght', 'jetbrains-mono-latin-normal-400-500'],
  },
  themeColor: { light: '#f5f7f9', dark: '#101419' }, // <meta name="theme-color"> = --st-bg per mode
  manifestBackground: '#101419',
  defaultTheme: 'dark', // used when settings.defaultTheme is "system" (plan §4.2)
};
