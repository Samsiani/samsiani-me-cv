// Global UI helpers: a promise-based confirm dialog and the toast region (undo after remove).
import { reactive } from 'vue';

export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  danger: false,
  resolve: null,
});

/** Resolves true when the owner confirms, false on cancel or Escape. */
export function confirmAction(opts) {
  return new Promise((resolve) => {
    Object.assign(confirmState, { title: '', message: '', confirmLabel: 'Confirm', cancelLabel: 'Cancel', danger: false }, opts, { open: true, resolve });
  });
}

export const toastState = reactive({ items: [] });
let seq = 0;

/** A short message with an optional action ({ label, run }); removed after `timeout` ms. */
export function toast(message, { action = null, timeout = 6000 } = {}) {
  const id = ++seq;
  toastState.items.push({ id, message, action });
  setTimeout(() => dismissToast(id), timeout);
  return id;
}

export function dismissToast(id) {
  const i = toastState.items.findIndex((t) => t.id === id);
  if (i >= 0) toastState.items.splice(i, 1);
}
