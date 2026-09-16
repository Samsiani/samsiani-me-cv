<script setup>
// One non-localized value (admin-ops.md §6.5): href, value, monogram, years, level, icon, flags.
// Values that would be structural errors (a year that is not an integer, an unknown enum) are never
// written into the draft: the input shows its own message until the value is valid.
import { computed, ref, watch } from 'vue';
import Counter from './Counter.vue';
import IssueList from './IssueList.vue';
import Icon from './Icon.vue';
import { issuesAt, todayTbilisi } from '../state/draft.js';
import { maxFor } from '../state/registry.js';
import { fieldId, genericPath, labelFor, helpFor, keepReason } from '../fields.js';
import { cleanInput } from '../text.js';

const props = defineProps({
  model: { type: [Object, Array], required: true },
  field: { type: [String, Number], required: true },
  path: { type: String, required: true },
  spec: { type: Object, default: () => ({}) },
  kind: { type: String, default: 'text' }, // text | select | checkbox | year
  options: { type: Array, default: () => [] }, // [{ value, label }]
  label: { type: String, default: '' },
  help: { type: String, default: undefined },
  transform: { type: String, default: '' }, // 'upper'
  inputmode: { type: String, default: undefined },
  compact: { type: Boolean, default: false },
});

const id = computed(() => fieldId(props.path));
const name = computed(() => props.label || labelFor(props.path));
const helpText = computed(() => (props.help !== undefined ? props.help : helpFor(props.path)));
const max = computed(() => (props.kind === 'text' ? maxFor(genericPath(props.path)) ?? props.spec.max ?? 0 : 0));
const issues = computed(() => issuesAt(props.path));
const keep = computed(() => (props.spec.nullable ? '' : keepReason(props.path)));
const invalid = computed(() => issues.value.some((i) => i.level === 'error') || !!localError.value);
const describedBy = computed(() => [helpText.value ? id.value + '-help' : '', max.value ? id.value + '-n' : '', issues.value.length || localError.value ? id.value + '-i' : ''].filter(Boolean).join(' ') || undefined);

// text
function onText(e) {
  let v = cleanInput(e.target);
  if (props.transform === 'upper') {
    const up = v.toUpperCase();
    if (up !== v) { const pos = e.target.selectionStart; e.target.value = up; e.target.setSelectionRange(pos, pos); v = up; }
  }
  const out = v === '' && props.spec.nullable ? null : v;
  if (props.model[props.field] !== out) props.model[props.field] = out;
}
function onTextBlur() {
  const v = props.model[props.field];
  if (typeof v === 'string' && v !== v.trim()) props.model[props.field] = v.trim() === '' && props.spec.nullable ? null : v.trim();
}

// year (1970–2100); a nullable year gets a "present" checkbox that stores null
const yearText = ref(props.model[props.field] == null ? '' : String(props.model[props.field]));
const localError = ref('');
const lastYear = ref(props.model[props.field] ?? null);
watch(() => props.model[props.field], (v) => {
  if (props.kind !== 'year') return;
  if (v != null) { lastYear.value = v; if (String(v) !== yearText.value) { yearText.value = String(v); localError.value = ''; } }
});
function onYear(e) {
  yearText.value = e.target.value.trim();
  const n = Number(yearText.value);
  if (/^\d{4}$/.test(yearText.value) && n >= (props.spec.min ?? 1970) && n <= (props.spec.max ?? 2100)) {
    localError.value = '';
    if (props.model[props.field] !== n) props.model[props.field] = n;
  } else {
    localError.value = `Enter a year between ${props.spec.min ?? 1970} and ${props.spec.max ?? 2100}.`;
  }
}
const present = computed(() => props.model[props.field] === null);
function onPresent(e) {
  if (e.target.checked) { props.model[props.field] = null; localError.value = ''; }
  else {
    const y = lastYear.value ?? Number(todayTbilisi().slice(0, 4));
    props.model[props.field] = y;
    yearText.value = String(y);
  }
}
</script>

<template>
  <div class="fld" :class="{ 'fld-compact': compact }">
    <template v-if="kind === 'checkbox'">
      <label class="check"><input :id="id" type="checkbox" :checked="!!model[field]" :aria-describedby="describedBy" @change="model[field] = $event.target.checked"> {{ name }}</label>
    </template>
    <template v-else>
      <div class="fld-head">
        <label :for="id" class="lbl">{{ name }}</label>
        <Counter v-if="kind === 'text'" :value="model[field] ?? ''" :max="max" :id="id + '-n'" />
      </div>
      <p v-if="helpText" :id="id + '-help'" class="help">{{ helpText }}</p>
      <p v-if="keep" class="help">Cannot be removed: {{ keep }}</p>
      <input
        v-if="kind === 'text'"
        :id="id"
        class="inp"
        type="text"
        :value="model[field] ?? ''"
        :inputmode="inputmode"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="describedBy"
        autocomplete="off"
        spellcheck="false"
        @input="onText"
        @blur="onTextBlur"
      >
      <select v-else-if="kind === 'select'" :id="id" class="inp" :value="model[field]" :aria-invalid="invalid ? 'true' : undefined" :aria-describedby="describedBy" @change="model[field] = $event.target.value">
        <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <div v-else-if="kind === 'year'" class="form-row">
        <input
          v-if="!present"
          :id="id"
          class="inp inp-num"
          type="text"
          inputmode="numeric"
          maxlength="4"
          :value="yearText"
          :aria-invalid="invalid ? 'true' : undefined"
          :aria-describedby="describedBy"
          autocomplete="off"
          @input="onYear"
        >
        <label v-if="spec.nullable" class="check"><input :id="present ? id : id + '-present'" type="checkbox" :checked="present" @change="onPresent"> present</label>
      </div>
      <div :id="id + '-i'">
        <ul v-if="localError" class="issues"><li class="issue-error"><Icon name="error" /><span><span class="sr-only">Error: </span>{{ localError }}</span></li></ul>
        <IssueList :issues="issues" />
      </div>
    </template>
    <IssueList v-if="kind === 'checkbox'" :issues="issues" :id="id + '-i'" />
  </div>
</template>
