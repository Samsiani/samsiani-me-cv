<script setup>
// #/revisions (admin-ops.md §6.5): live builds (roll back), revisions (preview, changes vs the draft,
// restore into the draft) and a checkpoint with a note.
import { ref, onMounted } from 'vue';
import Icon from '../components/Icon.vue';
import ModalDialog from '../components/ModalDialog.vue';
import PreviewFrame from '../components/PreviewFrame.vue';
import { api } from '../api.js';
import { draft, checkpoint, restoreRevision, refreshLive } from '../state/draft.js';
import { layoutById, paletteById } from '../state/registry.js';
import { confirmAction, toast } from '../state/ui.js';

const builds = ref([]);
const revisions = ref([]);
const keep = ref(30);
const msg = ref('');
const note = ref('');
const busy = ref(false);
const open = ref({}); // revision id -> { loading, changes, error }
const previewRev = ref(null);

const REASONS = {
  publish: 'Published', autosave: 'Autosave', checkpoint: 'Checkpoint', 'pre-restore': 'Before a restore',
  'pre-import': 'Before an import', 'pre-discard': 'Before a discard', 'pre-rollback': 'Before a rollback',
  'pre-overwrite': 'Before an overwrite', 'pre-migrate': 'Before a migration',
};
const fmt = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const layoutName = (id) => layoutById(id)?.label || id || '';
const paletteName = (id) => paletteById(id)?.label?.en || id || '';
const show = (v) => {
  if (v === undefined) return '(none)';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 200 ? s.slice(0, 199) + '…' : s;
};

async function load() {
  msg.value = '';
  try {
    const [b, r] = await Promise.all([api('GET', '/builds'), api('GET', '/revisions')]);
    builds.value = b.items;
    revisions.value = r.items;
    keep.value = r.keep;
  } catch (e) { msg.value = e.message; }
}

async function saveCheckpoint() {
  if (busy.value) return;
  busy.value = true;
  try {
    await checkpoint(note.value.trim().slice(0, 200));
    note.value = '';
    toast('Checkpoint saved.');
    await load();
  } catch (e) { toast(`Checkpoint failed: ${e.message}`); }
  finally { busy.value = false; }
}

async function rollback(b) {
  const ok = await confirmAction({
    title: 'Roll back the live site?',
    message: `The live site returns to the build of ${fmt(b.createdAt)} (r${b.rev}, ${layoutName(b.layout)}, ${paletteName(b.palette)}). The draft is not changed.`,
    confirmLabel: 'Roll back',
  });
  if (!ok) return;
  try {
    const r = await api('POST', '/builds/rollback', { body: { buildId: b.buildId } });
    await refreshLive();
    toast(`Rolled back: the live site is r${r.rev} again.`);
    await load();
  } catch (e) { toast(`Rollback failed: ${e.message}`); }
}

async function toggleChanges(rev) {
  if (open.value[rev.id]) { delete open.value[rev.id]; return; }
  open.value[rev.id] = { loading: true, changes: [], error: '' };
  try {
    const r = await api('GET', `/revisions/${encodeURIComponent(rev.id)}`);
    open.value[rev.id] = { loading: false, changes: r.changes, error: '' };
  } catch (e) { open.value[rev.id] = { loading: false, changes: [], error: e.message }; }
}

async function restore(rev) {
  const ok = await confirmAction({
    title: 'Restore this revision into the draft?',
    message: `The draft becomes the revision of ${fmt(rev.createdAt)} (${REASONS[rev.reason] || rev.reason}, r${rev.rev}). The current draft stays in Revisions as “pre-restore”. The live site does not change until you publish.`,
    confirmLabel: 'Restore to draft',
  });
  if (!ok) return;
  try {
    await restoreRevision(rev.id);
    toast('Restored into the draft. Preview it, then publish.');
    await load();
  } catch (e) { toast(`Restore failed: ${e.message}`); }
}

onMounted(load);
</script>

