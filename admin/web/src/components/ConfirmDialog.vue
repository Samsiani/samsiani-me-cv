<script setup>
// Promise-based confirm dialog (confirmAction() in state/ui.js): discard, rollback, restore.
import ModalDialog from './ModalDialog.vue';
import { confirmState } from '../state/ui.js';

function answer(v) {
  const r = confirmState.resolve;
  confirmState.open = false;
  confirmState.resolve = null;
  r?.(v);
}
</script>

<template>
  <ModalDialog :open="confirmState.open" labelledby="confirm-title" @close="answer(false)">
    <div class="dlg-head"><h2 id="confirm-title">{{ confirmState.title }}</h2></div>
    <p class="dlg-body">{{ confirmState.message }}</p>
    <div class="dlg-actions">
      <button type="button" class="btn" autofocus @click="answer(false)">{{ confirmState.cancelLabel }}</button>
      <button type="button" class="btn" :class="confirmState.danger ? 'btn-danger' : 'btn-primary'" @click="answer(true)">{{ confirmState.confirmLabel }}</button>
    </div>
  </ModalDialog>
</template>
