<script setup>
// #/content/<tab> (admin-ops.md §6.5): a left tab list with an issue count per tab and the nav budget above
// it; the form of the tab, generated from buildSchema() (GET /registry). The eight section tabs follow
// settings.sectionOrder and say which ones are hidden (content-editing.md §5.1).
import { computed } from 'vue';
import Icon from '../components/Icon.vue';
import NavBudget from '../components/NavBudget.vue';
import SchemaNode from '../components/SchemaNode.vue';
import SectionOrder from '../components/SectionOrder.vue';
import LField from '../components/LField.vue';
import { CONTENT_TABS } from '../router.js';
import { draft } from '../state/draft.js';
import { registry } from '../state/registry.js';
import { tabOf, UI_NOTES } from '../fields.js';

const props = defineProps({ tab: { type: String, default: 'person' } });

const S = computed(() => registry.schema.shape);
const site = computed(() => draft.site);
const current = computed(() => CONTENT_TABS.find((t) => t.id === props.tab) || CONTENT_TABS[0]);
const SECTION_OF = { profile: 'profile', skills: 'skills', abilities: 'abilities', workstyle: 'workstyle', principles: 'principles', experience: 'experience', languages: 'languages', talk: 'contact' };
const TAB_OF = Object.fromEntries(Object.entries(SECTION_OF).map(([tab, key]) => [key, tab]));
const INTRO = {
  person: 'The name block and the hero at the top of the page.',
  contact: 'The contact list next to the name (the rail in Precision).',
  sections: 'The order of the sections on the page, and which ones are shown. Numbers follow the shown sections. Anchors never change.',
  skills: 'Each skill has a level: Core, Strong or Working.',
  experience: 'Leave “To” as present for a current position.',
  talk: 'The closing call to action.',
  ui: 'Small interface texts: buttons, labels and screen-reader names.',
};

const sectionKey = computed(() => SECTION_OF[current.value.id] || '');
const section = computed(() => (sectionKey.value ? site.value.sections[sectionKey.value] : null));
const shownKeys = computed(() => site.value.settings.sectionOrder.filter((k) => !site.value.sections[k].hidden));
const numberOf = (key) => String(shownKeys.value.indexOf(key) + 1).padStart(2, '0');

// the eight section tabs follow the page order; everything else keeps its place
const tabs = computed(() => {
  void draft.version;
  const ordered = site.value.settings.sectionOrder.map((k) => TAB_OF[k]);
  const rest = CONTENT_TABS.filter((t) => !SECTION_OF[t.id]);
  const at = rest.findIndex((t) => t.id === 'sections') + 1;
  const bySection = ordered.map((id) => CONTENT_TABS.find((t) => t.id === id));
  return [...rest.slice(0, at), ...bySection, ...rest.slice(at)];
});
const hiddenTab = (id) => !!SECTION_OF[id] && !!site.value.sections[SECTION_OF[id]].hidden;

const intro = computed(() => {
  const key = sectionKey.value;
  if (!key) return INTRO[current.value.id];
  const extra = INTRO[current.value.id] ? ` ${INTRO[current.value.id]}` : '';
  return section.value.hidden ? `Hidden section.${extra}` : `Section ${numberOf(key)}.${extra}`;
});

// every issue counts for exactly one tab (the most specific root wins)
const counts = computed(() => {
  void draft.version;
  const out = Object.fromEntries(CONTENT_TABS.map((t) => [t.id, { e: 0, w: 0 }]));
  for (const i of draft.issues.errors) { const t = out[tabOf(i.path)]; if (t) t.e++; }
  for (const i of draft.issues.warnings) { const t = out[tabOf(i.path)]; if (t) t.w++; }
  return out;
});

// interface strings: one row per ui.* key (nested levels / levelHints flattened)
const uiRows = computed(() => {
  const rows = [];
  for (const [k, spec] of Object.entries(S.value.ui.shape)) {
    if (spec.t === 'lstr') rows.push({ model: site.value.ui, field: k, path: `$.ui.${k}`, spec, note: UI_NOTES[k] });
    else if (spec.t === 'obj') for (const [k2, s2] of Object.entries(spec.shape)) rows.push({ model: site.value.ui[k], field: k2, path: `$.ui.${k}.${k2}`, spec: s2, note: UI_NOTES[`${k}.${k2}`] });
  }
  return rows;
});
const personFields = ['givenName', 'familyName', 'monogram'];
</script>

<template>
  <div class="page-head">
    <h1>Content</h1>
  </div>
  <div class="content">
    <div class="content-side">
      <NavBudget />
      <nav aria-label="Content sections">
        <ul class="tabs">
          <li v-for="t in tabs" :key="t.id">
            <a :href="`#/content/${t.id}`" :aria-current="t.id === current.id ? 'page' : undefined">
              <span>{{ t.title }}<span v-if="hiddenTab(t.id)" class="muted"> · hidden</span></span>
              <span v-if="counts[t.id].e || counts[t.id].w" class="btn-row">
                <span v-if="counts[t.id].e" class="badge badge-error"><Icon name="error" />{{ counts[t.id].e }}<span class="sr-only"> {{ counts[t.id].e === 1 ? 'error' : 'errors' }}</span></span>
                <span v-if="counts[t.id].w" class="badge badge-warn"><Icon name="warn" />{{ counts[t.id].w }}<span class="sr-only"> {{ counts[t.id].w === 1 ? 'warning' : 'warnings' }}</span></span>
              </span>
            </a>
          </li>
        </ul>
      </nav>
    </div>

    <section class="content-form" :aria-labelledby="'tab-title'">
      <div class="form-head">
        <div class="form-head-row">
          <h2 id="tab-title">{{ current.title }}</h2>
          <button
            v-if="section" type="button" class="btn" data-act="toggle-section"
            @click="section.hidden = !section.hidden"
          >{{ section.hidden ? 'Show this section' : 'Hide this section' }}</button>
        </div>
        <p>{{ intro }}</p>
        <p v-if="section && section.hidden" class="st st-warn" role="status">
          <Icon name="warn" /> This section is hidden: it is not on the page. Its content is kept and still checked.
        </p>
      </div>

      <template v-if="current.id === 'person'">
        <SchemaNode v-for="k in personFields" :key="k" :model="site.person" :field="k" :path="`$.person.${k}`" :spec="S.person.shape[k]" />
        <SchemaNode :model="site" field="hero" path="$.hero" :spec="S.hero" label="Hero" />
      </template>

      <template v-else-if="current.id === 'contact'">
        <SchemaNode :model="site" field="contact" path="$.contact" :spec="S.contact" :heading="false" />
      </template>

      <template v-else-if="current.id === 'sections'">
        <SectionOrder />
      </template>

      <template v-else-if="current.id === 'ui'">
        <LField v-for="r in uiRows" :key="r.path" :model="r.model" :field="r.field" :path="r.path" :spec="r.spec" :label="r.note ? r.note[0] : r.field" :help="r.note ? r.note[1] : ''">
          <template v-if="r.note && r.note[2]" #badge>
            <span class="badge badge-muted" :title="r.note[2]">Required<span class="sr-only">: {{ r.note[2] }}</span></span>
          </template>
        </LField>
      </template>

      <template v-else>
        <SchemaNode :model="site.sections" :field="sectionKey" :path="`$.sections.${sectionKey}`" :spec="S.sections.shape[sectionKey]" :heading="false" />
      </template>
    </section>
  </div>
</template>
