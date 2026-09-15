<script setup>
// Errors and warnings with their message; with `linked`, each one links to the input named by its $.path.
import Icon from './Icon.vue';
import { focusPath, labelFor } from '../fields.js';

const props = defineProps({
  issues: { type: Array, default: () => [] },
  id: { type: String, default: undefined },
  linked: { type: Boolean, default: false },
});
const emit = defineEmits(['navigate']);

const where = (p) => {
  const m = /\.(en|ka)$/.exec(p);
  return `${labelFor(p.replace(/\.(en|ka)$/, ''))}${m ? ` (${m[1].toUpperCase()})` : ''}`;
};
function go(path) {
  emit('navigate', path);
  focusPath(path);
}
</script>

<template>
  <ul v-if="issues.length" :id="id" class="issues">
    <li v-for="(i, n) in issues" :key="n + i.path + i.code" :class="i.level === 'error' ? 'issue-error' : 'issue-warning'">
      <Icon :name="i.level === 'error' ? 'error' : 'warn'" />
      <span v-if="!linked"><span class="sr-only">{{ i.level === 'error' ? 'Error' : 'Warning' }}: </span>{{ i.msg }}</span>
      <button v-else type="button" class="issue-link" @click="go(i.path)">
        <span class="sr-only">{{ i.level === 'error' ? 'Error' : 'Warning' }}: </span>{{ where(i.path) }}: {{ i.msg }}
      </button>
    </li>
  </ul>
</template>
