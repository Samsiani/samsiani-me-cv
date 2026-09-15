<script setup>
// #/content/<tab> (admin-ops.md §6.5): a left tab list with an issue count per tab and the nav budget above
// it; the form of the tab, generated from buildSchema() (GET /registry).
import { computed } from 'vue';
import Icon from '../components/Icon.vue';
import NavBudget from '../components/NavBudget.vue';
import SchemaNode from '../components/SchemaNode.vue';
import LField from '../components/LField.vue';
import { CONTENT_TABS } from '../router.js';
import { draft, issuesUnder } from '../state/draft.js';
import { registry } from '../state/registry.js';
import { TAB_ROOTS, UI_NOTES } from '../fields.js';

const props = defineProps({ tab: { type: String, default: 'person' } });

const S = computed(() => registry.schema.shape);
const site = computed(() => draft.site);
const current = computed(() => CONTENT_TABS.find((t) => t.id === props.tab) || CONTENT_TABS[0]);
const SECTION_OF = { profile: 'profile', skills: 'skills', abilities: 'abilities', workstyle: 'workstyle', principles: 'principles', experience: 'experience', languages: 'languages', talk: 'contact' };
const INTRO = {
  person: 'The name block and the hero at the top of the page.',
  contact: 'The contact list next to the name (the rail in Precision).',
  profile: 'Section 01.',
  skills: 'Section 02. Each skill has a level: Core, Strong or Working.',
  abilities: 'Section 03.',
  workstyle: 'Section 04.',
  principles: 'Section 05.',
  experience: 'Section 06. Leave “To” as present for a current position.',
  languages: 'Section 07.',
  talk: 'Section 08, the closing call to action.',
  ui: 'Small interface texts: buttons, labels and screen-reader names.',
};

const counts = computed(() => {
  void draft.version;
  return Object.fromEntries(CONTENT_TABS.map((t) => {
    const i = issuesUnder(TAB_ROOTS[t.id]);
    return [t.id, { e: i.errors.length, w: i.warnings.length }];
  }));
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
          <li v-for="t in CONTENT_TABS" :key="t.id">
            <a :href="`#/content/${t.id}`" :aria-current="t.id === current.id ? 'page' : undefined">
              <span>{{ t.title }}</span>
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
        <h2 id="tab-title">{{ current.title }}</h2>
        <p>{{ INTRO[current.id] }}</p>
      </div>

      <template v-if="current.id === 'person'">
        <SchemaNode v-for="k in personFields" :key="k" :model="site.person" :field="k" :path="`$.person.${k}`" :spec="S.person.shape[k]" />
        <SchemaNode :model="site" field="hero" path="$.hero" :spec="S.hero" label="Hero" />
      </template>

      <template v-else-if="current.id === 'contact'">
        <SchemaNode :model="site" field="contact" path="$.contact" :spec="S.contact" :heading="false" />
      </template>

      <template v-else-if="current.id === 'ui'">
        <LField v-for="r in uiRows" :key="r.path" :model="r.model" :field="r.field" :path="r.path" :spec="r.spec" :label="r.note ? r.note[0] : r.field" :help="r.note ? r.note[1] : ''" />
      </template>

      <template v-else>
        <SchemaNode :model="site.sections" :field="SECTION_OF[current.id]" :path="`$.sections.${SECTION_OF[current.id]}`" :spec="S.sections.shape[SECTION_OF[current.id]]" :heading="false" />
      </template>
    </section>
  </div>
</template>
