<script setup>
// Publish dialog (admin-ops.md §6.8): layout, palette, changed fields, the date that will be published,
// blocking errors (each links to its input and closes the dialog) or warnings to acknowledge, a note, then
// the result "Live · r58 · published in 1.2 s" or the error with its stage.
import { computed, toRaw } from 'vue';
import ModalDialog from './ModalDialog.vue';
import IssueList from './IssueList.vue';
import Icon from './Icon.vue';
import { diffPaths } from '@admin-shared/diff.mjs';
import { draft, diffCount, todayTbilisi } from '../state/draft.js';
import { layoutById, paletteById } from '../state/registry.js';
import { pub, closePublish, confirmPublish, publishDate } from '../state/publish.js';

const CONTENT = /^\$\.(person|meta|ui|hero|contact|sections)\b|^\$\.settings\.sectionOrder\b/;
const contentChanged = computed(() => {
  void draft.version;
  if (!draft.site || !draft.publishedSite) return false;
  return diffPaths(toRaw(draft.publishedSite), toRaw(draft.site)).some((d) => CONTENT.test(d.path));
});
const today = todayTbilisi();
const date = computed(() => publishDate(contentChanged.value, today));
const layout = computed(() => layoutById(draft.site?.settings?.layout)?.label || draft.site?.settings?.layout);
const palette = computed(() => paletteById(draft.site?.settings?.palette)?.label?.en || draft.site?.settings?.palette);
const siteUrl = computed(() => draft.site?.settings?.siteUrl || '');
const sections = computed(() => {
  void draft.version;
  const keys = draft.site?.settings?.sectionOrder || [];
  const s = draft.site?.sections || {};
  const hidden = keys.filter((k) => s[k]?.hidden).map((k) => s[k].title.en || k);
  return { total: keys.length, shown: keys.length - hidden.length, hidden };
});
const canPublish = computed(() => pub.phase === 'review' && !pub.errors.length && (!pub.warnings.length || pub.ack));
const busy = computed(() => pub.phase === 'publishing' || pub.phase === 'settling');
const extraWarnings = computed(() => (pub.result?.warnings || []).filter((w) => typeof w === 'string'));
</script>

<template>
  <ModalDialog :open="pub.open" labelledby="publish-title" :closable="!busy" @close="closePublish">
    <div class="dlg-head"><h2 id="publish-title">{{ pub.phase === 'done' ? 'Published' : 'Publish to samsiani.me' }}</h2></div>

    <p v-if="pub.phase === 'settling'" class="st st-busy" role="status"><Icon name="busy" /> Saving the latest changes…</p>

    <form v-else-if="pub.phase === 'review' || pub.phase === 'publishing'" class="dlg-body" @submit.prevent="confirmPublish">
      <fieldset :disabled="pub.phase === 'publishing'" class="dlg-body">
        <dl class="dlg-facts">
          <dt>Layout</dt><dd>{{ layout }}</dd>
          <dt>Palette</dt><dd>{{ palette }}</dd>
          <dt>Sections</dt><dd>{{ sections.shown }} of {{ sections.total }} shown<span v-if="sections.hidden.length"> · hidden: {{ sections.hidden.join(', ') }}</span></dd>
          <dt>Changed fields</dt><dd>{{ diffCount }} {{ diffCount === 1 ? 'field differs' : 'fields differ' }} from the live site</dd>
          <dt>Date</dt><dd>{{ date }}<span v-if="date !== draft.site?.settings?.updated" class="muted"> (today: content changed and “Set to today” is on)</span></dd>
        </dl>
        <div v-if="pub.errors.length">
          <p class="st st-error"><Icon name="error" /> {{ pub.errors.length }} {{ pub.errors.length === 1 ? 'error blocks' : 'errors block' }} publishing. Fix {{ pub.errors.length === 1 ? 'it' : 'them' }} first:</p>
          <IssueList :issues="pub.errors" linked @navigate="pub.open = false" />
        </div>
        <div v-else-if="pub.warnings.length">
          <p class="st st-warn"><Icon name="warn" /> {{ pub.warnings.length }} {{ pub.warnings.length === 1 ? 'warning' : 'warnings' }}:</p>
          <IssueList :issues="pub.warnings" linked @navigate="pub.open = false" />
          <label class="check"><input v-model="pub.ack" type="checkbox"> I have reviewed these warnings</label>
        </div>
        <p v-else class="st st-ok"><Icon name="ok" /> No errors or warnings.</p>
        <div>
          <label for="publish-note" class="lbl">Note (optional)</label>
          <input id="publish-note" v-model="pub.note" class="inp" type="text" maxlength="200" autocomplete="off">
        </div>
      </fieldset>
      <p v-if="pub.phase === 'publishing'" class="st st-busy" role="status"><Icon name="busy" /> Publishing…</p>
      <div class="dlg-actions">
        <button type="button" class="btn" :aria-disabled="busy ? 'true' : undefined" @click="closePublish">Cancel</button>
        <button type="submit" class="btn btn-primary" :aria-disabled="!canPublish ? 'true' : undefined" autofocus>Publish to samsiani.me</button>
      </div>
    </form>

    <div v-else-if="pub.phase === 'done'" class="dlg-body">
      <p class="st st-ok" role="status"><Icon name="ok" /> Live · r{{ pub.result.publishedRev }} · published in {{ pub.result.seconds }} s</p>
      <p class="muted">{{ pub.result.changedFiles }} {{ pub.result.changedFiles === 1 ? 'file' : 'files' }} changed.</p>
      <p v-if="extraWarnings.includes('og_stale')" class="st st-warn"><Icon name="warn" /> The social cards could not be rendered; the previous ones stay until the next publish.</p>
      <p class="btn-row">
        <a class="btn" :href="siteUrl + '/'" target="_blank" rel="noopener">Open / <Icon name="external" /></a>
        <a class="btn" :href="siteUrl + '/ka/'" target="_blank" rel="noopener">Open /ka/ <Icon name="external" /></a>
      </p>
      <div class="dlg-actions"><button type="button" class="btn btn-primary" autofocus @click="closePublish">Close</button></div>
    </div>

    <div v-else-if="pub.phase === 'error'" class="dlg-body">
      <p class="st st-error" role="alert"><Icon name="error" /> {{ pub.error }}</p>
      <div class="dlg-actions"><button type="button" class="btn" autofocus @click="closePublish">Close</button></div>
    </div>
  </ModalDialog>
</template>
