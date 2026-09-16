// Font file reader for TTF, OTF, WOFF and WOFF2, plus the null-transform WOFF2 writer. Zero dependencies:
// node:zlib supplies Brotli (WOFF2) and inflate (WOFF). Uploaded files reach this module through the admin,
// so nothing here trusts its input: every read is bounds-checked, every count is capped, and a malformed
// file raises FontParseError(reason) instead of a RangeError out of a Buffer read.
//
// Only the tables the fonts plan needs are read — cmap (formats 4 and 12), head, hhea, hmtx, maxp, name,
// OS/2, post, fvar. WOFF2 transforms none of them except hmtx, and that transform keeps every advance
// width, so a transformed glyf/loca is carried around as opaque bytes and never reconstructed.
//
// References: OpenType 1.9 (sfnt directory, cmap, head, hhea, hmtx, maxp, name, OS/2, post, fvar),
// https://www.w3.org/TR/WOFF/ §3 (container, per-table zlib) and https://www.w3.org/TR/WOFF2/ §4-§5
// (header, UIntBase128, the 63 known tags, transform flags, one Brotli stream holding the tables back to
// back with no padding, and a file whose blocks — the last one included — end on a four-byte boundary).

import { brotliCompressSync, brotliDecompressSync, constants as ZLIB, inflateSync } from 'node:zlib';

// ---------------------------------------------------------------- limits and errors
const MAX_TABLES = 64; // a font with more tables than this is refused, not walked
const MAX_GLYPHS = 65535;
const MAX_SFNT = 32 * 1024 * 1024; // decompressed font bytes; also caps Brotli and inflate output
const MAX_CMAP = 200_000; // character -> glyph writes; bounds both memory and the mapping loops
const MAX_SUBTABLES = 64;
const MAX_GROUPS = 200_000; // cmap format 12 groups
const MAX_NAMES = 4096;
const MAX_AXES = 64;
const MAX_RANGES = 64; // unicode-range entries emitted by rangesOf()

/** Anything structurally wrong with a font file. `reason` is the short code the admin turns into a message. */
export class FontParseError extends Error {
  constructor(reason, detail) {
    super(detail || reason);
    this.name = 'FontParseError';
    this.reason = reason; // format | tables | cmap | glyphs | metrics | name | size
  }
}
const fail = (reason, detail) => { throw new FontParseError(reason, detail); };

// Bounds-checked reads: `at` is the only place an offset meets the buffer length.
const at = (b, o, n, what) => {
  if (!Number.isInteger(o) || o < 0 || n < 0 || o + n > b.length) fail('tables', `${what} out of bounds (${o}+${n} > ${b.length})`);
  return o;
};
const u8 = (b, o, w = 'byte') => b[at(b, o, 1, w)];
const u16 = (b, o, w = 'uint16') => b.readUInt16BE(at(b, o, 2, w));
const i16 = (b, o, w = 'int16') => b.readInt16BE(at(b, o, 2, w));
const u32 = (b, o, w = 'uint32') => b.readUInt32BE(at(b, o, 4, w));
const i32 = (b, o, w = 'int32') => b.readInt32BE(at(b, o, 4, w));
const tag4 = (b, o, w = 'tag') => b.toString('latin1', at(b, o, 4, w), o + 4);
const fixed = (b, o, w) => Math.round((i32(b, o, w) / 65536) * 1000) / 1000; // 16.16 -> 3 decimals
const pad4 = (n) => (n + 3) & ~3;
const r3 = (x) => Math.round(x * 1000) / 1000;
// A name record may carry control characters; they never belong in a family name.
const printable = (s) => [...s].filter((c) => c.codePointAt(0) >= 0x20 && c.codePointAt(0) !== 0x7f).join('').trim();

const SFNT_TTF = 0x00010000, SFNT_TRUE = 0x74727565, SFNT_OTTO = 0x4f54544f, SFNT_TTCF = 0x74746366;
const REQUIRED = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2'];
const OUTLINES = ['glyf', 'CFF ', 'CFF2']; // a font with none of these is a bitmap/SVG-only file

/** Magic-byte sniff, for the upload route's first gate. Returns null for anything else. */
export function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  const m = buf.toString('latin1', 0, 4);
  if (m === 'wOF2') return 'woff2';
  if (m === 'wOFF') return 'woff';
  if (m === 'OTTO') return 'otf';
  if (m === 'true' || buf.readUInt32BE(0) === SFNT_TTF) return 'ttf';
  return null;
}

