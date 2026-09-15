<script setup>
// Boot: session → router guard → registry + draft. The login screen and the forced password change run
// without the shell; everything else lives inside AppShell. The login modal, confirm dialog and toast are
// global because a 401 or an undo can happen on any screen.
import { ref, watch, onMounted } from 'vue';
import { session, refreshSession } from './state/session.js';
import { draft, load } from './state/draft.js';
import { loadRegistry } from './state/registry.js';
import { route, startRouter, navigate } from './router.js';
import AppShell from './components/AppShell.vue';
import LoginView from './views/LoginView.vue';
import AccountView from './views/AccountView.vue';
import LoginModal from './components/LoginModal.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import Toast from './components/Toast.vue';

const bootError = ref('');
const booting = ref(false);

async function bootData() {
  if (draft.loaded || booting.value) return;
  booting.value = true;
  bootError.value = '';
  try {
    await loadRegistry();
    await load();
  } catch (e) {
    bootError.value = e.message || 'The admin could not load.';
  } finally {
    booting.value = false;
  }
}

onMounted(async () => {
  try {
    await refreshSession();
  } catch (e) {
    bootError.value = e.message;
    session.checked = true;
  }
  startRouter();
});

watch(() => session.authenticated && !session.mustChangePassword && session.checked, (ready) => { if (ready) bootData(); });

// the forced first-login change is done: continue to the dashboard (the password view unmounts at once,
// so this cannot be an event from it)
watch(() => session.mustChangePassword, (now, before) => { if (before && !now && session.authenticated) navigate('/'); });
</script>

<template>
  <div v-if="!session.checked" class="adm-boot" role="status">Loading…</div>
  <LoginView v-else-if="!session.authenticated || route.name === 'login'" :error="bootError" />
  <div v-else-if="session.mustChangePassword" class="adm-solo">
    <header class="adm-solo-head"><span class="adm-brand">samsiani.me admin</span></header>
    <main id="main" class="adm-main adm-main-narrow">
      <AccountView force />
    </main>
  </div>
  <AppShell v-else :boot-error="bootError" :booting="booting" @retry="bootData" />
  <LoginModal />
  <ConfirmDialog />
  <Toast />
</template>
