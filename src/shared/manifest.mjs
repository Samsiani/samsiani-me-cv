// site.<hash>.webmanifest. Icons come from the (hashed) brand assets, colours from layout + palette.
import { displayName } from './localize.mjs';

export function webmanifest(site, layout, palette, assets) {
  return JSON.stringify(
    {
      name: `${displayName(site.person, 'en')} — ${site.hero.role.en}`,
      short_name: site.person.familyName.en,
      start_url: '/',
      display: 'browser',
      background_color: layout.manifestBackground,
      theme_color: palette.manifestTheme,
      icons: [
        { src: assets.icons.i192, sizes: '192x192', type: 'image/png' },
        { src: assets.icons.i512, sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2
  );
}