// ---------------------------------------------------------------- WOFF2 container
// WOFF2 §5.2: table tags 0..62 are known; flag value 63 means a four-character tag follows.
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx',
  'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ',
  'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar',
  'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc',
  'Feat', 'Sill',
];
// glyf and loca carry the default (glyph) transform unless the version is 3; every other table is
// untransformed at version 0. Only hmtx defines a non-null transform (version 1), and it keeps the advances.
const isTransformed = (tag, version) => (tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0);

function readBase128(b, o) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const c = u8(b, o + i, 'UIntBase128');
    if (i === 0 && c === 0x80) fail('format', 'UIntBase128 with a leading zero byte');
    if (v & 0xfe000000) fail('format', 'UIntBase128 larger than 32 bits');
    v = ((v << 7) | (c & 0x7f)) >>> 0;
    if (!(c & 0x80)) return [v, o + i + 1];
  }
  return fail('format', 'UIntBase128 longer than five bytes');
}

function writeBase128(n) {
  const out = [];
  let v = n;
  do { out.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v > 0);
  for (let i = 0; i < out.length - 1; i++) out[i] |= 0x80;
  return Buffer.from(out);
}

/**
 * Decode a WOFF2 container into its tables, in directory order. Transformed tables keep their transformed
 * bytes (`transformed: true`); glyf/loca are never reconstructed, hmtx is read by readAdvances() as it is.
 * @returns {{ sfntVersion: number, tables: { tag, data, transformed, origLength }[] }}
 */
export function unwrapWoff2(buf) {
  if (buf.length < 48) fail('format', 'shorter than a WOFF2 header');
  if (tag4(buf, 0) !== 'wOF2') fail('format', 'not a WOFF2 file');
  const sfntVersion = u32(buf, 4, 'flavor');
  if (sfntVersion === SFNT_TTCF) fail('format', 'font collections are not supported');
  if (u32(buf, 8, 'length') !== buf.length) fail('format', 'the header length is not the file size');
  const numTables = u16(buf, 12, 'numTables');
  const totalSfntSize = u32(buf, 16, 'totalSfntSize');
  const totalCompressedSize = u32(buf, 20, 'totalCompressedSize');
  if (numTables < 1 || numTables > MAX_TABLES) fail('tables', `${numTables} tables (1 to ${MAX_TABLES} allowed)`);
  if (totalSfntSize > MAX_SFNT) fail('size', `totalSfntSize ${totalSfntSize} is above the ${MAX_SFNT} byte cap`);

  let o = 48;
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = u8(buf, o++, 'table flags');
    const idx = flags & 0x3f;
    let tag;
    if (idx === 63) { tag = tag4(buf, o, 'table tag'); o += 4; } else tag = KNOWN_TAGS[idx];
    let origLength, length;
    [origLength, o] = readBase128(buf, o);
    const transformed = isTransformed(tag, flags >> 6);
    if (transformed) [length, o] = readBase128(buf, o); else length = origLength;
    if (origLength > totalSfntSize || length > totalSfntSize) fail('size', `${tag} is larger than the whole font`);
    dir.push({ tag, data: null, transformed, origLength, length });
  }

  const comp = buf.subarray(at(buf, o, totalCompressedSize, 'compressed table data'), o + totalCompressedSize);
  let raw;
  try {
    raw = brotliDecompressSync(comp, { maxOutputLength: Math.min(totalSfntSize, MAX_SFNT) });
  } catch (e) {
    // ERR_BUFFER_TOO_LARGE is the cap biting: the stream claims to hold more than totalSfntSize.
    fail(e.code === 'ERR_BUFFER_TOO_LARGE' ? 'size' : 'format', `the Brotli stream does not decode (${e.message})`);
  }
  // WOFF2 §5.4: the tables follow one another in the decompressed stream with no padding.
  const total = dir.reduce((n, t) => n + t.length, 0);
  if (raw.length < total) fail('size', `the tables need ${total} bytes, the Brotli stream gave ${raw.length}`);
  let p = 0;
  for (const t of dir) { t.data = raw.subarray(p, p + t.length); p += t.length; }
  return { sfntVersion, tables: dir };
}

