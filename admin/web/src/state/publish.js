// Publish dialog state (admin-ops.md §6.8): settle the autosave queue → POST /validate → review →
// POST /publish with If-Match: the ETag after the queue settled.
import { reactive } from 'vue';
import { api, ApiError } from '../api.js';
import { draft, settle, settleMessage, publish } from './draft.js';

export const pub = reactive({
  open: false,
  phase: 'idle', // settling | review | publishing | done | error
  errors: [],
  warnings: [],
  ack: false,
  note: '',
  result: null,
  error: '',
});

export async function openPublish() {
  Object.assign(pub, { open: true, phase: 'settling', errors: [], warnings: [], ack: false, note: '', result: null, error: '' });
  try {
    if (!(await settle())) throw new Error(settleMessage());
    const v = await api('POST', '/validate', { body: {} });
    pub.errors = v.errors.map((e) => ({ ...e, level: 'error' }));
    pub.warnings = v.warnings.map((w) => ({ ...w, level: 'warning' }));
    pub.phase = 'review';
  } catch (e) {
    pub.error = e.message;
    pub.phase = 'error';
  }
}

export function closePublish() {
  if (pub.phase === 'publishing' || pub.phase === 'settling') return;
  pub.open = false;
}

export async function confirmPublish() {
  if (pub.phase !== 'review' || pub.errors.length || (pub.warnings.length && !pub.ack)) return;
  pub.phase = 'publishing';
  const t0 = performance.now();
  try {
    const r = await publish({ acknowledgeWarnings: pub.ack || !pub.warnings.length, note: pub.note.trim().slice(0, 200) });
    pub.result = { ...r, seconds: ((r.durationMs ?? performance.now() - t0) / 1000).toFixed(1) };
    pub.phase = 'done';
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      pub.warnings = (e.body.warnings || []).map((w) => ({ ...w, level: 'warning' }));
      pub.ack = false;
      pub.phase = 'review';
      return;
    }
    if (e instanceof ApiError && e.status === 400 && e.code === 'invalid') {
      pub.errors = (e.body.errors || []).map((x) => ({ ...x, level: 'error' }));
      pub.phase = 'review';
      return;
    }
    if (e instanceof ApiError && e.status === 412) pub.error = 'The draft was changed in another tab or device and has been reloaded. Review it, then publish again.';
    else if (e instanceof ApiError && e.status === 423) pub.error = 'Another publish or save is in progress. Try again in a moment.';
    else if (e instanceof ApiError && e.code === 'publish_failed') pub.error = `Publishing failed at the “${e.body.stage || 'unknown'}” stage: ${e.message}`;
    else pub.error = e.message || 'Publishing failed.';
    pub.phase = 'error';
  }
}

/** The date the publish will carry (data-model.md §12.3 rule, as the server applies it). */
export function publishDate(contentChanged, today) {
  const s = draft.site?.settings;
  if (!s) return '';
  return s.autoUpdateDateOnPublish && contentChanged && s.updated !== today ? today : s.updated;
}
