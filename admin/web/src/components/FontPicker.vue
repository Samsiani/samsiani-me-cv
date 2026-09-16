<script setup>
// The Fonts fieldset on the Dashboard (fonts plan §6): one row per role of the selected layout, each with a
// specimen in both languages, where the face comes from, and Change… / Reset. Under the rows, the server's
// report — the bytes the Georgian page carries and the width the header nav needs — with its warnings.
//
// Selecting writes settings.fonts[layout][role]; Reset writes null. The SPA never deletes a key, so a
// document that never had a font stays byte-identical to what it rendered before this feature.
import { computed, onMounted, ref, watch } from 'vue';
import FontDialog from './FontDialog.vue';
import FontSpecimen from './FontSpecimen.vue';
import Icon from './Icon.vue';
import IssueList from './IssueList.vue';
import { fieldId } from '../fields.js';
import { issuesAt } from '../state/draft.js';
import { layoutById, registry } from '../state/registry.js';
import {
  byId, defaultSpecimenFace, fonts, loadFonts, loadReport, releaseSpecimens, roleValue, scheduleReport,
  setRole, specimenFace,
} from '../state/fonts.js';

const props = defineProps({ settings: { type: Object, required: true } });

const ROLES = ['text', 'label', 'georgian'];
const layout = computed(() => props.settings.layout);
const layoutLabel = computed(() => layoutById(layout.value)?.label || layout.value);
const roles = computed(() => registry.fontRoles?.[layout.value] || null);
const dialog = ref({ open: false, role: 'text' });
const aliases = ref({}); // role -> the specimen alias in document.fonts, or '' while it loads

const chosen = (role) => byId(roleValue(layout.value, role));
const pathOf = (role) => `$.settings.fonts.${layout.value}.${role}`;
const sourceOf = (role) => {
  const record = chosen(role);
  if (record) return `${record.source === 'google' ? 'Google' : 'Uploaded'} · ${record.displayName || record.family}`;
  return `Layout default · ${roles.value?.[role]?.defaultFamily || ''}`;
};

/** Draw each row in the face it will ship: a stored record, or the layout's own committed file. */
async function drawRow(role) {
  const record = chosen(role);
  const want = record ? record.id : `default:${layout.value}`;
  aliases.value = { ...aliases.value, [role]: '' };
  try {
    const face = record ? specimenFace(record) : defaultSpecimenFace(layout.value, role);
    await face.load();
    if ((chosen(role)?.id ?? `default:${layout.value}`) === want) aliases.value = { ...aliases.value, [role]: face.alias };
  } catch { /* the row still names the family; only the drawing is missing */ }
}
const drawAll = () => { for (const role of ROLES) drawRow(role); };

function open(role) {
  dialog.value = { open: true, role };
}
function close() {
  dialog.value = { ...dialog.value, open: false };
  releaseSpecimens();
  aliases.value = {};
  drawAll();
}
function choose(id) {
  setRole(layout.value, dialog.value.role, id);
  close();
}
function reset(role) {
  if (!roleValue(layout.value, role)) return;
  setRole(layout.value, role, null);
  releaseSpecimens();
  aliases.value = {};
  drawAll();
}

// the report follows the layout and the chosen fonts, 600 ms after the last change (the preview's own timing)
watch(() => JSON.stringify([layout.value, props.settings.fonts ?? null]), () => { scheduleReport(); drawAll(); });

onMounted(async () => {
  await loadFonts().catch(() => {});
  drawAll();
  loadReport();
});

const report = computed(() => (fonts.report?.layout === layout.value ? fonts.report : null));
const navWord = (tier, lang) => (tier === 'never' ? `Sections menu (${lang})` : tier ? `inline nav from ${tier} px (${lang})` : null);
const reportLine = computed(() => {
  const r = report.value;
  if (!r) return '';
  const nav = [navWord(r.navFit?.en, 'EN'), navWord(r.navFit?.ka, 'KA')].filter(Boolean).join(', ');
  return `Fonts on /ka/: ${Math.round((r.bytes?.ka || 0) / 1024)} KB${nav ? ` · ${nav}` : ''}`;
});
const reportIssues = computed(() => {
  const r = report.value;
  if (!r) return [];
  return [
    ...(r.issues?.errors || []).map((e) => ({ ...e, level: 'error' })),
    ...(r.issues?.warnings || []).map((w) => ({ ...w, level: 'warning' })),
  ];
});
</script>

<template>
  <fieldset v-if="roles" class="fp" aria-describedby="fonts-help">
    <legend class="sec-title">Fonts</legend>
    <p id="fonts-help" class="help">For {{ layoutLabel }}. Google fonts are downloaded once and served from samsiani.me; visitors never reach Google.</p>
    <div class="fp-list">
      <div v-for="role in ROLES" :key="role" class="fp-item" :data-role="role">
        <div class="fp-head">
          <span class="fp-role">{{ roles[role].label }}</span>
          <span class="fp-source">{{ sourceOf(role) }}</span>
        </div>
        <p class="help">{{ roles[role].help }}</p>
        <FontSpecimen :alias="aliases[role] || ''" />
        <div class="btn-row">
          <button
            :id="fieldId(pathOf(role))" type="button" class="btn"
            :aria-label="`Change the ${roles[role].label.toLowerCase()} font of ${layoutLabel}`"
            @click="open(role)"
          >Change…</button>
          <button
            type="button" class="btn"
            :aria-label="`Reset the ${roles[role].label.toLowerCase()} font of ${layoutLabel}`"
            :aria-disabled="roleValue(layout, role) ? undefined : 'true'"
            @click="reset(role)"
          >Reset</button>
        </div>
        <IssueList :issues="issuesAt(pathOf(role))" />
      </div>
    </div>

    <p v-if="reportLine" class="fp-report" data-testid="fonts-report">{{ reportLine }}</p>
    <p v-else-if="fonts.reportError" class="st st-warn"><Icon name="warn" /> The font report could not be loaded: {{ fonts.reportError }}</p>
    <IssueList :issues="reportIssues" />

    <FontDialog
      :open="dialog.open" :layout="layout" :layout-label="layoutLabel" :role="dialog.role"
      :role-label="roles[dialog.role].label" :current="roleValue(layout, dialog.role)"
      @close="close" @choose="choose"
    />
  </fieldset>
</template>