<template>
  <div class="page-head">
    <h1>Revisions</h1>
  </div>
  <p v-if="msg" class="st st-error" role="alert"><Icon name="error" />{{ msg }}</p>

  <section class="panel" aria-labelledby="cp-title">
    <h2 id="cp-title" class="panel-head">Save a checkpoint</h2>
    <form class="form-row" @submit.prevent="saveCheckpoint">
      <div class="grow">
        <label for="cp-note" class="lbl">Note</label>
        <input id="cp-note" v-model="note" class="inp" type="text" maxlength="200" autocomplete="off">
      </div>
      <button type="submit" class="btn" :aria-disabled="busy || draft.inert ? 'true' : undefined">Save checkpoint</button>
    </form>
  </section>

  <section class="panel" aria-labelledby="builds-title">
    <h2 id="builds-title" class="panel-head">Live builds</h2>
    <p v-if="!builds.length" class="muted">Nothing has been published from the admin yet.</p>
    <table v-else class="tbl" data-testid="builds">
      <thead><tr><th scope="col">Date</th><th scope="col">Rev</th><th scope="col">Layout</th><th scope="col">Palette</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>
        <tr v-for="b in builds" :key="b.buildId" :data-build="b.buildId">
          <td data-label="Date:">{{ fmt(b.createdAt) }}</td>
          <td data-label="Rev:" class="num">r{{ b.rev }}</td>
          <td data-label="Layout:">{{ layoutName(b.layout) }}</td>
          <td data-label="Palette:">{{ paletteName(b.palette) }}</td>
          <td>
            <div class="acts">
              <span v-if="b.current" class="st st-ok"><Icon name="live" />Live now</span>
              <button v-else type="button" class="btn" :aria-label="`Roll back to this build: ${fmt(b.createdAt)} (r${b.rev})`" @click="rollback(b)">Roll back to this build</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="panel" aria-labelledby="revs-title">
    <h2 id="revs-title" class="panel-head">Revisions <span class="muted small">(newest {{ keep }} kept, plus the live one)</span></h2>
    <table class="tbl" data-testid="revisions">
      <thead><tr><th scope="col">Date</th><th scope="col">Reason</th><th scope="col">Rev</th><th scope="col">Note</th><th scope="col">Layout · palette</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>
        <template v-for="r in revisions" :key="r.id">
          <tr :data-revision="r.id" :data-reason="r.reason">
            <td data-label="Date:">{{ fmt(r.createdAt) }}</td>
            <td data-label="Reason:">{{ REASONS[r.reason] || r.reason }} <code>{{ r.reason }}</code> <span v-if="r.live" class="st st-ok live-tag"><Icon name="live" />live</span></td>
            <td data-label="Rev:" class="num">r{{ r.rev }}</td>
            <td data-label="Note:" class="break-all">{{ r.note }}</td>
            <td data-label="Layout · palette:">{{ layoutName(r.layout) }} · {{ paletteName(r.palette) }}</td>
            <td>
              <div class="acts">
                <button type="button" class="btn" :aria-label="`Preview: the revision of ${fmt(r.createdAt)}`" @click="previewRev = r">Preview</button>
                <button type="button" class="btn" :aria-expanded="open[r.id] ? 'true' : 'false'" :aria-label="`Changes: the revision of ${fmt(r.createdAt)} compared with the draft`" @click="toggleChanges(r)">Changes</button>
                <button type="button" class="btn" :aria-label="`Restore to draft: the revision of ${fmt(r.createdAt)}`" @click="restore(r)">Restore to draft</button>
              </div>
            </td>
          </tr>
          <tr v-if="open[r.id]" class="changes-row">
            <td colspan="6">
              <p v-if="open[r.id].loading" class="muted">Loading…</p>
              <p v-else-if="open[r.id].error" class="st st-error"><Icon name="error" />{{ open[r.id].error }}</p>
              <p v-else-if="!open[r.id].changes.length" class="muted">Identical to the draft.</p>
              <ul v-else class="changes">
                <li v-for="(c, i) in open[r.id].changes.slice(0, 100)" :key="i">
                  <span class="path">{{ c.path }}</span>
                  <span class="val"><span class="muted">Draft:</span> {{ show(c.before) }}</span>
                  <span class="val"><span class="muted">Revision:</span> {{ show(c.after) }}</span>
                </li>
              </ul>
              <p v-if="open[r.id].changes.length > 100" class="muted">…and {{ open[r.id].changes.length - 100 }} more.</p>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </section>

  <ModalDialog :open="!!previewRev" labelledby="revprev-title" wide @close="previewRev = null">
    <div class="dlg-head">
      <h2 id="revprev-title">Revision of {{ previewRev ? fmt(previewRev.createdAt) : '' }}</h2>
      <button type="button" class="btn" autofocus @click="previewRev = null">Close</button>
    </div>
    <PreviewFrame v-if="previewRev" :revision-id="previewRev.id" :revision-palette="previewRev.palette" :revision-layout="previewRev.layout" />
  </ModalDialog>
</template>
