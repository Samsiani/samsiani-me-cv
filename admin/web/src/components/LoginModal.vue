<script setup>
// Opens over the current screen when a request gets 401 (session expired or revoked). After a successful
// sign-in the waiting requests are sent again (the queued save included), so nothing typed is lost.
import { ref, watch } from 'vue';
import ModalDialog from './ModalDialog.vue';
import { session, login, modalLoginDone } from '../state/session.js';
import { loginMessage } from '../loginErrors.js';

const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

watch(() => session.modal, (open) => {
  if (open) { username.value = session.username || ''; password.value = ''; error.value = ''; }
});

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const r = await login(username.value.trim(), password.value);
    password.value = '';
    if (r.mustChangePassword) {
      error.value = 'This account must change its password first. Save your work, then reload the page.';
      return;
    }
    modalLoginDone();
  } catch (e) {
    error.value = loginMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalDialog :open="session.modal" labelledby="relogin-title" :closable="false">
    <form class="dlg-body" @submit.prevent="submit">
      <div class="dlg-head"><h2 id="relogin-title">Sign in again</h2></div>
      <p>Your session has ended. Sign in to continue; your unsaved changes are kept and will be saved after you sign in.</p>
      <div>
        <label for="relogin-user" class="lbl">Username</label>
        <input id="relogin-user" v-model="username" class="inp" type="text" autocomplete="username" required :autofocus="!username">
      </div>
      <div>
        <label for="relogin-pass" class="lbl">Password</label>
        <input id="relogin-pass" v-model="password" class="inp" type="password" autocomplete="current-password" required :autofocus="!!username">
      </div>
      <p v-if="error" class="issue-error" role="alert">{{ error }}</p>
      <div class="dlg-actions">
        <button type="submit" class="btn btn-primary" :aria-disabled="busy ? 'true' : undefined">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
      </div>
    </form>
  </ModalDialog>
</template>