/**
 * Wrap a TTF, OTF or WOFF into a WOFF2 with null transforms (glyf/loca transform version 3), Brotli
 * quality 11 in font mode. The table bytes are copied untouched, so any reader — this one included —
 * gets the same tables back. DSIG is dropped: the signature cannot survive a repacked sfnt.
 */
export function wrapWoff2(buf) {
  const { sfntVersion, tables } = readContainer(buf, { allowWoff2: false });
  const keep = tables.filter((t) => t.tag !== 'DSIG').sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  if (!keep.length) fail('tables', 'no tables to wrap');
  // Tag order with loca pulled in behind glyf: the layout every file from Google has, and the one a decoder
  // that expects the pair adjacent (the reference decoder does, for the transformed case) is happy with.
  const g = keep.findIndex((t) => t.tag === 'glyf'), l = keep.findIndex((t) => t.tag === 'loca');
  if (g >= 0 && l > g + 1) keep.splice(g + 1, 0, ...keep.splice(l, 1));
  const dir = keep.map((t) => {
    const idx = KNOWN_TAGS.indexOf(t.tag);
    const version = t.tag === 'glyf' || t.tag === 'loca' ? 3 : 0; // 3 = null transform for glyf/loca
    const head = Buffer.from([(version << 6) | (idx < 0 ? 63 : idx)]);
    return Buffer.concat(idx < 0 ? [head, Buffer.from(t.tag, 'latin1'), writeBase128(t.data.length)] : [head, writeBase128(t.data.length)]);
  });
  const body = brotliCompressSync(Buffer.concat(keep.map((t) => t.data)), {
    params: {
      [ZLIB.BROTLI_PARAM_QUALITY]: 11,
      [ZLIB.BROTLI_PARAM_MODE]: ZLIB.BROTLI_MODE_FONT,
      [ZLIB.BROTLI_PARAM_SIZE_HINT]: keep.reduce((n, t) => n + t.data.length, 0),
    },
  });
  // WOFF2 §3: every block starts on a four-byte boundary, so the compressed block is padded out to one —
  // a decoder rejects the file when Round4(compressedOffset + compressedSize) runs past `length`.
  const size = 48 + dir.reduce((n, d) => n + d.length, 0) + body.length;
  const header = Buffer.alloc(48); // meta and priv blocks stay absent, so their five fields stay zero
  header.write('wOF2', 0, 'latin1');
  header.writeUInt32BE(sfntVersion, 4);
  header.writeUInt32BE(pad4(size), 8); // length, padding included
  header.writeUInt16BE(keep.length, 12);
  header.writeUInt32BE(12 + 16 * keep.length + keep.reduce((n, t) => n + pad4(t.data.length), 0), 16); // totalSfntSize
  header.writeUInt32BE(body.length, 20);
  header.writeUInt16BE(1, 24); // majorVersion
  return Buffer.concat([header, ...dir, body, Buffer.alloc(pad4(size) - size)]);
}

// ---------------------------------------------------------------- sfnt and WOFF containers
function readSfnt(buf) {
  const v = u32(buf, 0, 'sfntVersion');
  if (v === SFNT_TTCF) fail('format', 'font collections are not supported');
  if (v !== SFNT_TTF && v !== SFNT_OTTO && v !== SFNT_TRUE) fail('format', 'not a TrueType or OpenType font');
  const n = u16(buf, 4, 'numTables');
  if (n < 1 || n > MAX_TABLES) fail('tables', `${n} tables (1 to ${MAX_TABLES} allowed)`);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + 16 * i;
    const tag = tag4(buf, o, 'table tag');
    const off = u32(buf, o + 8, `${tag} offset`), len = u32(buf, o + 12, `${tag} length`);
    tables.push({ tag, data: buf.subarray(at(buf, off, len, `table ${tag}`), off + len), transformed: false });
  }
  return { flavor: v === SFNT_OTTO ? 'otf' : 'ttf', sfntVersion: v, tables };
}

