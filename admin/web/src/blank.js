// New list items from the schema (buildSchema() via GET /registry): a new id, empty strings (stored in the
// draft and flagged EMPTY until filled), null for optional pairs, and only values that are structurally valid
// (a year, the first enum value), because structural errors would stop the autosave.
import { newId } from './ids.js';
import { todayTbilisi } from './state/draft.js';

export function blank(spec, siblings = []) {
  switch (spec.t) {
    case 'obj': {
      const out = {};
      for (const [k, s] of Object.entries(spec.shape)) out[k] = s.t === 'id' ? newId(siblings) : blank(s);
      return out;
    }
    case 'lstr': return spec.optional ? null : { en: '', ka: '' };
    case 'str': return spec.nullable ? null : '';
    case 'enum': return spec.values[0];
    case 'int': {
      if (spec.nullable) return null;
      const y = Number(todayTbilisi().slice(0, 4));
      return Math.min(spec.max ?? y, Math.max(spec.min ?? y, y));
    }
    case 'bool': return false;
    case 'arr': {
      const list = [];
      for (let i = 0; i < (spec.min || 0); i++) list.push(blank(spec.item, list));
      return list;
    }
    case 'id': return newId(siblings);
    default: return null;
  }
}
