<script setup>
// An offline copy from this device found at boot (admin-ops.md §6.6). It is always offered: with the same
// base ETag as the server draft it simply restores; with a different one the owner chooses. The stored copy
// is deleted only after it was saved or after Discard.
import { computed } from 'vue';
import ModalDialog from './ModalDialog.vue';
import { draft, restorePendingCopy, discardPendingCopy, downloadPendingCopy } from '../state/draft.js';

const p = computed(() => draft.offerPending);
const when = computed(() => (p.value?.at ? new Date(p.value.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''));
</script>

<template>
  <ModalDialog :open="!!p" labelledby="pending-title" :closable="false">
    <template v-if="p && p.sameBase">
      <div class="dlg-head"><h2 id="pending-title">Restore unsaved changes from this device</h2></div>
      <p class="dlg-body">Changes made on this device{{ when ? ` (${when})` : '' }} were not saved to the server. The server draft has not changed since, so they can be restored as they are.</p>
      <div class="dlg-actions">
        <button type="button" class="btn" @click="downloadPendingCopy">Download my copy</button>
        <button type="button" class="btn btn-danger" @click="discardPendingCopy">Discard</button>
        <button type="button" class="btn btn-primary" autofocus @click="restorePendingCopy">Restore unsaved changes</button>
      </div>
    </template>
    <template v-else-if="p">
      <div class="dlg-head"><h2 id="pending-title">Unsaved changes from this device, based on r{{ p.rev ?? '?' }}; the server now has r{{ draft.rev }}</h2></div>
      <p class="dlg-body">“Use mine” saves this device’s copy as the draft; the server draft r{{ draft.rev }} stays in Revisions as “pre-overwrite”. “Download my copy” saves it as a file you can import later.</p>
      <div class="dlg-actions">
        <button type="button" class="btn" @click="downloadPendingCopy">Download my copy</button>
        <button type="button" class="btn btn-danger" @click="discardPendingCopy">Discard</button>
        <button type="button" class="btn btn-primary" autofocus @click="restorePendingCopy">Use mine</button>
      </div>
    </template>
  </ModalDialog>
</template>
