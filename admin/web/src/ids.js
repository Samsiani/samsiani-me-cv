// New list-item ids (data-model.md §3.8): 8 random lowercase base36 characters from
// crypto.getRandomValues, retried on a collision inside the same list. Ids never change afterwards.
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomId(length = 8) {
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b >= 252) continue; // 252 = 7 × 36: rejection sampling keeps every character equally likely
      out += ALPHABET[b % 36];
      if (out.length === length) break;
    }
  }
  return out;
}

/** @param {Array<{ id?: string }>} list  the list the new item joins */
export function newId(list = []) {
  const taken = new Set(list.map((item) => item && item.id));
  for (;;) {
    const id = randomId();
    if (!taken.has(id)) return id;
  }
}
