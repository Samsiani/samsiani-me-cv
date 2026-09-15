// Inline <head> script: adds html.js and applies the theme before first paint.
// Precedence: ?theme= URL param > visitor's stored choice > settings.defaultTheme (light|dark)
//             > the layout's defaultTheme > OS preference.
// An effective theme of "system" emits byte-for-byte the script shipped before the refactor.

/** settings.defaultTheme wins when it is explicit; otherwise the layout's own default (Studio: dark). */
export const effectiveTheme = (setting, layoutMeta = {}) =>
  setting === 'light' || setting === 'dark' ? setting : layoutMeta.defaultTheme ?? 'system';

export function themeInitScript(defaultTheme = 'system') {
  const d = defaultTheme === 'light' || defaultTheme === 'dark' ? defaultTheme : null;
  const fallback = d ? `if(t!=='dark'&&t!=='light'){t='${d}'}` : '';
  const onError = d ? `d.dataset.theme='${d}'` : '';
  return `<script>(function(){var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('theme');var m=location.search.match(/[?&]theme=(light|dark)/);if(m){t=m[1]}${fallback}if(t==='dark'||t==='light'){d.dataset.theme=t}}catch(e){${onError}}})();</script>`;
}
