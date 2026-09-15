<script setup>
// Decorative 14 px icons that accompany words (states never rely on colour alone). Always aria-hidden.
defineProps({ name: { type: String, required: true } });
</script>

<template>
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path v-if="name === 'ok'" d="M3 8.5l3.2 3L13 4.5" />
    <g v-else-if="name === 'warn'"><path d="M8 2.2 14.3 13.5H1.7Z" /><path d="M8 6.5v3.2M8 11.6v.1" /></g>
    <g v-else-if="name === 'error'"><circle cx="8" cy="8" r="6.2" /><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" /></g>
    <g v-else-if="name === 'busy'"><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.8v2.6h-2.6" /></g>
    <g v-else-if="name === 'offline'"><path d="M4.5 12.5h7a3 3 0 0 0 .4-6A4.2 4.2 0 0 0 4 7a2.8 2.8 0 0 0 .5 5.5Z" /><path d="M2 2l12 12" /></g>
    <g v-else-if="name === 'pending'"><circle cx="8" cy="8" r="6.2" /><path d="M8 4.8V8l2.2 1.6" /></g>
    <circle v-else-if="name === 'live'" cx="8" cy="8" r="3.2" fill="currentColor" stroke="none" />
    <path v-else-if="name === 'up'" d="M8 13V3M3.8 7.2 8 3l4.2 4.2" />
    <path v-else-if="name === 'down'" d="M8 3v10M3.8 8.8 8 13l4.2-4.2" />
    <path v-else-if="name === 'remove'" d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    <path v-else-if="name === 'plus'" d="M8 3v10M3 8h10" />
    <g v-else-if="name === 'external'"><path d="M9 3h4v4" /><path d="M13 3 7.5 8.5" /><path d="M11.5 9.5V13h-8.5V4.5H6.5" /></g>
    <g v-else-if="name === 'reload'"><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.8v2.6h-2.6" /></g>
    <path v-else-if="name === 'copy'" d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" />
    <path v-else d="M8 8h.01" />
  </svg>
</template>
