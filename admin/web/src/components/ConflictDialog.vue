<script setup>
// 412 on autosave (admin-ops.md §6.6): two choices, neither of which loses a version.
import { ref, computed } from 'vue';
import ModalDialog from './ModalDialog.vue';
import { draft, conflictLabel, conflictLoadNewer, conflictKeepMine } from '../state/draft.js';

const busy = ref(false);
const error = ref('');
const open = computed(() => draft.status === 'conflict');

async function run(fn) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try { await fn(); }
  catch (e) { error.value = e.message || 'That did not work; try again.'; }
  finally { busy.value = false; }
}
</script>

<template>
  <ModalDialog :open="open" labelledby="conflict-title" :closable="false">
    <div class="dlg-head"><h2 id="conflict-title">This draft was changed in another tab or device ({{ conflictLabel() }}).</h2></div>
    <div class="dlg-body">
      <p>Your changes on this screen are not saved yet. Choose which version to keep editing; the other one stays in Revisions.</p>
      <p v-if="error" class="issue-error" role="alert">{{ error }}</p>
    </div>
    <div class="dlg-actions">
      <button type="button" class="btn" :aria-disabled="busy ? 'true' : undefined" @click="run(conflictLoadNewer)">Load the newer draft</button>
      <button type="button" class="btn btn-primary" autofocus :aria-disabled="busy ? 'true' : undefined" @click="run(conflictKeepMine)">Keep mine and overwrite (the other version stays in Revisions)</button>
    </div>
  </ModalDialog>
</template>
