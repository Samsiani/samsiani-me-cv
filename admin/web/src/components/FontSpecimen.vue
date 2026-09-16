<script setup>
// One specimen: the same two lines in every row, drawn in the face under test. The alias is a constant the
// SPA generates ("sm-spec-<id>"), never a name out of a font file, and it reaches CSS as a :style binding
// (CSSOM), which the admin's CSP allows. A face that has no Georgian simply falls through to the admin's own
// Noto on the second line — which is exactly what the site would do.
import { computed } from 'vue';

const props = defineProps({
  alias: { type: String, default: '' },
  loading: { type: Boolean, default: false },
});

const TAIL = 'system-ui, -apple-system, "Segoe UI", "Noto Sans Georgian", sans-serif';
const stack = computed(() => (props.alias ? `"${props.alias}", ${TAIL}` : TAIL));
</script>

<template>
  <div class="fp-spec" :style="{ '--fp-face': stack }" :aria-busy="loading ? 'true' : undefined">
    <p class="fp-spec-line">Giorgi Samsiani · Full-stack web developer</p>
    <p class="fp-spec-line fp-spec-ka" lang="ka">გიორგი სამსიანი · ვებ დეველოპერი</p>
  </div>
</template>
