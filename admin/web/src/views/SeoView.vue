<script setup>
// #/seo (admin-ops.md §6.5): titles and descriptions per language with a search-result preview, EN and KA
// social-card previews (POST /og-preview, on demand), alternate name, address, sameAs; siteUrl read-only.
import { computed, ref, toRaw, onMounted } from 'vue';
import Icon from '../components/Icon.vue';
import LField from '../components/LField.vue';
import SchemaNode from '../components/SchemaNode.vue';
import SerpPreview from '../components/SerpPreview.vue';
import { api, blobToDataUrl } from '../api.js';
import { draft } from '../state/draft.js';
import { registry } from '../state/registry.js';

const S = computed(() => registry.schema.shape);
const site = computed(() => draft.site);
const host = computed(() => String(site.value.settings.siteUrl || '').replace(/^https:\/\//, ''));

const cards = ref({ en: null, ka: null });
const cardMsg = ref('');
const cardBusy = ref(false);
const changes = ref({ en: null, ka: null }); // true when the card name differs from the live one

const plain = (v) => JSON.parse(JSON.stringify(toRaw(v)));
async function ogName(doc, lang) {
  const r = await api('POST', '/preview', { body: { site: plain(doc) } });
  const res = await fetch(r.base + (lang === 'ka' ? 'ka/' : ''), { credentials: 'same-origin', cache: 'no-store' });
  const m = /<meta property="og:image" content="([^"]+)"/.exec(await res.text());
  return m ? m[1].split('/').pop() : null;
}

async function renderCards() {
  if (cardBusy.value) return;
  cardBusy.value = true;
  cardMsg.value = '';
  try {
    for (const lang of ['en', 'ka']) {
      const res = await api('POST', '/og-preview', { body: { lang, site: plain(site.value) }, raw: true });
      cards.value[lang] = await blobToDataUrl(await res.blob());
    }
    if (draft.publishedSite) {
      for (const lang of ['en', 'ka']) {
        const [mine, live] = await Promise.all([ogName(site.value, lang), ogName(draft.publishedSite, lang)]);
        changes.value[lang] = mine && live ? mine !== live : null;
      }
    }
  } catch (e) {
    cardMsg.value = e.status === 429 ? 'Too many card previews in a minute; try again shortly.' : `The cards could not be rendered: ${e.message}`;
  } finally {
    cardBusy.value = false;
  }
}
onMounted(renderCards);
</script>

<template>
  <div class="page-head">
    <h1>SEO</h1>
  </div>

  <section class="panel" aria-labelledby="seo-search">
    <h2 id="seo-search" class="panel-head">Search results</h2>
    <LField :model="site.meta" field="title" path="$.meta.title" :spec="S.meta.shape.title" />
    <LField :model="site.meta" field="description" path="$.meta.description" :spec="S.meta.shape.description" />
    <div class="seo-grid">
      <div>
        <h3 class="sec-title">English result</h3>
        <SerpPreview :title="site.meta.title.en" :description="site.meta.description.en" :url="`${host} › `" lang="en" />
      </div>
      <div>
        <h3 class="sec-title">Georgian result</h3>
        <SerpPreview :title="site.meta.title.ka" :description="site.meta.description.ka" :url="`${host} › ka`" lang="ka" />
      </div>
    </div>
    <p class="help">Approximate: search engines cut titles near 60 characters and descriptions near 160.</p>
  </section>

  <section class="panel" aria-labelledby="seo-cards">
    <div class="panel-head">
      <h2 id="seo-cards">Social cards</h2>
      <button type="button" class="btn" :aria-disabled="cardBusy ? 'true' : undefined" @click="renderCards"><Icon name="reload" /> {{ cardBusy ? 'Rendering…' : 'Refresh cards' }}</button>
    </div>
    <p class="help">Rendered from the draft: name, role, subrole, the four facts, the monogram and the palette.</p>
    <p v-if="cardMsg" class="st st-error" role="alert"><Icon name="error" />{{ cardMsg }}</p>
    <div class="og-list">
      <figure v-for="lang in ['en', 'ka']" :key="lang" class="og-card">
        <img v-if="cards[lang]" class="og-img" :src="cards[lang]" :alt="`${lang === 'en' ? 'English' : 'Georgian'} social card preview`" width="1200" height="630">
        <div v-else class="og-img" aria-hidden="true" />
        <figcaption class="small">
          {{ lang === 'en' ? 'English' : 'Georgian' }} card
          <span v-if="changes[lang] === true" class="st st-warn"> · <Icon name="warn" />Card changes on publish</span>
          <span v-else-if="changes[lang] === false" class="muted"> · same as live</span>
        </figcaption>
      </figure>
    </div>
  </section>

  <section class="panel" aria-labelledby="seo-person">
    <h2 id="seo-person" class="panel-head">Structured data</h2>
    <LField :model="site.person" field="alternateName" path="$.person.alternateName" :spec="S.person.shape.alternateName" />
    <SchemaNode :model="site.person" field="address" path="$.person.address" :spec="S.person.shape.address" />
    <SchemaNode :model="site.person" field="sameAs" path="$.person.sameAs" :spec="S.person.shape.sameAs" />
    <div class="fld">
      <label for="f-settings-siteUrl" class="lbl">Site address</label>
      <p id="siteurl-help" class="help">Set by the server (SITE_URL); canonical links, hreflang and the sitemap use it.</p>
      <input id="f-settings-siteUrl" class="inp" type="text" :value="site.settings.siteUrl" readonly aria-describedby="siteurl-help">
    </div>
  </section>
</template>
