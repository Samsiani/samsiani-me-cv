<script setup>
// #/login (admin-ops.md §6.5): username, password; errors never say which field was wrong; 429 shows the
// wait; a first sign-in with the initial password continues to the forced password change.
import { ref } from 'vue';
import { login } from '../state/session.js';
import { reroute } from '../router.js';
import { loginMessage } from '../loginErrors.js';

defineProps({ error: { type: String, default: '' } });

const username = ref('');
const password = ref('');
const message = ref('');
const busy = ref(false);

async function submit() {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    await login(username.value.trim(), password.value);
    password.value = '';
    reroute();
  } catch (e) {
    message.value = loginMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="adm-solo">
    <header class="adm-solo-head"><span class="adm-brand">samsiani.me admin</span></header>
    <main id="main" class="adm-main adm-main-narrow">
      <form class="stack" novalidate @submit.prevent="submit">
        <h1>Sign in</h1>
        <p v-if="error" class="st st-error" role="alert">{{ error }}</p>
        <div>
          <label for="login-user" class="lbl">Username</label>
          <input id="login-user" v-model="username" class="inp" type="text" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
        </div>
        <div>
          <label for="login-pass" class="lbl">Password</label>
          <input id="login-pass" v-model="password" class="inp" type="password" name="password" autocomplete="current-password" required>
        </div>
        <p v-if="message" class="issue-error" role="alert" data-testid="login-error">{{ message }}</p>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary" :aria-disabled="busy ? 'true' : undefined">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
        </div>
      </form>
    </main>
  </div>
</template>
