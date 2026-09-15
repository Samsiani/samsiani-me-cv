<script setup>
// One language of a localized pair, for table-like rows (skills: name EN | detail EN | name KA | detail KA).
import { computed } from 'vue';
import Counter from './Counter.vue';
import IssueList from './IssueList.vue';
import { issuesAt } from '../state/draft.js';
import { maxFor } from '../state/registry.js';
import { fieldId, genericPath } from '../fields.js';
import { cleanInput } from '../text.js';

const props = defineProps({
  pair: { type: Object, required: true },
  lang: { type: String, required: true },
  path: { type: String, required: true }, // the pair's path, e.g. "$.sections.skills.groups[0].items[2].name"
  label: { type: String, required: true }, // "Name (EN)"
});
const full = computed(() => `${props.path}.${props.lang}`);
const id = computed(() => fieldId(full.value));
const max = computed(() => maxFor(genericPath(props.path)) ?? 0);
const issues = computed(() => issuesAt(full.value));

function onInput(e) {
  const v = cleanInput(e.target);
  if (props.pair[props.lang] !== v) props.pair[props.lang] = v;
}
function onBlur() {
  const v = String(props.pair[props.lang] ?? '');
  if (v !== v.trim()) props.pair[props.lang] = v.trim();
}
</script>

<template>
  <div class="cell">
    <label :for="id" class="cell-head">{{ label }}</label>
    <input
      :id="id"
      class="inp"
      type="text"
      :lang="lang"
      :value="pair[lang] ?? ''"
      :aria-invalid="issues.some((i) => i.level === 'error') ? 'true' : undefined"
      :aria-describedby="[max ? id + '-n' : '', issues.length ? id + '-i' : ''].filter(Boolean).join(' ') || undefined"
      autocomplete="off"
      @input="onInput"
      @blur="onBlur"
    >
    <div class="cell-foot">
      <Counter :value="pair[lang] ?? ''" :max="max" :id="id + '-n'" />
      <slot name="tools" />
    </div>
    <IssueList :issues="issues" :id="id + '-i'" />
  </div>
</template>
