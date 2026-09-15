<script setup>
// #/account (admin-ops.md §6.5): change password; sessions; the last 50 audit events; export and import.
// With `force` (first sign-in) only the password form is shown.
import { ref, onMounted, computed } from 'vue';
import Icon from '../components/Icon.vue';
import { api, ApiError, filenameOf, saveBlob } from '../api.js';
import { session, changePassword, logout } from '../state/session.js';
import { importDocument, settle } from '../state/draft.js';

const props = defineProps({ force: { type: Boolean, default: false } });
const emit = defineEmits(['password-changed']);

// ---------------------------------------------------------------- password
const cur = ref('');
const next = ref('');
const again = ref('');
const pwMsg = ref('');
const pwOk = ref('');
const pwBusy = ref(false);
const cp = (s) => [...String(s).normalize('NFKC')].length;
async function submitPassword() {
  if (pwBusy.value) return;
  pwMsg.value = '';
  pwOk.value = '';
  if (cp(next.value) < 12 || cp(next.value) > 128) { pwMsg.value = 'Use 12 to 128 characters.'; return; }
  if (next.value !== again.value) { pwMsg.value = 'The two new passwords are not the same.'; return; }
  pwBusy.value = true;
  try {
    await changePassword(cur.value, next.value);
    cur.value = next.value = again.value = '';
    pwOk.value = 'Password changed. Other sessions were signed out.';
    if (props.force) emit('password-changed');
    else loadSessions();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'invalid_current_password') pwMsg.value = 'The current password is wrong.';
    else if (e instanceof ApiError && e.code === 'weak_password') pwMsg.value = e.message;
    else if (e instanceof ApiError && e.status === 429) pwMsg.value = 'Too many attempts. Try again later.';
    else pwMsg.value = e.message;
  } finally {
    pwBusy.value = false;
  }
}

// ---------------------------------------------------------------- sessions and audit
const sessions = ref([]);
const audit = ref([]);
const listMsg = ref('');
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
async function loadSessions() {
  try { sessions.value = (await api('GET', '/account/sessions')).items; } catch (e) { listMsg.value = e.message; }
}
async function loadAudit() {
  try { audit.value = (await api('GET', '/account/audit?limit=50')).items; } catch (e) { listMsg.value = e.message; } // newest first
}
async function revokeOthers() {
  await api('POST', '/account/sessions/revoke-others');
  await loadSessions();
}
const others = computed(() => sessions.value.filter((s) => !s.current).length);

// ---------------------------------------------------------------- export / import
const ioMsg = ref('');
const ioErr = ref('');
const imported = ref(null);
async function exportDoc(source) {
  ioErr.value = '';
  try {
    const res = await api('GET', `/export?source=${source}`, { raw: true });
    saveBlob(await res.blob(), filenameOf(res, `samsiani-site-${source}.json`));
  } catch (e) { ioErr.value = e.message; }
}
async function onFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  ioMsg.value = '';
  ioErr.value = '';
  imported.value = null;
  if (!file) return;
  if (file.size > 320 * 1024) { ioErr.value = 'The file is larger than 320 KB.'; return; }
  let doc;
  try { doc = JSON.parse(await file.text()); } catch { ioErr.value = 'This file is not valid JSON.'; return; }
  try {
    const r = await importDocument(doc);
    imported.value = { name: file.name, errors: r.validation.errors.length, warnings: r.validation.warnings.length, rev: r.rev };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'draft_rejected') {
      const list = (err.body.errors || []).slice(0, 5).map((x) => `${x.code} ${x.path}`).join(', ');
      ioErr.value = `The file was refused: it is not a valid site document (${list}).`;
    } else if (err instanceof ApiError && err.status === 413) ioErr.value = 'The file is larger than 320 KB.';
    else ioErr.value = err.message;
  }
}

async function signOut() {
  await settle().catch(() => {}); // what was typed is saved first
  await logout();
  // a fresh start: the next sign-in (possibly after edits on another device) loads everything again
  location.replace(`${location.pathname}#/login`);
  location.reload();
}

onMounted(() => { if (!props.force) { loadSessions(); loadAudit(); } });
</script>

