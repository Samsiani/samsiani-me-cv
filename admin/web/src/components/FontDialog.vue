<script setup>
// The font chooser (fonts plan §6): three tabs — the whole Google catalogue the server cached, a file the
// owner uploads, and the fonts this machine already holds. Choosing a Google family or uploading a file
// stores it on the server first; only then does the dialog show its specimen and offer "Use this font", so
// the document never names an id the store does not have.
//
// Nothing here talks to Google: the catalogue comes from the admin's own API and the licence page is a link
// the owner opens, never a request the SPA makes.
import { computed, ref, watch } from 'vue';
import ModalDialog from './ModalDialog.vue';
import FontSpecimen from './FontSpecimen.vue';
import Icon from './Icon.vue';
import { registry } from '../state/registry.js';
import {
  fonts, addGoogle, byId, loadCatalogue, loadFonts, remove, rename, specimenFace, upload,
} from '../state/fonts.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  layout: { type: String, required: true },
  layoutLabel: { type: String, default: '' },
  role: { type: String, default: 'text' },
  roleLabel: { type: String, default: '' },
  current: { type: String, default: null },
});
const emit = defineEmits(['close', 'choose']);

const TABS = [
  { id: 'google', label: 'Google Fonts' },
  { id: 'upload', label: 'Upload a file' },
  { id: 'store', label: 'Already added' },
];
const CATEGORIES = ['Sans Serif', 'Serif', 'Display', 'Handwriting', 'Monospace'];
const PAGE = 60;

const tab = ref('google');
const busy = ref('');
const error = ref('');
const picked = ref(null); // the stored FontRecord the owner is looking at
const specimen = ref('');
const specimenBusy = ref(false);
const editName = ref('');

// Google tab
const query = ref('');
const typed = ref('');
const category = ref('');
const onlyVariable = ref(false);
const onlyGeorgian = ref(false);
const shown = ref(PAGE);
let debounce = null;

// Upload tab
const file = ref(null);
const licence = ref(false);
const fileInput = ref(null);

// Already added
const confirming = ref(''); // id whose Delete is waiting for the second click
const renaming = ref('');

const georgianOnly = computed(() => props.role === 'georgian');
const limits = computed(() => registry.fontLimits || { file: 2 * 1024 * 1024, formats: ['woff2', 'woff', 'ttf', 'otf'] });
const kb = (n) => `${Math.max(1, Math.round((n || 0) / 1024))} KB`;

function reset() {
  busy.value = '';
  error.value = '';
  picked.value = null;
  specimen.value = '';
  specimenBusy.value = false;
  editName.value = '';
  file.value = null;
  licence.value = false;
  confirming.value = '';
  renaming.value = '';
  shown.value = PAGE;
  query.value = '';
  typed.value = '';
  category.value = '';
  onlyVariable.value = false;
  onlyGeorgian.value = georgianOnly.value;
}

watch(() => props.open, (open) => {
  if (!open) return;
  reset();
  tab.value = 'google';
  loadFonts().catch(() => {});
  loadCatalogue().catch(() => {}); // a 503 is shown by the Google tab itself
});

watch(typed, (v) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { query.value = v; shown.value = PAGE; }, 150);
});
watch([category, onlyVariable, onlyGeorgian], () => { shown.value = PAGE; });

// ------------------------------------------------------------------ tabs
function onTabKey(e, index) {
  const keys = { ArrowRight: 1, ArrowLeft: -1 };
  let next = null;
  if (e.key in keys) next = (index + keys[e.key] + TABS.length) % TABS.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = TABS.length - 1;
  if (next === null) return;
  e.preventDefault();
  tab.value = TABS[next].id;
  const el = e.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next];
  el?.focus();
}

