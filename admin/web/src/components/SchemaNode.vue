<script setup>
// The content form, generated from buildSchema() (admin-ops.md §6.5): localized strings → LField, plain
// values → SField, lists → ListEditor, objects → their fields in schema order. Ids are never shown or
// edited; skill groups and the two contact references have their own widgets.
import { computed } from 'vue';
import LField from './LField.vue';
import SField from './SField.vue';
import ListEditor from './ListEditor.vue';
import SkillGroup from './SkillGroup.vue';
import ContactRefs from './ContactRefs.vue';
import { draft } from '../state/draft.js';
import { genericPath, labelFor, minNoteFor } from '../fields.js';

defineOptions({ name: 'SchemaNode' });

const props = defineProps({
  model: { type: [Object, Array], required: true }, // the parent holding the value
  field: { type: [String, Number], required: true },
  path: { type: String, required: true }, // $.path of the value
  spec: { type: Object, required: true },
  label: { type: String, default: '' },
  heading: { type: Boolean, default: true }, // objects: show a group heading
});

const value = computed(() => props.model[props.field]);
const g = computed(() => genericPath(props.path));
const name = computed(() => props.label || labelFor(props.path));

const NOUNS = {
  'hero.facts': ['fact', 'facts'],
  'contact.items': ['contact item', 'contact items'],
  'person.sameAs': ['profile link', 'profile links'],
  'sections.profile.paragraphs': ['paragraph', 'paragraphs'],
  'sections.skills.groups': ['group', 'groups'],
  'sections.experience.items': ['position', 'positions'],
  'sections.languages.items': ['language', 'languages'],
};
const noun = computed(() => NOUNS[g.value] || ['item', 'items']);

const ENUMS = {
  level: { core: 'Core (daily, production)', strong: 'Strong (regular)', working: 'Working (as needed)' },
  icon: { mail: 'Mail', phone: 'Phone', github: 'GitHub', globe: 'Globe (web link)' },
};
const enumOptions = computed(() => {
  const key = String(props.field);
  return (props.spec.values || []).map((v) => ({ value: v, label: ENUMS[key]?.[v] ?? String(v) }));
});
const transform = computed(() => (['person.monogram', 'person.address.country'].includes(g.value) ? 'upper' : ''));
// `hidden` is never a checkbox in the form: it is the Hide/Show button of the section's own tab
const childEntries = computed(() => Object.entries(props.spec.shape || {}).filter(([k, s]) => k !== 'hidden' && s.t !== 'id' && s.t !== 'ref' && !(s.t === 'arr' && s.item?.t === 'ref')));
const minNote = computed(() => minNoteFor(props.path));
// the primary email cannot leave the contact list while it is the primary (decision D8)
const lock = computed(() => (g.value !== 'contact.items' ? null
  : (it) => (it.id === draft.site?.sections?.contact?.primary ? 'This item is the primary email (Let’s talk). Choose another primary first.' : null)));
const hasRefs = computed(() => Object.values(props.spec.shape || {}).some((s) => s.t === 'ref'));
</script>

<template>
  <LField v-if="spec.t === 'lstr'" :model="model" :field="String(field)" :path="path" :spec="spec" :label="label" />
  <SField v-else-if="spec.t === 'str'" :model="model" :field="field" :path="path" :spec="spec" :label="label" :transform="transform" />
  <SField v-else-if="spec.t === 'enum'" :model="model" :field="field" :path="path" :spec="spec" kind="select" :options="enumOptions" :label="label" />
  <SField v-else-if="spec.t === 'bool'" :model="model" :field="field" :path="path" :spec="spec" kind="checkbox" :label="label" />
  <SField v-else-if="spec.t === 'int'" :model="model" :field="field" :path="path" :spec="spec" kind="year" :label="label" />
  <template v-else-if="spec.t === 'arr' && value">
    <div class="grp">
      <h3 class="grp-title">{{ name }}</h3>
      <ListEditor
        v-if="g === 'sections.skills.groups'"
        :list="value" :path="path" :spec="spec" :label="name" noun="group" layout="custom" :min-note="minNote"
      >
        <template #default="{ item, index, path: ip, actions }">
          <SkillGroup :group="item" :path="ip" :spec="spec.item" :index="index" :actions="actions" />
        </template>
      </ListEditor>
      <ListEditor
        v-else
        :list="value" :path="path" :spec="spec" :label="name" :noun="noun[0]" :nouns="noun[1]" :min-note="minNote" :lock="lock"
      >
        <template #default="{ item, index, path: ip }">
          <SchemaNode v-if="spec.item.t === 'obj'" :model="value" :field="index" :path="ip" :spec="spec.item" :heading="false" />
          <SchemaNode v-else :model="value" :field="index" :path="ip" :spec="spec.item" :label="labelFor(ip)" />
        </template>
      </ListEditor>
    </div>
  </template>
  <template v-else-if="spec.t === 'obj' && value">
    <fieldset v-if="heading" class="grp">
      <legend class="grp-title">{{ name }}</legend>
      <SchemaNode v-for="[k, s] in childEntries" :key="k" :model="value" :field="k" :path="`${path}.${k}`" :spec="s" />
      <ContactRefs v-if="hasRefs" :section="value" :path="path" />
    </fieldset>
    <template v-else>
      <SchemaNode v-for="[k, s] in childEntries" :key="k" :model="value" :field="k" :path="`${path}.${k}`" :spec="s" />
      <ContactRefs v-if="hasRefs" :section="value" :path="path" />
    </template>
  </template>
</template>
