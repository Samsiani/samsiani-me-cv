<script setup>
// One skill group (admin-ops.md §6.5): a <details> (open by default) with title and lead, then the item rows
// name EN | detail EN | name KA | detail KA | level | actions (stacked below 1100 px).
import { computed, nextTick } from 'vue';
import LField from './LField.vue';
import LangInput from './LangInput.vue';
import ListEditor from './ListEditor.vue';
import Icon from './Icon.vue';
import IssueList from './IssueList.vue';
import { issuesAt } from '../state/draft.js';
import { fieldId } from '../fields.js';
import { GEORGIAN } from '../text.js';

const props = defineProps({
  group: { type: Object, required: true },
  path: { type: String, required: true },
  spec: { type: Object, required: true }, // the group object spec
  index: { type: Number, required: true },
  actions: { type: Object, required: true },
});

const LEVELS = [
  { value: 'core', label: 'Core (daily, production)' },
  { value: 'strong', label: 'Strong (regular)' },
  { value: 'working', label: 'Working (as needed)' },
];
const title = computed(() => props.group.title?.en || props.group.title?.ka || 'New group');
const itemSpec = computed(() => props.spec.shape.items);

async function addDetail(item, ip) {
  item.detail = { en: '', ka: '' };
  await nextTick();
  document.getElementById(fieldId(`${ip}.detail.en`))?.focus();
}
async function removeDetail(item, ip) {
  item.detail = null;
  await nextTick();
  document.getElementById(fieldId(`${ip}.detail`) + '-add')?.focus();
}
</script>

<template>
  <details open class="skill-group">
    <summary>
      <span :lang="GEORGIAN.test(title) ? 'ka' : undefined">{{ title }}</span>
      <span class="muted small">{{ group.items.length }} {{ group.items.length === 1 ? 'skill' : 'skills' }}</span>
    </summary>
    <div class="skill-group-body">
      <div class="list-item-head">
        <span class="list-item-title">Group {{ index + 1 }}</span>
        <div class="list-actions">
          <button type="button" class="btn btn-quiet" data-act="up" :aria-disabled="actions.first ? 'true' : undefined" :aria-label="`Move group ‘${actions.name}’ up`" title="Move group up" @click="actions.up"><Icon name="up" /></button>
          <button type="button" class="btn btn-quiet" data-act="down" :aria-disabled="actions.last ? 'true' : undefined" :aria-label="`Move group ‘${actions.name}’ down`" title="Move group down" @click="actions.down"><Icon name="down" /></button>
          <button type="button" class="btn btn-quiet btn-danger" data-act="remove" :aria-disabled="actions.atMin ? 'true' : undefined" :aria-describedby="actions.atMin ? actions.minId : undefined" :aria-label="`Remove group ‘${actions.name}’`" title="Remove group" @click="actions.remove"><Icon name="remove" /></button>
        </div>
      </div>
      <LField :model="group" field="title" :path="`${path}.title`" :spec="spec.shape.title" />
      <LField :model="group" field="lead" :path="`${path}.lead`" :spec="spec.shape.lead" />
      <div class="skill-cols" aria-hidden="true">
        <span>Name · EN</span><span>Detail · EN</span><span>Name · KA</span><span>Detail · KA</span><span>Level</span><span />
      </div>
      <ListEditor :list="group.items" :path="`${path}.items`" :spec="itemSpec" label="Skills" noun="skill" layout="row">
        <template #default="{ item, path: ip }">
          <LangInput :pair="item.name" lang="en" :path="`${ip}.name`" label="Name (EN)" />
          <LangInput v-if="item.detail" :pair="item.detail" lang="en" :path="`${ip}.detail`" label="Detail (EN)">
            <template #tools>
              <button type="button" class="btn btn-quiet" :aria-label="`Remove detail of ‘${item.name.en || item.name.ka || 'skill'}’`" title="Remove the detail in both languages" @click="removeDetail(item, ip)">Remove</button>
            </template>
          </LangInput>
          <div v-else class="cell">
            <span class="cell-head">Detail</span>
            <button :id="fieldId(`${ip}.detail`) + '-add'" type="button" class="btn" :aria-label="`Add detail to ‘${item.name.en || item.name.ka || 'skill'}’`" @click="addDetail(item, ip)"><Icon name="plus" /> Add detail</button>
          </div>
          <LangInput :pair="item.name" lang="ka" :path="`${ip}.name`" label="Name (KA)" />
          <LangInput v-if="item.detail" :pair="item.detail" lang="ka" :path="`${ip}.detail`" label="Detail (KA)" />
          <div v-else class="cell" aria-hidden="true" />
          <div class="cell">
            <label :for="fieldId(`${ip}.level`)" class="cell-head">Level</label>
            <select :id="fieldId(`${ip}.level`)" class="inp" :value="item.level" @change="item.level = $event.target.value">
              <option v-for="l in LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option>
            </select>
            <IssueList :issues="issuesAt(`${ip}.level`)" />
          </div>
        </template>
      </ListEditor>
    </div>
  </details>
</template>
