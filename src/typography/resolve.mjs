// resolveFonts(site, layoutMeta, loader) -> what a build ships when the owner overrode a layout's fonts.
// Absent settings.fonts, an empty override or no loader all return NO_FONTS, and every caller then takes
// exactly the path it took before this module existed — that is the byte-identity rule of the fonts plan
// (§7.1). Everything below runs only when at least one role of the built layout names a font.
//
// The module is pure apart from the loader and the committed default faces it reads from src/fonts/ (once
// per process, cached): the same document and the same store always give the same CSS, the same file names
// and the same width estimates, so a preview is the publish.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { ALIASES, FONT_ROLES, FONT_ID_RE, isGeorgianCodePoint } from './roles.mjs';
import { metricsOf, parseFont, widthOf } from './sfnt.mjs';

const SRC_FONTS = new URL('../fonts/', import.meta.url);
const MAX_FACES_PER_ROLE = 8;
const MAX_PRELOAD = 4;
const FACE_FILE_RE = /^[0-9a-f]{64}\.(?:woff2|woff|ttf|otf)$/;
// Safety margin on every width estimate: a face drawn on Linux is wider than the same face on macOS, and
// Georgian more so (whole-pixel glyph advances). Same figures the constant estimators already carry.
export const HEADROOM = { latin: 1.06, georgian: 1.12 };

/** The answer for every build that does not override a font. Frozen: callers may hold on to it. */
export const NO_FONTS = Object.freeze({ overridden: false, css: '', files: new Map(), warnings: [] });

const sha8 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 8);
const hasGeorgian = (s) => [...String(s)].some((ch) => isGeorgianCodePoint(ch.codePointAt(0)));
// File names are built from this, so it may only ever produce [a-z0-9-]: a font's own name can never reach
// a path or a stylesheet (fonts plan D11), whatever its name table holds.
const slug = (s) => (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'font');

// ---------------------------------------------------------------- the layout's own faces
const metricsCache = new Map();
const bytesCache = new Map();
/** Metrics of a committed face under src/fonts/, parsed once per process. */
export function defaultFaceMetrics(basename) {
  if (!metricsCache.has(basename)) metricsCache.set(basename, metricsOf(parseFont(readFileSync(new URL(`${basename}.woff2`, SRC_FONTS)))));
  return metricsCache.get(basename);
}
const defaultFaceBytes = (basename) => {
  if (!bytesCache.has(basename)) bytesCache.set(basename, statSync(new URL(`${basename}.woff2`, SRC_FONTS)).size);
  return bytesCache.get(basename);
};

/** Per-role metrics of a layout's own faces — the estimator's baseline when a role keeps its default. */
export function defaultFonts(layoutMeta) {
  return Object.fromEntries(FONT_ROLES.map((role) => [role, defaultFaceMetrics(layoutMeta.fontRoles[role].files[0])]));
}

// ---------------------------------------------------------------- face selection
const weightsOf = (face) => (Array.isArray(face.weight) ? face.weight : [face.weight, face.weight]);
const isVariable = (face) => Array.isArray(face.weight) && face.weight[0] !== face.weight[1];

/**
 * The faces of `record` this role ships: a variable face covers every weight in one file, a static family
 * contributes the nearest available weight for each weight the layout asks for (fonts plan §5.3).
 */
function pickFaces(record, role, want) {
  const web = (record.faces || []).filter((f) => f.kind === 'web' && (role === 'georgian' ? f.subset === 'georgian' : f.subset !== 'georgian'));
  if (!web.length) return [];
  const variable = web.filter(isVariable);
  if (variable.length) return variable.slice(0, MAX_FACES_PER_ROLE);
  const picked = [];
  for (const w of want) {
    const near = web.reduce((a, b) => (Math.abs(weightsOf(b)[0] - w) < Math.abs(weightsOf(a)[0] - w) ? b : a));
    if (!picked.includes(near)) picked.push(near);
  }
  return picked.slice(0, MAX_FACES_PER_ROLE);
}

