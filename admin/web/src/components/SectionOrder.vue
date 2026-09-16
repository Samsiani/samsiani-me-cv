<script setup>
// #/content/sections (content-editing.md §5.1): the order of the sections on the page and which ones are
// shown. Moving uses ListEditor, so the keyboard behaviour and the focus rules are the ones the other
// lists already have; the list is fixed at eight, so it has no Add and no Remove.
import { computed } from 'vue';
import Icon from './Icon.vue';
import ListEditor from './ListEditor.vue';
import IssueList from './IssueList.vue';
import { SECTIONS } from '@src/shared/localize.mjs';
import { draft, issuesAt } from '../state/draft.js';
import { registry } from '../state/registry.js';

// which content tab edits each section
const TAB_OF = { profile: 'profile', skills: 'skills', abilities: 'abilities', workstyle: 'workstyle', principles: 'principles', experience: 'experience', languages: 'languages', contact: 'talk' };

const site = computed(() => draft.site);
const order = computed(() => site.value.settings.sectionOrder);
const spec = computed(() => registry.schema?.shape?.settings?.shape?.sectionOrder || { t: 'arr', min: SECTIONS.length, max: SECTIONS.length });
const sec = (key) => site.value.sections[key];
const titleEn = (key) => sec(key).title.en || key;
const titleKa = (key) => sec(key).title.ka || '';
const shown = computed(() => order.value.filter((k) => !sec(k).hidden));
const numberOf = (key) => (sec(key).hidden ? '—' : String(shown.value.indexOf(key) + 1).padStart(2, '0'));
const onlyOneShown = computed(() => shown.value.length <= 1);

/** Hide or show a section; the last shown one stays. Focus stays on the button: its label flips. */
function toggle(key) {
  if (!sec(key).hidden && onlyOneShown.value) return;
  sec(key).hidden = !sec(key).hidden;
}
</script>

<template>
  <div class="grp">
    <ListEditor
      :list="order" path="$.settings.sectionOrder" :spec="spec" label="Section order" noun="section"
      layout="custom" :key-of="(k) => k" :name-of="(k) => titleEn(k)"
    >
      <template #default="{ item: key, actions }">
        <div class="list-item-head sec-row">
          <span class="list-item-title">
            <span class="sec-num" aria-hidden="true">{{ numberOf(key) }}</span>
            {{ titleEn(key) }}
            <span v-if="titleKa(key)" class="muted" lang="ka">{{ titleKa(key) }}</span>
            <span v-if="sec(key).hidden" class="badge badge-muted">Hidden</span>
          </span>
          <div class="list-actions">
            <button
              type="button" class="btn btn-quiet" data-act="up" :aria-disabled="actions.first ? 'true' : undefined"
              :aria-label="`Move ‘${titleEn(key)}’ up`" :title="actions.first ? 'Already first' : 'Move up'" @click="actions.up"
            ><Icon name="up" /></button>
            <button
              type="button" class="btn btn-quiet" data-act="down" :aria-disabled="actions.last ? 'true' : undefined"
              :aria-label="`Move ‘${titleEn(key)}’ down`" :title="actions.last ? 'Already last' : 'Move down'" @click="actions.down"
            ><Icon name="down" /></button>
            <button
              type="button" class="btn" data-act="toggle"
              :aria-disabled="!sec(key).hidden && onlyOneShown ? 'true' : undefined"
              :aria-describedby="!sec(key).hidden && onlyOneShown ? 'sections-last' : undefined"
              @click="toggle(key)"
            >{{ sec(key).hidden ? `Show ‘${titleEn(key)}’` : `Hide ‘${titleEn(key)}’` }}</button>
            <a class="btn btn-quiet" :href="`#/content/${TAB_OF[key]}`">Edit</a>
          </div>
        </div>
      </template>
    </ListEditor>
    <span id="sections-last" class="sr-only">At least one section must stay shown.</span>
    <IssueList :issues="issuesAt('$.settings.sectionOrder')" />
    <IssueList :issues="issuesAt('$.sections')" />
  </div>
</template>
