// site.webmanifest (moved from build.mjs). Colours come from the layout + palette manifests.
import { displayName } from './localize.mjs';

export function webmanifest(site, layout, palette) {
  return JSON.stringify(
    {
      name: `${displayName(site.person, 'en')} — ${site.hero.role.en}`,
      short_name: site.person.familyName.en,
      start_url: '/',
      display: 'browser',
      background_color: layout.manifestBackground,
      theme_color: palette.manifestTheme,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2
  );
}