// ------------------------------------------------------------------ the Google catalogue
const matches = computed(() => {
  const list = fonts.catalogue || [];
  const q = query.value.trim().toLowerCase();
  return list.filter((f) => {
    if (georgianOnly.value || onlyGeorgian.value) { if (!f.georgian) return false; } else if (!f.latin) return false;
    if (onlyVariable.value && !(f.axes || []).includes('wght')) return false;
    if (category.value && f.category !== category.value) return false;
    return !q || f.family.toLowerCase().includes(q);
  }); // the server already sorts the catalogue by Google's popularity rank, most popular first
});
const visible = computed(() => matches.value.slice(0, shown.value));
const weightsOf = (f) => ((f.axes || []).includes('wght') ? 'variable weight' : `${(f.weights || []).length || 1} ${(f.weights || []).length === 1 ? 'weight' : 'weights'}`);
const catalogueDate = computed(() => (fonts.catalogueAt ? new Date(fonts.catalogueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'never'));

// ------------------------------------------------------------------ choosing
async function show(record) {
  picked.value = record;
  editName.value = record.displayName || record.family;
  specimen.value = '';
  specimenBusy.value = true;
  try {
    const s = specimenFace(record);
    await s.load();
    if (picked.value?.id === record.id) specimen.value = s.alias;
  } catch { /* the facts still describe it; only the drawing is missing */ }
  finally { if (picked.value?.id === record.id) specimenBusy.value = false; }
}

const MESSAGES = {
  unknown_family: 'Google Fonts does not have that family any more.',
  google_unavailable: 'Google Fonts could not be reached from the server. Uploads still work.',
  google_unexpected: 'Google Fonts answered something this release cannot read. Try another family, or upload the file.',
  store_full: 'The font store is full. Delete a font under “Already added” first.',
  too_large: 'That font file is too large.',
  licence_required: 'Confirm the licence first.',
  font_convert_failed: 'This font could not be converted to WOFF2. Try uploading it as a WOFF2.',
  rate_limited: 'Too many fonts in a minute. Try again shortly.',
};
const REASONS = {
  format: 'This file is not a TTF, OTF, WOFF or WOFF2 font.',
  coverage: 'The font has no complete Latin or Georgian alphabet, so no role could use it.',
  italic: 'This is an italic font; the site uses upright faces only.',
};
function say(e) {
  if (e?.code === 'font_invalid') return REASONS[e.body?.reason] || 'This font file could not be read; it may be damaged.';
  return MESSAGES[e?.code] || e?.message || 'Something went wrong.';
}

async function chooseGoogle(family) {
  if (busy.value) return;
  busy.value = `Fetching ${family} from Google…`;
  error.value = '';
  picked.value = null;
  try {
    await show(await addGoogle(family));
  } catch (e) { error.value = say(e); }
  finally { busy.value = ''; }
}

function onFile(e) {
  file.value = e.target.files?.[0] || null;
  error.value = '';
}

async function sendUpload() {
  if (busy.value || !file.value || !licence.value) return;
  busy.value = `Checking ${file.value.name}…`;
  error.value = '';
  picked.value = null;
  try {
    await show(await upload(file.value));
  } catch (e) { error.value = say(e); }
  finally { busy.value = ''; }
}

async function useIt() {
  const record = picked.value;
  if (!record || busy.value) return;
  if (georgianOnly.value && record.coverage?.georgian !== true) return;
  const name = editName.value.trim().slice(0, limits.value.displayName || 60);
  try {
    if (name && name !== (record.displayName || record.family)) await rename(record.id, name);
  } catch { /* the name is cosmetic; the choice is not */ }
  emit('choose', record.id);
}

// ------------------------------------------------------------------ already added
const stored = computed(() => fonts.items.filter((f) => !georgianOnly.value || f.coverage?.georgian === true));
const usedBy = (id) => (fonts.usage[id] || []).join(', ');

async function saveName(id) {
  const name = editName.value.trim();
  if (!name) return;
  try {
    await rename(id, name);
    renaming.value = '';
    if (picked.value?.id === id) picked.value = byId(id);
  } catch (e) { error.value = say(e); }
}

async function drop(id) {
  if (confirming.value !== id) { confirming.value = id; return; }
  confirming.value = '';
  error.value = '';
  try {
    await remove(id);
    if (picked.value?.id === id) { picked.value = null; specimen.value = ''; }
  } catch (e) {
    error.value = e.code === 'font_in_use' ? `That font is still in use by: ${(e.body.usedBy || []).join(', ')}. Reset those roles first.` : say(e);
  }
}
</script>

<template>
  <ModalDialog :open="open" labelledby="font-dlg-title" wide :closable="!busy" @close="emit('close')">
    <div class="dlg-head">
      <h2 id="font-dlg-title">Choose the {{ roleLabel.toLowerCase() }} font for {{ layoutLabel }}</h2>
      <button type="button" class="btn" :aria-disabled="busy ? 'true' : undefined" @click="!busy && emit('close')">Close</button>
    </div>

    <div class="fp-tabs" role="tablist" aria-label="Where the font comes from">
      <button
        v-for="(t, i) in TABS" :id="`font-tab-${t.id}`" :key="t.id" type="button" role="tab"
        :aria-selected="tab === t.id ? 'true' : 'false'" :aria-controls="`font-panel-${t.id}`"
        :tabindex="tab === t.id ? 0 : -1" :autofocus="tab === t.id ? true : undefined"
        @click="tab = t.id" @keydown="onTabKey($event, i)"
      >{{ t.label }}</button>
    </div>

    <div :id="`font-panel-${tab}`" class="fp-panel" role="tabpanel" :aria-labelledby="`font-tab-${tab}`">
      <!-- ------------------------------------------------------------- Google -->
      <div v-if="tab === 'google'" class="fp-pane">
        <p v-if="!fonts.googleAvailable" class="st st-warn">
          <Icon name="warn" />
          Google Fonts is unreachable from the server (last catalogue: {{ catalogueDate }}). Uploads still work.
        </p>
        <template v-else>
          <div class="fp-filters">
            <div class="grow">
              <label class="lbl" for="font-search">Search Google Fonts</label>
              <input id="font-search" v-model="typed" class="inp" type="search" autocomplete="off" placeholder="Family name">
            </div>
            <div>
              <label class="lbl" for="font-cat">Category</label>
              <select id="font-cat" v-model="category" class="inp">
                <option value="">All categories</option>
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
            <label class="check"><input type="checkbox" :checked="georgianOnly || onlyGeorgian" :disabled="georgianOnly" @change="onlyGeorgian = $event.target.checked"> Supports Georgian</label>
            <label class="check"><input v-model="onlyVariable" type="checkbox"> Variable weight</label>
          </div>
          <p v-if="fonts.catalogueStale" class="help">The catalogue could not be refreshed; this is the copy of {{ catalogueDate }}.</p>
          <p v-if="!fonts.catalogue" class="st st-busy" role="status"><Icon name="busy" /> Loading the catalogue…</p>
          <p v-else-if="!matches.length" class="muted">No family matches those filters.</p>
          <ul v-else class="fp-rows">
            <li v-for="f in visible" :key="f.family">
              <button type="button" class="fp-row" :aria-pressed="picked && picked.source === 'google' && picked.family === f.family ? 'true' : 'false'" @click="chooseGoogle(f.family)">
                <span class="fp-row-name">{{ f.family }}</span>
                <span class="fp-row-meta">{{ f.category }} · {{ weightsOf(f) }}<span v-if="f.georgian"> · Georgian</span></span>
              </button>
            </li>
          </ul>
          <p v-if="matches.length > visible.length" class="fp-more">
            <button type="button" class="btn" @click="shown += PAGE">Show {{ Math.min(PAGE, matches.length - visible.length) }} more</button>
            <span class="muted small">{{ visible.length }} of {{ matches.length }}</span>
          </p>
        </template>
      </div>

      <!-- ------------------------------------------------------------- Upload -->
      <div v-else-if="tab === 'upload'" class="fp-pane">
        <p class="help">
          {{ (limits.formats || []).join(', ').toUpperCase() }}, up to {{ Math.round((limits.file || 0) / 1024 / 1024) }} MB.
          A TTF, OTF or WOFF is converted to WOFF2 for the site; the original is kept for the social cards.
        </p>
        <div>
          <label class="lbl" for="font-file">Font file</label>
          <input id="font-file" ref="fileInput" class="inp" type="file" accept=".woff2,.woff,.ttf,.otf" @change="onFile">
        </div>
        <label class="check"><input id="font-licence" v-model="licence" type="checkbox"> I hold a licence that allows embedding this font on samsiani.me</label>
        <p class="btn-row">
          <button type="button" class="btn btn-primary" :aria-disabled="!file || !licence || busy ? 'true' : undefined" @click="sendUpload">Upload</button>
        </p>
      </div>

      <!-- ------------------------------------------------------------- Already added -->
      <div v-else class="fp-pane">
        <template v-if="!stored.length">
          <p class="muted">
            {{ georgianOnly ? 'No font on this machine covers the Georgian alphabet yet.' : 'No font has been added to this machine yet.' }}
          </p>
          <p class="btn-row">
            <button v-if="fonts.googleAvailable" type="button" class="btn" @click="tab = 'google'">Browse Google Fonts</button>
            <button type="button" class="btn" @click="tab = 'upload'">Upload a file</button>
          </p>
        </template>
        <ul v-else class="fp-rows">
          <li v-for="f in stored" :key="f.id" class="fp-stored">
            <div class="fp-stored-main">
              <span class="fp-row-name">{{ f.displayName || f.family }}</span>
              <span class="fp-row-meta">
                {{ f.source === 'google' ? 'Google' : 'Uploaded' }} · {{ kb((f.faces || []).reduce((n, x) => n + (x.kind === 'web' ? x.bytes : 0), 0)) }}
                <span v-if="f.coverage && f.coverage.georgian"> · Georgian</span>
                <span v-if="usedBy(f.id)"> · used by: {{ usedBy(f.id) }}</span>
                <span v-if="current === f.id"> · this role</span>
              </span>
            </div>
            <div v-if="renaming === f.id" class="fp-stored-acts">
              <label class="sr-only" :for="`font-name-${f.id}`">Display name of {{ f.displayName || f.family }}</label>
              <input :id="`font-name-${f.id}`" v-model="editName" class="inp" type="text" :maxlength="limits.displayName || 60" autocomplete="off">
              <button type="button" class="btn" @click="saveName(f.id)">Save</button>
              <button type="button" class="btn" @click="renaming = ''">Cancel</button>
            </div>
            <div v-else class="fp-stored-acts">
              <button type="button" class="btn" :aria-label="`Use ${f.displayName || f.family}`" @click="show(f)">Use</button>
              <button type="button" class="btn" :aria-label="`Rename ${f.displayName || f.family}`" @click="renaming = f.id; editName = f.displayName || f.family">Rename</button>
              <button type="button" class="btn btn-danger" :aria-label="confirming === f.id ? `Confirm deleting ${f.displayName || f.family}` : `Delete ${f.displayName || f.family}`" @click="drop(f.id)">
                {{ confirming === f.id ? 'Delete for good' : 'Delete' }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <p v-if="busy" class="st st-busy" role="status"><Icon name="busy" /> {{ busy }}</p>
    <p v-else class="sr-only" role="status" />
    <p v-if="error" class="st st-error" role="alert"><Icon name="error" /> {{ error }}</p>

    <!-- ------------------------------------------------------------- the chosen font -->
    <section v-if="picked" class="fp-chosen" aria-labelledby="font-chosen-title">
      <h3 id="font-chosen-title">{{ picked.displayName || picked.family }}</h3>
      <FontSpecimen :alias="specimen" :loading="specimenBusy" />
      <dl class="dlg-facts">
        <dt>Source</dt><dd>{{ picked.source === 'google' ? 'Google Fonts' : 'Uploaded file' }} · {{ picked.category }}</dd>
        <dt>On the site</dt>
        <dd>
          {{ (picked.faces || []).filter((f) => f.kind === 'web').length }}
          {{ (picked.faces || []).filter((f) => f.kind === 'web').length === 1 ? 'file' : 'files' }},
          {{ kb((picked.faces || []).reduce((n, x) => n + (x.kind === 'web' ? x.bytes : 0), 0)) }}
        </dd>
        <dt>Weights</dt><dd>{{ picked.variable ? `variable ${(picked.weights || []).at(0)}–${(picked.weights || []).at(-1)}` : (picked.weights || []).join(', ') }}</dd>
        <dt>Alphabets</dt>
        <dd>{{ [picked.coverage && picked.coverage.latin ? 'Latin' : null, picked.coverage && picked.coverage.georgian ? 'Georgian' : null].filter(Boolean).join(' and ') || '–' }}</dd>
        <dt>Licence</dt>
        <dd>
          <a v-if="picked.licence && picked.licence.kind === 'google'" :href="picked.licence.url" target="_blank" rel="noopener noreferrer">Open the licence page <Icon name="external" /></a>
          <span v-else>You attested that this font may be embedded on the site.</span>
        </dd>
      </dl>
      <p v-if="picked.satoriVariable" class="help">A variable font is drawn in the social cards at its default weight only.</p>
      <p v-if="georgianOnly && picked.coverage && picked.coverage.georgian !== true" class="st st-error" role="alert">
        <Icon name="error" /> This font has no Georgian alphabet, so it cannot serve the Georgian role.
      </p>
      <div>
        <label class="lbl" for="font-display-name">Name in the admin</label>
        <input id="font-display-name" v-model="editName" class="inp" type="text" :maxlength="limits.displayName || 60" autocomplete="off">
      </div>
      <div class="dlg-actions">
        <button type="button" class="btn" :aria-disabled="busy ? 'true' : undefined" @click="!busy && emit('close')">Cancel</button>
        <button type="button" class="btn btn-primary" :aria-disabled="georgianOnly && picked.coverage && picked.coverage.georgian !== true ? 'true' : undefined" @click="useIt">Use this font</button>
      </div>
    </section>
  </ModalDialog>
</template>
