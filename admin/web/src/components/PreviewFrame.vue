<script>
import { ref as sharedRef } from 'vue';
// the draft preview keeps its language and width while the owner moves between screens
const shared = { lang: sharedRef('en'), device: sharedRef('desktop') };
</script>

<script setup>
// Live preview (admin-ops.md §6.7). Content and layout changes re-render after 600 ms (POST /preview with the
// in-memory draft, unsaved keystrokes included); palette and theme changes go through the bridge inside the
// sandboxed frame with postMessage and no request, re-posted on every frame load. The frame has an opaque
// origin (sandbox="allow-scripts", no allow-same-origin), so it can never reach the admin session.
import { computed, ref, watch, onMounted, onBeforeUnmount, toRaw } from 'vue';
import Icon from './Icon.vue';
import { api } from '../api.js';
import { draft } from '../state/draft.js';
import { layoutById } from '../state/registry.js';

const props = defineProps({
  revisionId: { type: String, default: null }, // preview a stored revision instead of the draft
  revisionPalette: { type: String, default: null },
  revisionLayout: { type: String, default: null },
});

const SIZES = { desktop: { w: 1440, h: 900 }, mobile: { w: 390, h: 844 } };
const REFRESH_MS = 14 * 60 * 1000;

const lang = props.revisionId ? ref('en') : shared.lang;
const device = props.revisionId ? ref('desktop') : shared.device;
const stageWidth = ref(0);
const base = ref('');
const error = ref('');
const busy = ref(false);
const frame = ref(null);
const stage = ref(null);
let lastKey = null;
let renderedAt = 0;
let seq = 0;
let debounce = null;
let refreshTimer = null;
let observer = null;

const site = computed(() => draft.site);
const palette = computed(() => props.revisionId ? props.revisionPalette : site.value?.settings?.palette);
const layoutId = computed(() => props.revisionId ? props.revisionLayout : site.value?.settings?.layout);

// the theme shown in the frame: the owner's default theme when it is light or dark, else the layout's own
// default (Studio: dark), else the admin's own system preference; the toolbar can override it
const osDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
const effectiveTheme = () => {
  const t = props.revisionId ? 'system' : site.value?.settings?.defaultTheme;
  if (t === 'light' || t === 'dark') return t;
  return layoutById(layoutId.value)?.defaultTheme || (osDark ? 'dark' : 'light');
};
const theme = ref(effectiveTheme());
watch(() => `${site.value?.settings?.defaultTheme}|${layoutId.value}`, () => { theme.value = effectiveTheme(); });

// re-render key: everything except palette and default theme (those go through the bridge)
const renderKey = computed(() => {
  if (props.revisionId) return `rev:${props.revisionId}`;
  void draft.version;
  const s = toRaw(site.value);
  if (!s) return null;
  return JSON.stringify({ ...s, settings: { ...s.settings, palette: null, defaultTheme: null } });
});

// The frame URL changes only with a new token or the language; a theme change is posted to the bridge
// (the ?theme= parameter only seeds the first paint of a newly loaded page).
const urlFor = () => (base.value ? `${base.value}${lang.value === 'ka' ? 'ka/' : ''}?theme=${theme.value}` : '');
const src = ref('');
watch([base, lang], () => { src.value = urlFor(); });
const size = computed(() => SIZES[device.value]);
const scale = computed(() => (stageWidth.value ? Math.min(1, (stageWidth.value - 2) / size.value.w) : 0.5));
const boxStyle = computed(() => ({ width: `${Math.floor(size.value.w * scale.value)}px`, height: `${Math.floor(size.value.h * scale.value)}px` }));
const frameStyle = computed(() => ({ width: `${size.value.w}px`, height: `${size.value.h}px`, transform: `scale(${scale.value})` }));

async function render(force = false) {
  const key = renderKey.value;
  if (!key || (!force && key === lastKey)) return;
  const mine = ++seq;
  busy.value = true;
  try {
    const body = props.revisionId ? { revisionId: props.revisionId } : { site: JSON.parse(JSON.stringify(toRaw(site.value))) };
    const r = await api('POST', '/preview', { body });
    if (mine !== seq) return;
    lastKey = key;
    renderedAt = Date.now();
    base.value = r.base;
    error.value = '';
  } catch (e) {
    if (mine !== seq) return;
    lastKey = key;
    if (e.status === 422) error.value = e.body?.message || `Preview cannot render this draft: ${e.message}`;
    else if (e.code === 'draft_rejected') error.value = 'Preview cannot render this draft: it has structural errors.';
    else if (e.status === 429) {
      error.value = 'Too many previews in a minute; the preview refreshes shortly.';
      setTimeout(() => render(true), Math.min(60, e.body?.retryAfterS || 5) * 1000);
    } else error.value = `Preview unavailable: ${e.message}`;
  } finally {
    if (mine === seq) busy.value = false;
  }
}