function readWoff(buf) {
  if (buf.length < 44) fail('format', 'shorter than a WOFF header');
  const sfntVersion = u32(buf, 4, 'flavor');
  if (sfntVersion === SFNT_TTCF) fail('format', 'font collections are not supported');
  if (u32(buf, 8, 'length') !== buf.length) fail('format', 'the header length is not the file size');
  const n = u16(buf, 12, 'numTables');
  if (n < 1 || n > MAX_TABLES) fail('tables', `${n} tables (1 to ${MAX_TABLES} allowed)`);
  const tables = [];
  let bytes = 0;
  for (let i = 0; i < n; i++) {
    const o = 44 + 20 * i;
    const tag = tag4(buf, o, 'table tag');
    const off = u32(buf, o + 4, `${tag} offset`), comp = u32(buf, o + 8, `${tag} compLength`), orig = u32(buf, o + 12, `${tag} origLength`);
    bytes += orig;
    if (orig > MAX_SFNT || bytes > MAX_SFNT) fail('size', `${tag} is above the ${MAX_SFNT} byte cap`);
    const raw = buf.subarray(at(buf, off, comp, `table ${tag}`), off + comp);
    let data = raw;
    if (comp < orig) {
      try { data = inflateSync(raw, { maxOutputLength: orig }); } catch (e) { fail('format', `${tag} does not inflate (${e.message})`); }
    }
    if (data.length !== orig) fail('format', `${tag} is ${data.length} bytes, the directory says ${orig}`);
    tables.push({ tag, data, transformed: false });
  }
  return { flavor: 'woff', sfntVersion, tables };
}