<template>
  <div class="page-head">
    <div>
      <h1>{{ force ? 'Choose your password' : 'Account' }}</h1>
      <p v-if="force">This is the first sign-in with the initial password. Choose your own password before anything else.</p>
      <p v-else>Signed in as {{ session.username }}.</p>
    </div>
    <button v-if="!force" type="button" class="btn" @click="signOut">Sign out</button>
  </div>

  <section class="panel" aria-labelledby="pw-title">
    <h2 id="pw-title" class="panel-head">Change password</h2>
    <form class="stack" novalidate @submit.prevent="submitPassword">
      <div>
        <label for="pw-current" class="lbl">Current password</label>
        <input id="pw-current" v-model="cur" class="inp" type="password" autocomplete="current-password" required :autofocus="force">
      </div>
      <div>
        <label for="pw-new" class="lbl">New password</label>
        <input id="pw-new" v-model="next" class="inp" type="password" autocomplete="new-password" required aria-describedby="pw-rule">
        <span id="pw-rule" class="help">12 to 128 characters. Not your username, not the current password.</span>
      </div>
      <div>
        <label for="pw-again" class="lbl">Repeat the new password</label>
        <input id="pw-again" v-model="again" class="inp" type="password" autocomplete="new-password" required>
      </div>
      <p v-if="pwMsg" class="st st-error" role="alert"><Icon name="error" />{{ pwMsg }}</p>
      <p v-if="pwOk" class="st st-ok" role="status"><Icon name="ok" />{{ pwOk }}</p>
      <div class="btn-row"><button type="submit" class="btn btn-primary" :aria-disabled="pwBusy ? 'true' : undefined">{{ pwBusy ? 'Saving…' : 'Change password' }}</button></div>
    </form>
  </section>

  <template v-if="!force">
    <section class="panel" aria-labelledby="sess-title">
      <div class="panel-head">
        <h2 id="sess-title">Sessions</h2>
        <button type="button" class="btn" :aria-disabled="!others ? 'true' : undefined" @click="others && revokeOthers()">Sign out other sessions</button>
      </div>
      <p v-if="listMsg" class="st st-error"><Icon name="error" />{{ listMsg }}</p>
      <table class="tbl">
        <thead><tr><th scope="col">Session</th><th scope="col">Signed in</th><th scope="col">Last seen</th><th scope="col">Address</th><th scope="col">Browser</th></tr></thead>
        <tbody>
          <tr v-for="s in sessions" :key="s.id">
            <td data-label="Session:"><span class="mono">{{ s.id }}</span><strong v-if="s.current"> · this browser</strong></td>
            <td data-label="Signed in:">{{ fmt(s.createdAt) }}</td>
            <td data-label="Last seen:">{{ fmt(s.lastSeenAt) }}</td>
            <td data-label="Address:" class="break-all">{{ s.ip }}</td>
            <td data-label="Browser:" class="break-all small">{{ s.ua }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel" aria-labelledby="data-title">
      <h2 id="data-title" class="panel-head">Data</h2>
      <div class="stack">
        <p class="muted">Exports are JSON files with the whole site document. Importing replaces the draft; the previous draft stays in Revisions.</p>
        <div class="btn-row">
          <button type="button" class="btn" data-testid="export-draft" @click="exportDoc('draft')">Export draft</button>
          <button type="button" class="btn" data-testid="export-live" @click="exportDoc('published')">Export live</button>
        </div>
        <div>
          <label for="import-file" class="lbl">Import JSON into the draft</label>
          <input id="import-file" class="inp" type="file" accept="application/json,.json" @change="onFile">
        </div>
        <div v-if="imported" class="banner banner-ok" role="status" data-testid="import-banner">
          <Icon name="ok" />
          <p>Imported into the draft. Preview it, then publish. <span class="muted">({{ imported.name }} · r{{ imported.rev }} · {{ imported.errors }} {{ imported.errors === 1 ? 'error' : 'errors' }}, {{ imported.warnings }} {{ imported.warnings === 1 ? 'warning' : 'warnings' }})</span></p>
          <a class="btn" href="#/">Open the preview</a>
        </div>
        <p v-if="ioErr" class="st st-error" role="alert"><Icon name="error" />{{ ioErr }}</p>
      </div>
    </section>

    <section class="panel" aria-labelledby="audit-title">
      <h2 id="audit-title" class="panel-head">Recent activity</h2>
      <table class="tbl">
        <thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Address</th><th scope="col">Detail</th></tr></thead>
        <tbody>
          <tr v-for="(a, i) in audit" :key="i">
            <td data-label="Time:">{{ fmt(a.t) }}</td>
            <td data-label="Event:">{{ a.event.replace(/_/g, ' ') }}</td>
            <td data-label="Address:" class="break-all">{{ a.ip || '' }}</td>
            <td data-label="Detail:" class="audit-detail small">{{ a.detail || '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!audit.length" class="muted">No events yet.</p>
    </section>
  </template>
</template>
