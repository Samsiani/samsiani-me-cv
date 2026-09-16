<script setup>
// Add / remove (10 s undo) / move up / move down for any list (admin-ops.md §6.5). Items hold both
// languages, so every action is one array operation. Focus: after a move, the same button on the moved
// item; after remove, the next item's first input (or Add); after add, the new item's first input.
// Buttons at a bound stay focusable (aria-disabled) and name the bound in their description.
import { computed, nextTick, ref } from 'vue';
import Icon from './Icon.vue';
import IssueList from './IssueList.vue';
import { draft, issuesAt } from '../state/draft.js';
import { toast } from '../state/ui.js';
import { blank } from '../blank.js';
import { fieldId } from '../fields.js';
import { itemTitle, GEORGIAN } from '../text.js';

const props = defineProps({
  list: { type: Array, required: true },
  path: { type: String, required: true },
  spec: { type: Object, required: true }, // { t: 'arr', item, min, max }
  label: { type: String, required: true },
  noun: { type: String, default: 'item' },
  nouns: { type: String, default: '' },
  layout: { type: String, default: 'block' }, // block | row
  newItem: { type: Function, default: null },
  showNumber: { type: Boolean, default: true },
  minNote: { type: String, default: '' },   // why the minimum is what it is, and what to do instead
  lock: { type: Function, default: null },  // (item, i) -> reason this one item cannot be removed
  nameOf: { type: Function, default: null },// (item, i) -> the name the buttons use
  keyOf: { type: Function, default: null }, // (item, i) -> a stable row key (default: the item's id)
});

const root = ref(null);
const id = computed(() => fieldId(props.path));
const plural = computed(() => props.nouns || props.noun + 's');
const min = computed(() => props.spec.min ?? 0);
const max = computed(() => props.spec.max ?? Infinity);
const fixed = computed(() => min.value === max.value);
const atMin = computed(() => props.list.length <= min.value);
const atMax = computed(() => props.list.length >= max.value);
const keyOf = (item, i) => (props.keyOf ? props.keyOf(item, i) : item && typeof item === 'object' && typeof item.id === 'string' ? item.id : String(i));
const nameOf = (item, i) => (props.nameOf ? props.nameOf(item, i) : itemTitle(item, i));
const lockOf = (item, i) => (props.lock ? props.lock(item, i) : null);
const lockId = (item, i) => `${id.value}-lock-${keyOf(item, i)}`;
const removeTitle = (item, i) => lockOf(item, i) || (atMin.value ? props.minNote || 'Remove' : 'Remove');
const langOf = (s) => (GEORGIAN.test(s) ? 'ka' : undefined);

function rowOf(key) {
  return root.value?.querySelector(`:scope > [data-key="${CSS.escape(key)}"]`) || null;
}
function focusAct(key, act) {
  rowOf(key)?.querySelector(`[data-act="${act}"]`)?.focus();
}
function focusFirstInput(key) {
  const el = rowOf(key)?.querySelector('input:not([type="checkbox"]):not([type="radio"]), textarea, select, button:not([data-act])');
  if (el) el.focus(); else focusAdd();
}
function focusAdd() {
  root.value?.querySelector(':scope > .list-add [data-act="add"]')?.focus();
}

async function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= props.list.length) return;
  const item = props.list[i];
  props.list.splice(i, 1);
  props.list.splice(j, 0, item);
  await nextTick();
  focusAct(keyOf(item, j), d < 0 ? 'up' : 'down');
}

async function remove(i) {
  if (atMin.value || lockOf(props.list[i], i)) return;
  const item = props.list[i];
  const label = nameOf(item, i);
  const site = draft.site;
  const list = props.list;
  list.splice(i, 1);
  await nextTick();
  if (i < list.length) focusFirstInput(keyOf(list[i], i)); else focusAdd();
  toast(`Removed ‘${label}’.`, {
    timeout: 10_000,
    action: {
      label: 'Undo',
      run: async () => {
        if (draft.site !== site || list.length >= max.value) return;
        const at = Math.min(i, list.length);
        list.splice(at, 0, item);
        await nextTick();
        focusFirstInput(keyOf(item, at));
      },
    },
  });
}

async function add() {
  if (atMax.value) return;
  const item = props.newItem ? props.newItem(props.list) : blank(props.spec.item, props.list);
  props.list.push(item);
  await nextTick();
  focusFirstInput(keyOf(item, props.list.length - 1));
}
</script>

