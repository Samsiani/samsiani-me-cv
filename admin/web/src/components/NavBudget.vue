<script setup>
// The nav budget (admin-ops.md §3.3): the effective labels of the shown sections (nav, else title) total at
// most 100 characters per language (NAV_BUDGET), and a title without a nav label is at most 28 (NAV_LABEL).
// A hidden section has no nav link, so it is out of the budget until it is shown again.
import { computed } from 'vue';
import Icon from './Icon.vue';
import { SECTIONS } from '@src/shared/localize.mjs';
import { draft } from '../state/draft.js';
import { fieldId, focusPath } from '../fields.js';

const BUDGET = 100;
const LABEL_MAX = 28;
const len = (s) => [...(s || '')].length;

const rows = computed(() => {
  void draft.version;
  const s = draft.site?.sections || {};
  return ['en', 'ka'].map((lang) => {
    let total = 0;
    const long = [];
    for (const { key } of SECTIONS) {
      const sec = s[key];
      if (!sec?.title || sec.hidden) continue;
      const label = (sec.nav || sec.title)[lang] || '';
      total += len(label);
      if (!sec.nav && len(label) > LABEL_MAX) long.push({ key, n: len(label), path: `$.sections.${key}.title.${lang}` });
    }
    const state = total > BUDGET ? 'error' : total >= Math.floor(BUDGET * 0.9) ? 'warn' : 'ok';
    return { lang, total, long, state, pct: Math.min(100, (total / BUDGET) * 100) };
  });
});
</script>

<template>
  <section :id="fieldId('$.sections')" class="nav-budget" tabindex="-1" aria-labelledby="nav-budget-title">
    <h2 id="nav-budget-title" class="sec-title">Navigation labels</h2>
    <div v-for="r in rows" :key="r.lang" class="row-block">
      <div class="row">
        <span>{{ r.lang === 'en' ? 'EN' : 'KA' }} budget</span>
        <span :class="{ 'counter-warn': r.state === 'warn', 'counter-error': r.state === 'error' }" class="counter">
          <Icon v-if="r.state === 'warn'" name="warn" /><Icon v-else-if="r.state === 'error'" name="error" />
          {{ r.total }} / {{ BUDGET }}<span v-if="r.state === 'error'"> · {{ r.total - BUDGET }} over</span>
        </span>
      </div>
      <div class="meter" :class="r.state" aria-hidden="true"><span :style="{ width: r.pct + '%' }" /></div>
      <ul v-if="r.long.length" class="issues">
        <li v-for="l in r.long" :key="l.key" class="issue-error">
          <Icon name="error" />
          <button type="button" class="issue-link" @click="focusPath(l.path)">{{ l.key }} title is {{ l.n }} &gt; {{ LABEL_MAX }}; shorten it or add a navigation label</button>
        </li>
      </ul>
    </div>
    <p class="help">All shown labels together, per language. Each label: at most {{ LABEL_MAX }}.</p>
  </section>
</template>
