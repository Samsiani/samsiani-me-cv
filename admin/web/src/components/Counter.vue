<script setup>
// "n / max" in code points, like the validator: neutral below ⌊0.9 × max⌋, warning at or above it,
// error above max (TOO_LONG blocks publishing). The icon is the non-colour cue.
import { computed } from 'vue';
import { softLimit } from '@admin-shared/draft-rules.mjs';
import Icon from './Icon.vue';

const props = defineProps({ value: { type: String, default: '' }, max: { type: Number, default: 0 }, id: { type: String, default: undefined } });
const n = computed(() => [...(props.value || '')].length);
const state = computed(() => (!props.max ? 'none' : n.value > props.max ? 'error' : n.value >= softLimit(props.max) ? 'warn' : 'ok'));
</script>

<template>
  <span v-if="max" :id="id" class="counter" :class="{ 'counter-warn': state === 'warn', 'counter-error': state === 'error' }">
    <Icon v-if="state === 'warn'" name="warn" />
    <Icon v-else-if="state === 'error'" name="error" />
    <span>{{ n }} / {{ max }}</span>
    <span v-if="state === 'error'">· {{ n - max }} over</span>
    <span v-else-if="state === 'warn'" class="sr-only">characters, close to the limit</span>
    <span v-else class="sr-only">characters</span>
  </span>
</template>
