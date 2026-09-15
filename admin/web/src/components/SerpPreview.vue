<script setup>
// Search-result preview (admin-ops.md §6.5): title cut at 60 characters, description at 160, both approximate.
import { computed } from 'vue';

const props = defineProps({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  url: { type: String, default: '' },
  lang: { type: String, default: 'en' },
});
const cut = (s, n) => { const a = [...(s || '')]; return a.length > n ? a.slice(0, n - 1).join('').trimEnd() + '…' : a.join(''); };
const t = computed(() => cut(props.title, 60));
const d = computed(() => cut(props.description, 160));
</script>

<template>
  <div class="serp" :lang="lang">
    <span class="serp-url" lang="en">{{ url }}</span>
    <span class="serp-title">{{ t || '(no title)' }}</span>
    <span class="serp-desc">{{ d || '(no description)' }}</span>
  </div>
</template>
