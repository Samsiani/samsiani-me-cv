// Schema migrations for site.json. Zero dependencies, pure: no fs, no clock, no randomness.
// One step per version bump; documents are upgraded on read everywhere they enter the system (a revision, a
// build's .site.json, a backup, an export, an offline copy). Plan: docs/plans/content-editing.md §3.3.
import { SCHEMA_VERSION, SECTION_KEYS } from './validate.mjs';

export { SCHEMA_VERSION };

// v1 -> v2: sections can be hidden and reordered. No line is removed and no value changes, so a migrated
// document renders exactly the bytes it rendered at v1.
function v1v2(site) {
  site.schemaVersion = 2;
  if (site.settings && typeof site.settings === 'object') site.settings.sectionOrder = [...SECTION_KEYS];
  for (const k of SECTION_KEYS) {
    const sec = site.sections?.[k];
    if (sec && typeof sec === 'object') sec.hidden = false;
  }
}

const STEPS = [v1v2]; // STEPS[n] upgrades a document at version n + 1 to n + 2

/** True when the document carries a version this release knows how to bring to SCHEMA_VERSION. */
export const canMigrate = (site) =>
  Number.isInteger(site?.schemaVersion) && site.schemaVersion >= 1 && site.schemaVersion <= SCHEMA_VERSION;

/**
 * Upgrade a document to SCHEMA_VERSION. Returns a new document (structuredClone); idempotent at the current
 * version. Throws for a version this release does not know (junk, or a document written by a newer release).
 * @returns {{ site: object, from: number, to: number }}
 */
export function migrateSite(site) {
  if (!canMigrate(site)) throw new Error(`migrateSite: unknown schemaVersion ${JSON.stringify(site?.schemaVersion)}`);
  const from = site.schemaVersion;
  const out = structuredClone(site);
  for (let v = from; v < SCHEMA_VERSION; v++) STEPS[v - 1](out);
  return { site: out, from, to: SCHEMA_VERSION };
}

/**
 * Upgrade on read. A document at a known version is upgraded; anything else is passed through unchanged so
 * that the validator reports it (ENUM on schemaVersion) instead of the reader throwing.
 */
export const upgrade = (site) => (canMigrate(site) ? migrateSite(site).site : site);
