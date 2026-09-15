<script setup>
// "Let's talk" references (admin-ops.md §6.5): the primary email (contact items with a mailto: href) and up to
// three buttons chosen and ordered from the contact items. Only existing ids are ever written (an empty or
// repeated reference would be a structural error and stop the autosave).
import { computed, nextTick, ref } from 'vue';
import Icon from './Icon.vue';
import IssueList from './IssueList.vue';
import { draft, issuesAt } from '../state/draft.js';
import { fieldId } from '../fields.js';

const props = defineProps({
  section: { type: Object, required: true }, // sections.contact
  path: { type: String, required: true }, // "$.sections.contact"
});

const MAX_BUTTONS = 3;
const items = computed(() => draft.site?.contact?.items || []);
const byId = computed(() => Object.fromEntries(items.value.map((i) => [i.id, i])));
const describe = (id) => {
  const it = byId.value[id];
  if (!it) return `missing item “${id}”`;
  return `${it.label?.en || it.id}${it.value ? ` · ${it.value}` : ''}`;
};
const mailItems = computed(() => items.value.filter((i) => String(i.href || '').startsWith('mailto:')));
const primaryOptions = computed(() => {
  const opts = mailItems.value.map((i) => ({ value: i.id, label: describe(i.id) }));
  if (props.section.primary && !opts.some((o) => o.value === props.section.primary)) opts.unshift({ value: props.section.primary, label: `${describe(props.section.primary)} (not an email item)` });
  return opts;
});
const available = computed(() => items.value.filter((i) => !props.section.buttons.includes(i.id)));
const pick = ref('');
const listId = computed(() => fieldId(`${props.path}.buttons`));
const root = ref(null);

function focusIn(key, act) {
  root.value?.querySelector(`[data-key="${CSS.escape(key)}"] [data-act="${act}"]`)?.focus();
}
async function move(i, d) {
  const b = props.section.buttons;
  const j = i + d;
  if (j < 0 || j >= b.length) return;
  const [x] = b.splice(i, 1);
  b.splice(j, 0, x);
  await nextTick();
  focusIn(x, d < 0 ? 'up' : 'down');
}
async function remove(i) {
  props.section.buttons.splice(i, 1);
  await nextTick();
  const next = props.section.buttons[i];
  if (next) focusIn(next, 'remove');
  else document.getElementById(listId.value + '-pick')?.focus();
}
function add() {
  const id = pick.value || available.value[0]?.id;
  if (!id || props.section.buttons.length >= MAX_BUTTONS || props.section.buttons.includes(id)) return;
  props.section.buttons.push(id);
  pick.value = '';
}
</script>

<template>
  <div class="fld">
    <label :for="fieldId(`${path}.primary`)" class="lbl">Primary email</label>
    <p :id="fieldId(`${path}.primary`) + '-help'" class="help">The big address and the main button use this contact item (mailto: items only).</p>
    <select :id="fieldId(`${path}.primary`)" class="inp" :value="section.primary" :aria-describedby="fieldId(`${path}.primary`) + '-help'" @change="section.primary = $event.target.value">
      <option v-for="o in primaryOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <IssueList :issues="issuesAt(`${path}.primary`)" />
  </div>
  <div ref="root" class="fld">
    <span class="lbl" :id="listId + '-label'">Buttons</span>
    <p class="help">Up to three more buttons, chosen and ordered from the contact items. A link shows its label; an email or phone shows its value.</p>
    <div :id="listId" class="list" tabindex="-1" role="group" :aria-labelledby="listId + '-label'">
      <div v-for="(id, i) in section.buttons" :key="id" class="list-item" :data-key="id">
        <div class="list-item-head">
          <span class="list-item-title">{{ i + 1 }} · {{ describe(id) }}</span>
          <div class="list-actions">
            <button type="button" class="btn btn-quiet" data-act="up" :aria-disabled="i === 0 ? 'true' : undefined" :aria-label="`Move button ‘${describe(id)}’ up`" title="Move up" @click="move(i, -1)"><Icon name="up" /></button>
            <button type="button" class="btn btn-quiet" data-act="down" :aria-disabled="i === section.buttons.length - 1 ? 'true' : undefined" :aria-label="`Move button ‘${describe(id)}’ down`" title="Move down" @click="move(i, 1)"><Icon name="down" /></button>
            <button type="button" class="btn btn-quiet btn-danger" data-act="remove" :aria-label="`Remove button ‘${describe(id)}’`" title="Remove" @click="remove(i)"><Icon name="remove" /></button>
          </div>
        </div>
        <IssueList :issues="issuesAt(`${path}.buttons[${i}]`)" />
      </div>
      <div class="list-add">
        <label :for="listId + '-pick'" class="sr-only">Contact item for a new button</label>
        <select :id="listId + '-pick'" v-model="pick" class="inp" :disabled="!available.length || section.buttons.length >= MAX_BUTTONS">
          <option value="">Choose a contact item…</option>
          <option v-for="it in available" :key="it.id" :value="it.id">{{ describe(it.id) }}</option>
        </select>
        <button type="button" class="btn" :aria-disabled="section.buttons.length >= MAX_BUTTONS || !available.length ? 'true' : undefined" :aria-describedby="listId + '-max'" @click="add"><Icon name="plus" /> Add button</button>
        <span :id="listId + '-max'" class="list-bound">{{ section.buttons.length }} of at most {{ MAX_BUTTONS }} buttons.</span>
      </div>
    </div>
    <IssueList :issues="issuesAt(`${path}.buttons`)" />
  </div>
</template>
