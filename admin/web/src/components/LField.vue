<script setup>
// One localized field {en, ka} (admin-ops.md §6.5): EN and KA inputs side by side from 1100 px (stacked
// below, with EN/KA tags), a counter each, "Copy EN → KA", trim on blur, no line breaks, issues under each
// input, and an Add/Remove toggle between null and a full pair for optional fields (nav, lead, detail).
import { computed, nextTick } from 'vue';
import Counter from './Counter.vue';
import IssueList from './IssueList.vue';
import { issuesAt } from '../state/draft.js';
import { maxFor } from '../state/registry.js';
import { fieldId, genericPath, labelFor, helpFor } from '../fields.js';
import { cleanInput, vAutogrow } from '../text.js';

const props = defineProps({
  model: { type: Object, required: true },
  field: { type: String, required: true },
  path: { type: String, required: true }, // "$.hero.tagline"
  spec: { type: Object, required: true }, // { t: 'lstr', max, optional?, text? }
  label: { type: String, default: '' },
  help: { type: String, default: undefined },
  multiline: { type: Boolean, default: undefined },
  offText: { type: String, default: '' },
  compact: { type: Boolean, default: false }, // no hairline/padding (inside skill rows)
});

const value = computed(() => props.model[props.field]);
const name = computed(() => props.label || labelFor(props.path));
const helpText = computed(() => (props.help !== undefined ? props.help : helpFor(props.path)));
const max = computed(() => maxFor(genericPath(props.path)) ?? props.spec.max ?? 0);
const isMulti = computed(() => props.multiline ?? (!!props.spec.text || max.value > 100));
const offLabel = computed(() => props.offText || (props.field === 'nav' ? 'Not set: the navigation uses the title.' : props.field === 'lead' ? 'Not set: no line under the title.' : 'Not set.'));
const idOf = (lang) => fieldId(`${props.path}.${lang}`);
const baseId = computed(() => fieldId(props.path));
const errorIn = (lang) => issuesAt(`${props.path}.${lang}`).some((i) => i.level === 'error');
const describedBy = (lang) => [helpText.value ? baseId.value + '-help' : '', max.value ? idOf(lang) + '-n' : '', issuesAt(`${props.path}.${lang}`).length ? idOf(lang) + '-i' : ''].filter(Boolean).join(' ') || undefined;

function onInput(lang, e) {
  const v = cleanInput(e.target);
  if (props.model[props.field] && props.model[props.field][lang] !== v) props.model[props.field][lang] = v;
}
function onBlur(lang) {
  const pair = props.model[props.field];
  if (!pair) return;
  const t = String(pair[lang] ?? '').trim();
  if (t !== pair[lang]) pair[lang] = t;
}
function copyEnToKa() {
  const pair = props.model[props.field];
  if (pair) pair.ka = pair.en;
}
async function addPair() {
  props.model[props.field] = { en: '', ka: '' };
  await nextTick();
  document.getElementById(idOf('en'))?.focus();
}
async function removePair() {
  props.model[props.field] = null;
  await nextTick();
  document.getElementById(baseId.value + '-add')?.focus();
}
</script>

<template>
  <div class="fld" :class="{ 'fld-compact': compact }">
    <div class="fld-head">
      <span class="lbl" :id="baseId + '-label'">{{ name }}</span>
      <div v-if="value" class="btn-row">
        <button type="button" class="btn btn-quiet" :aria-label="`Copy EN → KA (${name})`" title="Fill the Georgian input with the English value" @click="copyEnToKa">Copy EN → KA</button>
        <button v-if="spec.optional" type="button" class="btn btn-quiet" :aria-label="`Remove ${name}`" @click="removePair">Remove</button>
      </div>
    </div>
    <p v-if="helpText" :id="baseId + '-help'" class="help">{{ helpText }}</p>
    <div v-if="value" class="fld-pair">
      <div v-for="lang in ['en', 'ka']" :key="lang" class="fld-lang">
        <div class="fld-lang-head">
          <label :for="idOf(lang)" class="fld-tag"><span class="sr-only">{{ name }} (</span>{{ lang === 'en' ? 'EN' : 'KA' }}<span class="sr-only">)</span></label>
          <Counter :value="value[lang] ?? ''" :max="max" :id="idOf(lang) + '-n'" />
        </div>
        <textarea
          v-if="isMulti"
          :id="idOf(lang)"
          v-autogrow
          data-autogrow
          class="inp"
          rows="2"
          :lang="lang"
          :value="value[lang] ?? ''"
          :aria-invalid="errorIn(lang) ? 'true' : undefined"
          :aria-describedby="describedBy(lang)"
          @input="onInput(lang, $event)"
          @keydown.enter.prevent
          @blur="onBlur(lang)"
        />
        <input
          v-else
          :id="idOf(lang)"
          class="inp"
          type="text"
          :lang="lang"
          :value="value[lang] ?? ''"
          :aria-invalid="errorIn(lang) ? 'true' : undefined"
          :aria-describedby="describedBy(lang)"
          autocomplete="off"
          @input="onInput(lang, $event)"
          @blur="onBlur(lang)"
        >
        <IssueList :issues="issuesAt(`${path}.${lang}`)" :id="idOf(lang) + '-i'" />
      </div>
    </div>
    <div v-else class="fld-opt-off">
      <span>{{ offLabel }}</span>
      <button :id="baseId + '-add'" type="button" class="btn" :aria-label="`Add ${name}`" @click="addPair">Add</button>
    </div>
    <IssueList :issues="issuesAt(path)" />
  </div>
</template>