<template>
  <div ref="root" :id="id" class="list" tabindex="-1" role="group" :aria-label="label">
    <div
      v-for="(item, i) in list"
      :key="keyOf(item, i)"
      class="list-item"
      :class="{ 'skill-row': layout === 'row', 'list-item-custom': layout === 'custom' }"
      :data-key="keyOf(item, i)"
      role="group"
      :aria-label="`${noun} ${i + 1}`"
    >
      <template v-if="layout === 'block'">
        <div class="list-item-head">
          <span class="list-item-title">
            <span v-if="showNumber">{{ noun.charAt(0).toUpperCase() + noun.slice(1) }} {{ i + 1 }} · </span><span :lang="langOf(nameOf(item, i))">{{ nameOf(item, i) }}</span>
          </span>
          <div class="list-actions">
            <button type="button" class="btn btn-quiet" data-act="up" :aria-disabled="i === 0 ? 'true' : undefined" :aria-label="`Move ‘${nameOf(item, i)}’ up`" :title="i === 0 ? 'Already first' : 'Move up'" @click="move(i, -1)"><Icon name="up" /></button>
            <button type="button" class="btn btn-quiet" data-act="down" :aria-disabled="i === list.length - 1 ? 'true' : undefined" :aria-label="`Move ‘${nameOf(item, i)}’ down`" :title="i === list.length - 1 ? 'Already last' : 'Move down'" @click="move(i, 1)"><Icon name="down" /></button>
            <button v-if="!fixed" type="button" class="btn btn-quiet btn-danger" data-act="remove" :aria-disabled="atMin || lockOf(item, i) ? 'true' : undefined" :aria-describedby="lockOf(item, i) ? lockId(item, i) : atMin ? id + '-min' : undefined" :aria-label="`Remove ‘${nameOf(item, i)}’`" :title="removeTitle(item, i)" @click="remove(i)"><Icon name="remove" /><span v-if="lockOf(item, i)" :id="lockId(item, i)" class="sr-only">{{ lockOf(item, i) }}</span></button>
          </div>
        </div>
        <slot :item="item" :index="i" :path="`${path}[${i}]`" />
      </template>
      <template v-else-if="layout === 'custom'">
        <slot
          :item="item"
          :index="i"
          :path="`${path}[${i}]`"
          :actions="{ up: () => move(i, -1), down: () => move(i, 1), remove: () => remove(i), first: i === 0, last: i === list.length - 1, atMin, fixed, name: nameOf(item, i), minId: id + '-min', lock: lockOf(item, i), lockId: lockId(item, i) }"
        />
      </template>
      <template v-else>
        <slot :item="item" :index="i" :path="`${path}[${i}]`" />
        <div class="list-actions">
          <button type="button" class="btn btn-quiet" data-act="up" :aria-disabled="i === 0 ? 'true' : undefined" :aria-label="`Move ‘${nameOf(item, i)}’ up`" :title="i === 0 ? 'Already first' : 'Move up'" @click="move(i, -1)"><Icon name="up" /></button>
          <button type="button" class="btn btn-quiet" data-act="down" :aria-disabled="i === list.length - 1 ? 'true' : undefined" :aria-label="`Move ‘${nameOf(item, i)}’ down`" :title="i === list.length - 1 ? 'Already last' : 'Move down'" @click="move(i, 1)"><Icon name="down" /></button>
          <button v-if="!fixed" type="button" class="btn btn-quiet btn-danger" data-act="remove" :aria-disabled="atMin || lockOf(item, i) ? 'true' : undefined" :aria-describedby="lockOf(item, i) ? lockId(item, i) : atMin ? id + '-min' : undefined" :aria-label="`Remove ‘${nameOf(item, i)}’`" :title="removeTitle(item, i)" @click="remove(i)"><Icon name="remove" /><span v-if="lockOf(item, i)" :id="lockId(item, i)" class="sr-only">{{ lockOf(item, i) }}</span></button>
        </div>
      </template>
    </div>
    <div class="list-add">
      <template v-if="!fixed">
        <button type="button" class="btn" data-act="add" :aria-disabled="atMax ? 'true' : undefined" :aria-describedby="id + '-max'" @click="add"><Icon name="plus" /> Add {{ noun }}</button>
        <span :id="id + '-max'" class="list-bound">{{ list.length }} of at most {{ max }} {{ plural }}.</span>
        <span :id="id + '-min'" class="sr-only">At least {{ min }} {{ min === 1 ? noun : plural }} must stay.<template v-if="minNote"> {{ minNote }}</template></span>
      </template>
      <span v-else class="list-bound">Exactly {{ min }} {{ plural }}.</span>
    </div>
    <IssueList :issues="issuesAt(path)" />
  </div>
</template>
