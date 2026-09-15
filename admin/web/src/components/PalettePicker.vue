<script setup>
// Palette picker: palettes.md §8 markup, CSS and behaviour. Swatch halves are drawn over the selected
// layout's light and dark page colours; the meta line is the light --accent-ink hex and the lowest
// accent-ink ratio for that layout, both from GET /registry (the SPA never converts colours). The swatch
// custom properties are Vue :style bindings (CSSOM), which the CSP allows. Selecting writes
// settings.palette; the preview switches through the bridge without a request.
import { computed } from 'vue';
import { registry } from '../state/registry.js';

const props = defineProps({ settings: { type: Object, required: true } });

const neutrals = computed(() => registry.palettes?.layouts?.[props.settings.layout] || registry.palettes?.layouts?.precision);
const half = (p, theme) => ({
  '--sw-bg': neutrals.value?.[theme]?.bg,
  '--sw-fill': p[theme]['--accent'],
  '--sw-on': p[theme]['--on-accent'],
  '--sw-ink': p[theme]['--accent-ink'],
});
const hex = (id) => registry.paletteHex[id]?.light?.['--accent-ink'] || '';
const min = (id) => {
  const v = registry.paletteMin[id]?.[props.settings.layout];
  return typeof v === 'number' ? v.toFixed(2) : '–';
};
</script>

<template>
  <fieldset class="pal-picker" aria-describedby="pal-help">
    <legend>Colour palette</legend>
    <p class="pal-help" id="pal-help">Accent colour for links, buttons and markers, in light and dark themes.</p>
    <div class="pal-list">
      <label v-for="p in registry.palettes.palettes" :key="p.id" class="pal-opt">
        <input type="radio" name="palette" :value="p.id" :checked="settings.palette === p.id" @change="settings.palette = p.id">
        <span class="sw" aria-hidden="true">
          <span class="sw-h" :style="half(p, 'light')"><i class="sw-fill">Aa</i><b class="sw-ink">Aa</b></span>
          <span class="sw-h" :style="half(p, 'dark')"><i class="sw-fill">Aa</i><b class="sw-ink">Aa</b></span>
        </span>
        <span class="pal-name">{{ p.label.en }}</span>
        <span class="pal-meta">{{ hex(p.id) }} · min {{ min(p.id) }} : 1</span>
      </label>
    </div>
  </fieldset>
</template>