function readContainer(buf, { allowWoff2 = true } = {}) {
  if (!Buffer.isBuffer(buf)) {
    if (!ArrayBuffer.isView(buf)) fail('format', 'not a Buffer');
    buf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (buf.length < 12) fail('format', 'too short to be a font file');
  if (buf.length > MAX_SFNT) fail('size', `${buf.length} bytes is above the ${MAX_SFNT} byte cap`);
  const kind = sniff(buf);
  if (kind === 'woff2') {
    if (!allowWoff2) fail('format', 'a WOFF2 file is already compressed; ship its bytes as they are');
    const { sfntVersion, tables } = unwrapWoff2(buf);
    return { flavor: 'woff2', sfntVersion, tables };
  }
  if (kind === 'woff') return readWoff(buf);
  if (kind) return readSfnt(buf);
  return fail('format', 'not a TTF, OTF, WOFF or WOFF2 file');
}

// ---------------------------------------------------------------- tables
function readNames(b) {
  const count = u16(b, 2, 'name count');
  if (count > MAX_NAMES) fail('name', `${count} name records`);
  const strings = u16(b, 4, 'name stringOffset');
  const best = new Map(); // nameID -> { score, text }; Windows US-English wins, then any Unicode record
  for (let i = 0; i < count; i++) {
    const o = 6 + 12 * i;
    const platform = u16(b, o, 'name platformID'), lang = u16(b, o + 4, 'name languageID'), id = u16(b, o + 6, 'name nameID');
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
    const len = u16(b, o + 8, 'name length'), off = u16(b, o + 10, 'name offset');
    const raw = b.subarray(at(b, strings + off, len, 'name string'), strings + off + len);
    let text = '';
    if (platform === 3 || platform === 0) { if (len % 2 === 0) text = Buffer.from(raw).swap16().toString('utf16le'); }
    else if (platform === 1) text = raw.toString('latin1');
    text = printable(text);
    if (!text) continue;
    const score = platform === 3 && lang === 0x409 ? 3 : platform === 3 || platform === 0 ? 2 : 1;
    const cur = best.get(id);
    if (!cur || score > cur.score) best.set(id, { score, text });
  }
  const pick = (...ids) => { for (const id of ids) { const v = best.get(id); if (v) return v.text; } return ''; };
  // ID 16/17 are the typographic family and subfamily: "Noto Sans Georgian" + "SemiBold", not "… SemiBold" + "Regular".
  return { family: pick(16, 1), subfamily: pick(17, 2), full: pick(4, 1), postscript: pick(6) };
}

function put(ctx, cp, glyph) {
  if (++ctx.n > MAX_CMAP) fail('cmap', `more than ${MAX_CMAP} character mappings`);
  if (glyph) ctx.map.set(cp, glyph);
}

function readCmap4(b, o, ctx) {
  const segX2 = u16(b, o + 6, 'cmap4 segCountX2');
  if (segX2 < 2 || segX2 % 2) fail('cmap', `cmap format 4 segCountX2 ${segX2}`);
  const seg = segX2 / 2;
  const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, offsets = deltas + segX2;
  at(b, offsets, segX2, 'cmap4 idRangeOffset');
  for (let i = 0; i < seg; i++) {
    const end = u16(b, ends + 2 * i), start = u16(b, starts + 2 * i);
    const delta = i16(b, deltas + 2 * i), range = u16(b, offsets + 2 * i);
    if (start > end || start === 0xffff) continue; // the 0xFFFF terminator maps nothing
    for (let c = start; c <= end; c++) {
      let g;
      if (range === 0) g = (c + delta) & 0xffff;
      else {
        g = u16(b, offsets + 2 * i + range + 2 * (c - start), 'cmap4 glyph id');
        if (g) g = (g + delta) & 0xffff;
      }
      put(ctx, c, g);
    }
  }
}

function readCmap12(b, o, ctx) {
  const groups = u32(b, o + 12, 'cmap12 nGroups');
  if (groups > MAX_GROUPS) fail('cmap', `cmap format 12 with ${groups} groups`);
  for (let i = 0; i < groups; i++) {
    const p = o + 16 + 12 * i;
    const start = u32(b, p, 'cmap12 startCharCode'), end = u32(b, p + 4, 'cmap12 endCharCode'), gid = u32(b, p + 8, 'cmap12 startGlyphID');
    if (end < start || end > 0x10ffff) continue;
    for (let c = start; c <= end; c++) put(ctx, c, gid + (c - start));
  }
}

function readCmap(b) {
  const n = u16(b, 2, 'cmap numTables');
  if (n < 1 || n > MAX_SUBTABLES) fail('cmap', `${n} cmap subtables`);
  const subs = [];
  for (let i = 0; i < n; i++) {
    const o = 4 + 8 * i;
    subs.push({ platform: u16(b, o, 'cmap platformID'), encoding: u16(b, o + 2, 'cmap encodingID'), offset: u32(b, o + 4, 'cmap subtable offset') });
  }
  // Unicode subtables only (a 3/0 symbol cmap maps the private use area and would lie about coverage).
  const rank = (s) => ((s.platform === 3 && s.encoding === 10) || (s.platform === 0 && s.encoding >= 4) ? 3
    : s.platform === 3 && s.encoding === 1 ? 2 : s.platform === 0 ? 1 : 0);
  const ctx = { map: new Map(), n: 0 };
  for (const s of subs.filter(rank).sort((a, b2) => rank(a) - rank(b2))) { // best last: it overwrites the rest
    const format = u16(b, s.offset, 'cmap subtable format');
    if (format === 4) readCmap4(b, s.offset, ctx);
    else if (format === 12) readCmap12(b, s.offset, ctx);
  }
  if (!ctx.map.size) fail('cmap', 'no usable Unicode cmap subtable (formats 4 and 12 are read)');
  return ctx.map;
}

function readAdvances(b, transformed, numberOfHMetrics, numGlyphs) {
  if (numberOfHMetrics < 1 || numberOfHMetrics > numGlyphs) fail('metrics', `numberOfHMetrics ${numberOfHMetrics} for ${numGlyphs} glyphs`);
  const adv = new Uint16Array(numberOfHMetrics);
  if (transformed) {
    // WOFF2 §5.3: the hmtx transform may drop the side-bearing arrays, never the advance widths.
    const flags = u8(b, 0, 'hmtx transform flags');
    if (flags & 0xfc) fail('metrics', `unknown hmtx transform flags 0x${flags.toString(16)}`);
    for (let i = 0; i < numberOfHMetrics; i++) adv[i] = u16(b, 1 + 2 * i, 'hmtx advance');
  } else {
    for (let i = 0; i < numberOfHMetrics; i++) adv[i] = u16(b, 4 * i, 'hmtx advance');
  }
  return adv;
}

function readFvar(b) {
  const array = u16(b, 4, 'fvar axesArrayOffset');
  const count = u16(b, 8, 'fvar axisCount'), size = u16(b, 10, 'fvar axisSize');
  if (count < 1 || count > MAX_AXES) fail('format', `fvar axisCount ${count}`);
  if (size < 20) fail('format', `fvar axisSize ${size}`);
  const axes = [];
  for (let i = 0; i < count; i++) {
    const o = array + i * size;
    axes.push({ tag: tag4(b, o, 'fvar axis tag'), min: fixed(b, o + 4, 'fvar minValue'), default: fixed(b, o + 8, 'fvar defaultValue'), max: fixed(b, o + 12, 'fvar maxValue') });
  }
  return { axes };
}

// ---------------------------------------------------------------- the reader
/**
 * Parse a font file into the tables this site needs.
 * @returns {{ flavor, tables: Map<string, Buffer>, transformed: Set<string>, names, weightClass, italic,
 *   fixedPitch, unitsPerEm, ascender, descender, xHeight, capHeight, numGlyphs, fvar, cmap: Map<number, number>,
 *   advance: (glyph: number) => number }}
 */
export function parseFont(buf) {
  const { flavor, tables: list } = readContainer(buf);
  const tables = new Map();
  for (const t of list) {
    if (tables.has(t.tag)) fail('tables', `duplicate table ${t.tag}`);
    if (!/^[\x20-\x7e]{4}$/.test(t.tag)) fail('tables', 'a table tag is not four printable characters');
    tables.set(t.tag, t);
  }
  for (const tag of REQUIRED) if (!tables.has(tag)) fail('tables', `no ${tag} table`);
  if (!OUTLINES.some((tag) => tables.has(tag))) fail('tables', 'no glyf, CFF or CFF2 outlines');
  const data = (tag) => tables.get(tag).data;

  const head = data('head');
  if (u32(head, 12, 'head magicNumber') !== 0x5f0f3cf5) fail('format', 'the head table magic number is wrong');
  const unitsPerEm = u16(head, 18, 'unitsPerEm');
  if (unitsPerEm < 16 || unitsPerEm > 16384) fail('metrics', `unitsPerEm ${unitsPerEm} (16 to 16384 allowed)`);
  const macStyle = u16(head, 44, 'macStyle');

  const numGlyphs = u16(data('maxp'), 4, 'numGlyphs');
  if (numGlyphs < 2) fail('glyphs', `${numGlyphs} glyphs`);
  if (numGlyphs > MAX_GLYPHS) fail('glyphs', `${numGlyphs} glyphs (${MAX_GLYPHS} allowed)`);

  const hhea = data('hhea');
  const advances = readAdvances(data('hmtx'), tables.get('hmtx').transformed, u16(hhea, 34, 'numberOfHMetrics'), numGlyphs);

  const os2 = data('OS/2');
  const os2Version = u16(os2, 0, 'OS/2 version');
  const fsSelection = u16(os2, 62, 'fsSelection');
  const panose = u8(os2, 35, 'panose bProportion'); // OS/2 + 32 is panose[0]; [3] is bProportion (9 = monospaced)
  const post = tables.get('post');

  return {
    flavor,
    tables: new Map([...tables].map(([tag, t]) => [tag, t.data])),
    transformed: new Set([...tables].filter(([, t]) => t.transformed).map(([tag]) => tag)),
    names: readNames(data('name')),
    weightClass: u16(os2, 4, 'usWeightClass'),
    italic: Boolean((fsSelection & 0x01) || (macStyle & 0x02)),
    fixedPitch: Boolean(post && u32(post.data, 12, 'post isFixedPitch')) || panose === 9,
    unitsPerEm,
    ascender: i16(hhea, 4, 'ascender'),
    descender: i16(hhea, 6, 'descender'),
    xHeight: os2Version >= 2 ? i16(os2, 86, 'sxHeight') : null,
    capHeight: os2Version >= 2 ? i16(os2, 88, 'sCapHeight') : null,
    numGlyphs,
    fvar: tables.has('fvar') ? readFvar(data('fvar')) : null,
    cmap: readCmap(data('cmap')),
    advance: (glyph) => advances[glyph >= 0 && glyph < advances.length ? glyph : advances.length - 1],
  };
}

// ---------------------------------------------------------------- coverage, metrics, ranges
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
export const MKHEDRULI = range(0x10d0, 0x10f0); // ა to ჰ: the 33 letters the site writes, never uppercased
const LATIN_LETTERS = [...range(0x41, 0x5a), ...range(0x61, 0x7a)];
const DIGITS = range(0x30, 0x39);
const ASCII = range(0x20, 0x7e); // the 95 printable ASCII characters
const GEORGIAN_CHARS = [...MKHEDRULI, 0x0589];
/** The css2 georgian subset range, the same one every layout's fonts.css declares. */
export const GEORGIAN_RANGE = [[0x0589, 0x0589], [0x10a0, 0x10ff], [0x1c90, 0x1cba], [0x1cbd, 0x1cbf], [0x205a, 0x205a], [0x2d00, 0x2d2f], [0x2e31, 0x2e31]];
const isGeorgian = (cp) => GEORGIAN_RANGE.some(([a, b]) => cp >= a && cp <= b);

/** `latin` = every a-z A-Z 0-9; `georgian` = all 33 Mkhedruli letters. `counts` is what the admin shows. */
export function coverageOf(font) {
  const n = (cps) => cps.reduce((k, cp) => k + (font.cmap.has(cp) ? 1 : 0), 0);
  const counts = { latin: n(LATIN_LETTERS), digits: n(DIGITS), mkhedruli: n(MKHEDRULI) };
  return { latin: counts.latin === LATIN_LETTERS.length && counts.digits === DIGITS.length, georgian: counts.mkhedruli === MKHEDRULI.length, counts };
}

/**
 * Advance widths in em for the default instance, per script, plus the vertical metrics. `adv` holds the 95
 * printable ASCII and the 33 Mkhedruli letters plus U+0589, minus whatever the font does not map; `mean` is
 * the average over the ASCII and over the 33 letters respectively. A script with no characters at all is null.
 */
export function metricsOf(font) {
  const script = (cps, letters = cps) => {
    const adv = {};
    let sum = 0, n = 0;
    for (const cp of cps) {
      const glyph = font.cmap.get(cp);
      if (glyph === undefined) continue;
      const em = font.advance(glyph) / font.unitsPerEm;
      adv[String.fromCodePoint(cp)] = r3(em);
      if (letters.includes(cp)) { sum += em; n++; }
    }
    return n ? { mean: r3(sum / n), adv } : null;
  };
  return {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    xHeight: font.xHeight,
    capHeight: font.capHeight,
    latin: script(ASCII),
    georgian: script(GEORGIAN_CHARS, MKHEDRULI), // U+0589 is measurable but far too narrow to average in
  };
}

const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');

/**
 * The font's coverage as a `unicode-range` list, at most MAX_RANGES entries (the smallest gaps are swallowed
 * first, so a fenced face never loses a character it can draw). `excludeGeorgian` drops GEORGIAN_RANGE, which
 * is how a text or label face is kept off Georgian text.
 */
export function rangesOf(font, { excludeGeorgian = false, max = MAX_RANGES } = {}) {
  const cps = [...font.cmap.keys()].filter((cp) => !(excludeGeorgian && isGeorgian(cp))).sort((a, b) => a - b);
  if (!cps.length) return [];
  let runs = [[cps[0], cps[0]]];
  for (const cp of cps) {
    const last = runs[runs.length - 1];
    if (cp <= last[1] + 1) last[1] = cp; else runs.push([cp, cp]);
  }
  if (runs.length > max) {
    // Swallow the (runs - max) smallest gaps in one pass: closing a gap costs one entry, so exactly max remain.
    const gaps = runs.slice(0, -1).map((r, i) => [runs[i + 1][0] - r[1], i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const close = new Set(gaps.slice(0, runs.length - max).map(([, i]) => i));
    const merged = [];
    runs.forEach((r, i) => (close.has(i - 1) ? (merged[merged.length - 1][1] = r[1]) : merged.push([...r])));
    runs = merged;
  }
  return runs.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`));
}

/**
 * Estimated width in CSS pixels of `text` set in `px` from a metrics record. Georgian characters are measured
 * with the georgian metrics and everything else with the latin ones; an unmapped character costs that script's
 * mean. The weight factor stands in for a heavier instance of a variable face (clamped 0.9 to 1.2); `headroom`
 * is the caller's safety margin (the layouts use 1.06 for Latin and 1.12 for Georgian).
 */
export function widthOf(metrics, text, px, { weight = 400, letterSpacingEm = 0, headroom = 1 } = {}) {
  const factor = Math.min(1.2, Math.max(0.9, 1 + (0.035 * (weight - 400)) / 100));
  let em = 0;
  for (const ch of String(text)) {
    const m = (isGeorgian(ch.codePointAt(0)) && metrics.georgian) || metrics.latin || metrics.georgian;
    em += (m && (m.adv[ch] ?? m.mean)) ?? 0.5;
    em += letterSpacingEm; // CSS adds the spacing after every character, the last one included
  }
  return em * px * factor * headroom;
}