const faceName = (record, role, face, bytes) => {
  const [lo, hi] = weightsOf(face);
  return `fonts/${slug(record.family)}-${slug(face.subset || (role === 'georgian' ? 'georgian' : 'latin'))}-normal-${lo === hi ? lo : `${lo}-${hi}`}.${sha8(bytes)}.woff2`;
};

// ---------------------------------------------------------------- the CSS block
// A default family goes into the stack the way the layout writes it; an alias is always quoted.
const quoted = (name) => (/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ? name : `"${String(name).replace(/["\\]/g, '')}"`);

function faceRule(alias, face, href) {
  const [lo, hi] = weightsOf(face);
  return `@font-face {
  font-family: "${alias}";
  font-style: normal;
  font-weight: ${lo === hi ? lo : `${lo} ${hi}`};${face.stretch ? `\n  font-stretch: ${face.stretch};` : ''}
  font-display: swap;
  src: url('${href}') format('woff2');
  unicode-range: ${face.unicodeRange};
}`;
}

/**
 * The block appended after the layout CSS. Nothing in it comes from user input: the aliases are constants,
 * the default families come from the layout manifest, the file names are `<slug>.<hash>` and the ranges are
 * generated. A role that keeps its default is written with its own family name, so the layout's own
 * @font-face keeps serving it.
 */
function blockCss(layoutMeta, chosen, faces, extra) {
  const roles = layoutMeta.fontRoles;
  const family = (role) => (chosen[role] ? `"${ALIASES[role]}"` : quoted(roles[role].defaultFamily));
  const out = [`/* fonts: ${layoutMeta.id} · ${FONT_ROLES.map((r) => `${r}=${chosen[r] ? chosen[r].id : 'default'}`).join(' ')} */`];
  for (const role of FONT_ROLES) for (const f of faces[role]) out.push(faceRule(ALIASES[role], f.face, f.name));

  out.push(`:root { ${roles.text.var}: ${[family('text'), family('georgian'), roles.text.tail].join(', ')}; }`);
  if (roles.label.var !== roles.text.var) {
    const stack = [family('label'), ...(roles.label.georgianInStack ? [family('georgian')] : []), roles.label.tail];
    out.push(`:root { ${roles.label.var}: ${stack.join(', ')}; }`);
  }
  out.push(`html[lang="ka"] { ${roles.text.var}: ${[family('georgian'), family('text'), roles.text.kaTail].join(', ')}; }`);
  if (chosen.georgian) for (const sel of roles.georgian.extraSelectors || []) out.push(`${sel} { font-family: ${family('georgian')}, sans-serif; }`);
  return [...out, ...extra].join('\n') + '\n';
}

// ---------------------------------------------------------------- the resolver
/**
 * @param {object} site canonical site.json
 * @param {object} layoutMeta the layout manifest (needs fontRoles)
 * @param {{ get(id): object|null|Promise<object|null>, readFace(record, face): Buffer|Promise<Buffer> }|null} loader
 * @returns {Promise<typeof NO_FONTS | { overridden: true, roles, css, files, preload, metrics, bytes, warnings, width }>}
 */
