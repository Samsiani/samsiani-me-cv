<script setup>
// Layout: a native radio group, one option per registered layout, each a <label> holding the radio, the
// 320×200 thumbnail, the label and the one-line description (admin-ops.md §6.5). Changing the layout never
// changes the palette.
import { registry } from '../state/registry.js';

defineProps({ settings: { type: Object, required: true } });

// src/admin-thumbs/<id>.svg, emitted by Vite as hashed files under /admin/assets/
const thumbs = import.meta.glob('@thumbs/*.svg', { eager: true, query: '?url', import: 'default' });
const byName = Object.fromEntries(Object.entries(thumbs).map(([k, v]) => [k.split('/').pop(), v]));
const thumbUrl = (l) => (l.thumbnail ? byName[l.thumbnail.split('/').pop()] || null : null);
</script>

<template>
  <fieldset>
    <legend class="sec-title">Layout</legend>
    <div class="lay-list">
      <label v-for="l in registry.layouts" :key="l.id" class="lay-opt">
        <span class="lay-head">
          <input type="radio" name="layout" :value="l.id" :checked="settings.layout === l.id" @change="settings.layout = l.id">
          <span>{{ l.label }}</span>
        </span>
        <img v-if="thumbUrl(l)" class="lay-thumb" :src="thumbUrl(l)" alt="" width="320" height="200">
        <span class="lay-desc">{{ l.description }}</span>
      </label>
    </div>
  </fieldset>
</template>