function post() {
  const w = frame.value?.contentWindow;
  if (!w) return;
  // target "*": a sandboxed frame's origin is "null"; the bridge checks the sender's origin and the values
  w.postMessage({ type: 'sm-preview', palette: palette.value, theme: theme.value }, '*');
}

watch(renderKey, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => render(), 600);
});
watch([palette, theme], post);

function reload() { render(true); }
const setLang = (v) => { lang.value = v; };
const setDevice = (v) => { device.value = v; };
const setTheme = (v) => { theme.value = v; };

// "Open in new tab": a link to the token URL (its response carries the sandbox CSP, so it is isolated there
// too). Each render bakes in the palette of that moment; when the palette changed since, the click renders
// again first and opens the fresh URL (still within the click's user activation).
let renderedPalette = null;
watch(base, () => { renderedPalette = palette.value; });
const tabUrl = computed(() => (base.value ? `${base.value}${lang.value === 'ka' ? 'ka/' : ''}?theme=${theme.value}` : ''));
async function openInTab(e) {
  if (renderedPalette === palette.value) return; // the link opens as it is
  e.preventDefault();
  await render(true);
  if (tabUrl.value) window.open(tabUrl.value, '_blank', 'noopener,noreferrer');
}

function onVisible() {
  if (document.visibilityState === 'visible' && renderedAt && Date.now() - renderedAt > REFRESH_MS) render(true);
}

onMounted(() => {
  observer = new ResizeObserver((entries) => { stageWidth.value = entries[0].contentRect.width; });
  if (stage.value) observer.observe(stage.value);
  render(true);
  refreshTimer = setInterval(onVisible, 30_000); // a fresh token every 14 minutes while the page is visible
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => {
  clearTimeout(debounce);
  clearInterval(refreshTimer);
  document.removeEventListener('visibilitychange', onVisible);
  observer?.disconnect();
  seq++;
});

defineExpose({ reload });
</script>

<template>
  <div class="pv">
    <div class="pv-bar" role="group" aria-label="Preview options">
      <div class="seg" role="group" aria-label="Language">
        <button type="button" :aria-pressed="lang === 'en' ? 'true' : 'false'" @click="setLang('en')">EN</button>
        <button type="button" :aria-pressed="lang === 'ka' ? 'true' : 'false'" @click="setLang('ka')">KA</button>
      </div>
      <div class="seg" role="group" aria-label="Width">
        <button type="button" :aria-pressed="device === 'desktop' ? 'true' : 'false'" @click="setDevice('desktop')">Desktop 1440</button>
        <button type="button" :aria-pressed="device === 'mobile' ? 'true' : 'false'" @click="setDevice('mobile')">Mobile 390</button>
      </div>
      <div class="seg" role="group" aria-label="Theme">
        <button type="button" :aria-pressed="theme === 'light' ? 'true' : 'false'" @click="setTheme('light')">Light</button>
        <button type="button" :aria-pressed="theme === 'dark' ? 'true' : 'false'" @click="setTheme('dark')">Dark</button>
      </div>
      <button type="button" class="btn" @click="reload"><Icon name="reload" /> Reload</button>
      <a v-if="tabUrl" class="btn" :href="tabUrl" target="_blank" rel="noopener noreferrer" @click="openInTab">Open in new tab <Icon name="external" /></a>
      <button v-else type="button" class="btn" aria-disabled="true">Open in new tab <Icon name="external" /></button>
      <span class="pv-note" role="status">{{ busy ? 'Rendering…' : '' }}</span>
    </div>
    <p v-if="error" class="st st-error" role="alert" data-testid="preview-error"><Icon name="error" />{{ error }}</p>
    <div ref="stage" class="pv-stage">
      <div class="pv-box" :style="boxStyle">
        <iframe
          v-if="src"
          ref="frame"
          :src="src"
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
          title="Site preview"
          :style="frameStyle"
          @load="post"
        />
      </div>
    </div>
  </div>
</template>
