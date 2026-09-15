<script setup>
// Native <dialog> opened with showModal(): the rest of the page is inert while it is open, Escape is
// routed through `closable`, and focus returns to where it was when the dialog closes.
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  labelledby: { type: String, required: true },
  closable: { type: Boolean, default: true },
  wide: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);
const el = ref(null);
let returnFocus = null;

watch(() => props.open, async (open) => {
  await nextTick();
  const d = el.value;
  if (!d) return;
  if (open && !d.open) {
    returnFocus = document.activeElement;
    d.showModal();
    d.querySelector('[autofocus]')?.focus();
  } else if (!open && d.open) {
    d.close();
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
}, { immediate: true });

onBeforeUnmount(() => { if (el.value?.open) el.value.close(); });

function onCancel(e) {
  e.preventDefault();
  if (props.closable) emit('close');
}
</script>

<template>
  <dialog ref="el" :aria-labelledby="labelledby" :class="{ 'dlg-wide': wide }" @cancel="onCancel">
    <slot v-if="open" />
  </dialog>
</template>
