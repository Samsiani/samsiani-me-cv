<script setup>
// Shell (admin-ops.md §6.4): 56 px top bar with the brand, the navigation (a <details> menu below 1024 px),
// the draft status, the live status and Publish (disabled while the draft equals live).
import { computed, ref, watch } from 'vue';
import Icon from './Icon.vue';
import PublishDialog from './PublishDialog.vue';
import ConflictDialog from './ConflictDialog.vue';
import PendingCopyDialog from './PendingCopyDialog.vue';
import DashboardView from '../views/DashboardView.vue';
import ContentView from '../views/ContentView.vue';
import SeoView from '../views/SeoView.vue';
import RevisionsView from '../views/RevisionsView.vue';
import AccountView from '../views/AccountView.vue';
import { route } from '../router.js';
import { draft, diffCount } from '../state/draft.js';
import { session } from '../state/session.js';
import { openPublish } from '../state/publish.js';

defineProps({ bootError: { type: String, default: '' }, booting: { type: Boolean, default: false } });
defineEmits(['retry']);

const LINKS = [
  { name: 'dashboard', href: '#/', text: 'Dashboard' },
  { name: 'content', href: '#/content/person', text: 'Content' },
  { name: 'seo', href: '#/seo', text: 'SEO' },
  { name: 'revisions', href: '#/revisions', text: 'Revisions' },
  { name: 'account', href: '#/account', text: 'Account' },
];
const menu = ref(null);
watch(() => route.seq, () => { if (menu.value) menu.value.open = false; });

const status = computed(() => {
  if (session.modal) return { icon: 'offline', cls: 'st-warn', text: 'Signed out, changes kept on this device' };
  switch (draft.status) {
    case 'saved': return { icon: 'ok', cls: 'st-ok', text: `Saved · r${draft.rev}` };
    case 'pending': return { icon: 'pending', cls: 'st-busy', text: 'Unsaved changes' };
    case 'saving': return { icon: 'busy', cls: 'st-busy', text: 'Saving…' };
    case 'retrying': return { icon: 'warn', cls: 'st-warn', text: 'Unsaved changes, retrying' };
    case 'offline': return { icon: 'offline', cls: 'st-warn', text: 'Offline, kept on this device' };
    case 'rejected': return { icon: 'error', cls: 'st-error', text: 'Not saved: structural errors' };
    case 'conflict': return { icon: 'warn', cls: 'st-warn', text: 'Changed in another tab or device' };
    default: return { icon: 'error', cls: 'st-error', text: `Not saved: ${draft.lastError || 'error'}` };
  }
});
const errorCount = computed(() => draft.issues.errors.length);
const fmt = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const live = computed(() => {
  const p = draft.published;
  if (!p) return '';
  return p.publishedAt ? `Live r${p.rev} · ${fmt(p.publishedAt)}` : `Live r${p.rev} · seed`;
});
const nothingToPublish = computed(() => draft.loaded && diffCount.value === 0);

function publish() {
  if (nothingToPublish.value || draft.inert) return;
  openPublish();
}
function skipToMain() {
  const h = document.querySelector('main h1');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
}
</script>

<template>
  <button type="button" class="skip" @click="skipToMain">Skip to content</button>
  <header class="adm-top">
    <a class="adm-brand" href="#/">samsiani.me admin</a>
    <nav class="adm-nav" aria-label="Admin">
      <a v-for="l in LINKS" :key="l.name" :href="l.href" :aria-current="route.name === l.name ? 'page' : undefined">{{ l.text }}</a>
    </nav>
    <details ref="menu" class="adm-menu">
      <summary>Menu</summary>
      <nav class="adm-nav" aria-label="Admin">
        <a v-for="l in LINKS" :key="l.name" :href="l.href" :aria-current="route.name === l.name ? 'page' : undefined">{{ l.text }}</a>
      </nav>
    </details>
    <div v-if="draft.loaded" class="adm-top-status">
      <span class="st" :class="status.cls" role="status" data-testid="draft-status"><Icon :name="status.icon" />{{ status.text }}</span>
      <span v-if="errorCount" class="st st-error"><Icon name="error" />{{ errorCount }} {{ errorCount === 1 ? 'error blocks' : 'errors block' }} publishing</span>
      <span class="st st-live"><Icon name="live" />{{ live }}</span>
    </div>
    <div v-if="draft.loaded" class="adm-top-actions">
      <button
        type="button"
        class="btn btn-primary"
        data-testid="publish"
        :aria-disabled="nothingToPublish || draft.inert ? 'true' : undefined"
        :title="nothingToPublish ? 'Nothing to publish: the draft equals the live site' : 'Publish the draft to samsiani.me'"
        @click="publish"
      >Publish</button>
    </div>
  </header>
  <main id="main" class="adm-main" :inert="draft.inert || undefined">
    <div v-if="!draft.loaded" class="adm-boot">
      <p v-if="bootError" class="st st-error" role="alert"><Icon name="error" />{{ bootError }}</p>
      <p v-else role="status">Loading the draft…</p>
      <p v-if="bootError"><button type="button" class="btn" @click="$emit('retry')">Try again</button></p>
    </div>
    <template v-else>
      <DashboardView v-if="route.name === 'dashboard'" />
      <ContentView v-else-if="route.name === 'content'" :tab="route.params.tab" />
      <SeoView v-else-if="route.name === 'seo'" />
      <RevisionsView v-else-if="route.name === 'revisions'" />
      <AccountView v-else-if="route.name === 'account'" />
    </template>
  </main>
  <PublishDialog />
  <ConflictDialog />
  <PendingCopyDialog />
</template>