export async function resolveFonts(site, layoutMeta, loader) {
  const roles = layoutMeta?.fontRoles;
  const cfg = site?.settings?.fonts?.[layoutMeta?.id];
  if (!roles || !loader || !cfg || !FONT_ROLES.some((r) => typeof cfg[r] === 'string' && cfg[r])) return NO_FONTS;

  const warnings = [];
  const chosen = { text: null, label: null, georgian: null };
  const faces = { text: [], label: [], georgian: [] };
  const files = new Map();
  const fallback = (role, msg) => warnings.push({ code: 'FONT_FALLBACK', path: `$.settings.fonts.${layoutMeta.id}.${role}`, msg });

  for (const role of FONT_ROLES) {
    const id = cfg[role];
    if (typeof id !== 'string' || !FONT_ID_RE.test(id)) continue;
    const record = await loader.get(id);
    if (!record) { fallback(role, `no font with id ${id} in the store; the layout default is used`); continue; }
    if (role === 'georgian' && record.coverage?.georgian !== true) { fallback(role, 'that font has no Georgian letters; the layout default is used'); continue; }
    const picked = pickFaces(record, role, roles[role].weights);
    if (!picked.length) { fallback(role, `that font has no ${role === 'georgian' ? 'Georgian' : 'Latin'} face to ship; the layout default is used`); continue; }
    chosen[role] = record;
    for (const face of picked) {
      const bytes = await loader.readFace(record, face);
      const name = faceName(record, role, face, bytes);
      files.set(name, bytes);
      faces[role].push({ face, name });
    }
  }
  if (!FONT_ROLES.some((r) => chosen[r])) return { ...NO_FONTS, warnings };

  // Metrics: the chosen record's for an overridden role, the layout's own file for one kept at its default.
  const metrics = Object.fromEntries(FONT_ROLES.map((r) => [r, chosen[r]?.metrics || defaultFaceMetrics(roles[r].files[0])]));
  const width = widthFn(metrics);
  const css = blockCss(layoutMeta, chosen, faces, layoutMeta.overrideCss ? layoutMeta.overrideCss({ site, width, chosen }) : []);

  // Preload and page weight: text then label on /, the Georgian face first on /ka/ (fonts plan §5.3).
  const filesOf = (role) => (faces[role].length ? faces[role].map((f) => f.name) : roles[role].files.map((f) => `fonts/${f}.woff2`));
  const order = { en: [...filesOf('text'), ...filesOf('label')], ka: [...filesOf('georgian'), ...filesOf('text'), ...filesOf('label')] };
  const weigh = (list) => list.reduce((n, p) => n + (files.get(p)?.length ?? defaultFaceBytes(p.slice('fonts/'.length, -'.woff2'.length))), 0);

  return {
    overridden: true,
    roles: Object.fromEntries(FONT_ROLES.map((r) => [r, chosen[r] ? { id: chosen[r].id, record: chosen[r], alias: ALIASES[r] } : null])),
    css,
    files,
    preload: { en: order.en.slice(0, MAX_PRELOAD), ka: order.ka.slice(0, MAX_PRELOAD) },
    metrics,
    bytes: { en: weigh(order.en), ka: weigh(order.ka) },
    warnings,
    width,
  };
}

/**
 * ctx.fonts.width(role, text, px, opts) -> estimated rendered width in CSS pixels. Latin characters are
 * measured with the role's own face and Georgian ones with the Georgian face, because the text and label
 * faces are fenced out of the Georgian ranges and never draw a Georgian letter (fonts plan D6). The headroom
 * of D7 is applied here, so a caller reads like the constant estimator it replaces.
 */
export function widthFn(metrics) {
  return (role, text, px, { weight = 400, letterSpacingEm = 0, headroom } = {}) => {
    const m = { latin: metrics[role]?.latin ?? null, georgian: metrics.georgian?.georgian ?? null };
    return widthOf(m, text, px, { weight, letterSpacingEm, headroom: headroom ?? (hasGeorgian(text) ? HEADROOM.georgian : HEADROOM.latin) });
  };
}

/**
 * A loader over a font store directory (`index.json` + `files/<sha>.<ext>`), for build.mjs FONTS_DIR and the
 * tests; the admin passes its own store instead. A face is addressed by its content hash only, never by a
 * name that came out of a font file.
 */
export function fileLoader(dir) {
  const root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  let index;
  const load = () => (index ??= JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')));
  return {
    get: (id) => (typeof id === 'string' && FONT_ID_RE.test(id) && load().fonts?.[id]) || null,
    readFace: (record, face) => {
      if (!FACE_FILE_RE.test(String(face?.file))) throw new Error('unsafe font face file name');
      return readFileSync(join(root, 'files', face.file));
    },
  };
}
