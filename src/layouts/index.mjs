// Layout registry. A layout = { meta (layout.mjs), renderBody (template.mjs) } + CSS files listed in meta.css.
// settings.layout is validated against Object.keys(LAYOUTS), so a layout exists for the admin only once it is registered here.
import precision from './precision/layout.mjs';
import { renderBody as precisionBody } from './precision/template.mjs';
import studio from './studio/layout.mjs';
import { renderBody as studioBody } from './studio/template.mjs';

export const LAYOUTS = {
  precision: { meta: precision, renderBody: precisionBody },
  studio: { meta: studio, renderBody: studioBody },
  // ledger: { meta: ledger, renderBody: ledgerBody },   // added by the Ledger plan
};
