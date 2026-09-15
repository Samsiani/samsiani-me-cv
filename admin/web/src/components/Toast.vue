<script setup>
// Toast region: "Removed 'X'. Undo" for 10 s after a list item is removed (admin-ops.md §6.5).
import { toastState, dismissToast } from '../state/ui.js';

async function run(t) {
  dismissToast(t.id);
  await t.action.run();
}
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <div v-for="t in toastState.items" :key="t.id" class="toast">
      <span>{{ t.message }}</span>
      <button v-if="t.action" type="button" class="btn" @click="run(t)">{{ t.action.label }}</button>
      <button type="button" class="btn btn-quiet" aria-label="Dismiss message" @click="dismissToast(t.id)">×</button>
    </div>
  </div>
</template>
