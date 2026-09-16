<script setup>
// #/ Dashboard (admin-ops.md §6.5): status strip, layout, palette, default theme, last updated, live preview.
import { computed, ref, watch } from 'vue';
import FontPicker from '../components/FontPicker.vue';
import Icon from '../components/Icon.vue';
import IssueList from '../components/IssueList.vue';
import LayoutPicker from '../components/LayoutPicker.vue';
import PalettePicker from '../components/PalettePicker.vue';
import PreviewFrame from '../components/PreviewFrame.vue';
import { draft, diffCount, issuesAt, discard } from '../state/draft.js';
import { layoutById, paletteById } from '../state/registry.js';
import { openPublish } from '../state/publish.js';
import { confirmAction, toast } from '../state/ui.js';

const s = computed(() => draft.site.settings);
const layout = computed(() => layoutById(s.value.layout));
const systemLabel = computed(() => (layout.value?.defaultTheme ? `Layout default (${layout.value.defaultTheme})` : 'Follow the visitor’s system'));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'not published from the admin yet');
const liveLayout = computed(() => layoutById(draft.publishedSite?.settings?.layout)?.label || draft.publishedSite?.settings?.layout || '');
const livePalette = computed(() => paletteById(draft.publishedSite?.settings?.palette)?.label?.en || draft.publishedSite?.settings?.palette || '');
const nothing = computed(() => diffCount.value === 0);

// last updated: only complete, real dates reach the draft (a bad date under settings would stop the autosave)
const dateText = ref(s.value.updated);
const dateError = ref('');
watch(() => s.value.updated, (v) => { if (v !== dateText.value) { dateText.value = v; dateError.value = ''; } });
function onDate(e) {
  const v = e.target.value;
  dateText.value = v;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) {
    dateError.value = '';
    if (s.value.updated !== v) s.value.updated = v;
  } else {
    dateError.value = 'Enter a complete date.';
  }
}
const eyebrowYear = computed(() => [...issuesAt('$.hero.eyebrow.en'), ...issuesAt('$.hero.eyebrow.ka')].filter((i) => i.code === 'EYEBROW_YEAR'));

async function askDiscard() {
  if (nothing.value || draft.inert) return;
  const ok = await confirmAction({
    title: 'Discard the draft?',
    message: `The draft becomes a copy of the live site (r${draft.published?.rev ?? '?'}). The current draft stays in Revisions as “pre-discard”.`,
    confirmLabel: 'Discard draft',
    danger: true,
  });
  if (!ok) return;
  try {
    await discard();
    toast('Draft discarded; it now equals the live site.');
  } catch (e) {
    toast(`Discard failed: ${e.message}`);
  }
}
</script>

<template>
  <div class="page-head">
    <h1>Dashboard</h1>
  </div>

  <section class="strip" aria-label="Live site and draft">
    <dl class="strip-facts">
      <div><dt>Live</dt><dd>r{{ draft.published?.rev }} · {{ fmt(draft.published?.publishedAt) }}</dd></div>
      <div><dt>Live layout</dt><dd>{{ liveLayout }}</dd></div>
      <div><dt>Live palette</dt><dd>{{ livePalette }}</dd></div>
      <div>
        <dt>Draft</dt>
        <dd data-testid="diff-count">
          <span v-if="nothing" class="st st-ok"><Icon name="ok" />Same as live</span>
          <span v-else class="st"><Icon name="pending" />Draft differs from live in {{ diffCount }} {{ diffCount === 1 ? 'field' : 'fields' }}</span>
        </dd>
      </div>
    </dl>
    <div class="btn-row">
      <button type="button" class="btn btn-primary" :aria-disabled="nothing || draft.inert ? 'true' : undefined" @click="!nothing && !draft.inert && openPublish()">Publish</button>
      <button type="button" class="btn btn-danger" :aria-disabled="nothing || draft.inert ? 'true' : undefined" @click="askDiscard">Discard draft</button>
    </div>
  </section>

  <div class="dash">
    <div class="dash-controls">
      <LayoutPicker :settings="s" />
      <PalettePicker :settings="s" />
      <FontPicker :settings="s" />

      <fieldset>
        <legend class="sec-title">Default theme</legend>
        <p class="help" id="theme-help">For visitors who have not chosen a theme themselves. Their own choice always wins.</p>
        <div class="radio-list" aria-describedby="theme-help">
          <label class="check"><input id="f-settings-defaultTheme" type="radio" name="defaultTheme" value="system" :checked="s.defaultTheme === 'system'" @change="s.defaultTheme = 'system'"> {{ systemLabel }}</label>
          <label class="check"><input type="radio" name="defaultTheme" value="light" :checked="s.defaultTheme === 'light'" @change="s.defaultTheme = 'light'"> Light</label>
          <label class="check"><input type="radio" name="defaultTheme" value="dark" :checked="s.defaultTheme === 'dark'" @change="s.defaultTheme = 'dark'"> Dark</label>
        </div>
      </fieldset>

      <div class="stack">
        <div>
          <label for="f-settings-updated" class="sec-title lbl">Last updated</label>
          <p class="help" id="updated-help">The date in the footer, the © year and the sitemap.</p>
          <input id="f-settings-updated" class="inp inp-date" type="date" :value="dateText" aria-describedby="updated-help" :aria-invalid="dateError ? 'true' : undefined" @input="onDate" @change="onDate">
          <ul v-if="dateError" class="issues"><li class="issue-error"><Icon name="error" /><span>{{ dateError }}</span></li></ul>
          <IssueList :issues="issuesAt('$.settings.updated')" />
          <IssueList :issues="eyebrowYear" linked />
        </div>
        <label class="check"><input id="f-settings-autoUpdateDateOnPublish" type="checkbox" :checked="s.autoUpdateDateOnPublish" @change="s.autoUpdateDateOnPublish = $event.target.checked"> Set to today when content changes on publish</label>
      </div>
    </div>

    <section class="dash-preview" aria-labelledby="preview-title">
      <h2 id="preview-title" class="sec-title">Live preview <span class="muted">(unsaved changes included)</span></h2>
      <PreviewFrame />
    </section>
  </div>
</template>
