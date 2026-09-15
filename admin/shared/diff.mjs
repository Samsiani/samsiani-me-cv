// diffPaths(a, b) -> [{ path, before, after }] between two site documents, leaf by leaf.
// settings.siteUrl is ignored: the server always overwrites it with SITE_URL.
const IGNORED = new Set(['$.settings.siteUrl']);

export function diffPaths(a, b, path = '$', out = []) {
  if (IGNORED.has(path)) return out;
  const isObj = (v) => v !== null && typeof v === 'object';
  if (Array.isArray(a) || Array.isArray(b)) {
    const A = Array.isArray(a) ? a : [], B = Array.isArray(b) ? b : [];
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      if (i >= A.length) out.push({ path: `${path}[${i}]`, before: undefined, after: B[i] });
      else if (i >= B.length) out.push({ path: `${path}[${i}]`, before: A[i], after: undefined });
      else diffPaths(A[i], B[i], `${path}[${i}]`, out);
    }
    return out;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], `${path}.${k}`, out);
    return out;
  }
  if (a !== b) out.push({ path, before: a, after: b });
  return out;
}
