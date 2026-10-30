// Checks every data/*.json location file for structural mistakes.
// Usage: node scripts/validate-data.mjs   (exits 1 on errors)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];
const dataDir = new URL('../data/', import.meta.url).pathname;

export function validateLocation(loc) {
  const errors = [];
  const err = (msg) => errors.push(`${loc.id ?? '?'}: ${msg}`);
  if (!loc.id || !loc.name) err('missing id or name');
  if (!['water', 'lava'].includes(loc.liquid)) err(`bad liquid "${loc.liquid}"`);
  if (!Array.isArray(loc.creatures)) err('creatures must be an array');
  const hotspot = loc.hotspot?.creatures ?? [];
  if ((loc.creatures ?? []).length === 0 && hotspot.length === 0 && !loc.extends) err('no creatures');
  if (loc.hotspot && !(loc.hotspot.baseChance >= 0 && loc.hotspot.baseChance <= 1)) err('hotspot.baseChance must be in [0, 1]');
  const seen = new Set();
  for (const c of [...(loc.creatures ?? []), ...hotspot]) {
    const where = `creature ${c.id}`;
    if (seen.has(c.id)) err(`${where} duplicated`);
    seen.add(c.id);
    if (!RARITIES.includes(c.rarity)) err(`${where} bad rarity "${c.rarity}"`);
    if (!(c.weight > 0)) err(`${where} weight must be > 0`);
    if (!(c.requires?.fishingLevel >= 0)) err(`${where} missing requires.fishingLevel`);
    if (!(c.fishingXp >= 0)) err(`${where} missing fishingXp`);
    for (const d of c.drops ?? []) {
      if (d.note !== undefined && typeof d.note !== 'string') err(`${where} ${d.item} note must be text`);
      if (!/^[A-Z0-9_:;]+$/.test(d.item)) err(`${where} drop has bad item id "${d.item}"`);
      if (!(d.chance > 0 && d.chance <= 1)) err(`${where} ${d.item} chance must be in (0, 1]`);
      if (!(d.min >= 1 && d.max >= d.min)) err(`${where} ${d.item} bad min/max`);
      for (const a of d.aliases ?? []) if (!/^[A-Z0-9_:;]+$/.test(a)) err(`${where} bad alias "${a}"`);
    }
  }
  return errors;
}

/** Errors that need all locations, e.g. `extends` pointing at a missing id. */
export function validateAll(locs) {
  const ids = new Set(locs.map((l) => l.id));
  const errors = locs.flatMap(validateLocation);
  if (ids.size !== locs.length) errors.push('duplicate location ids');
  for (const l of locs) if (l.extends && !ids.has(l.extends)) errors.push(`${l.id}: extends unknown location ${l.extends}`);
  return errors;
}

/** Every item id a price is needed for (drop ids and their aliases). */
export function itemIds(locs) {
  return new Set(
    locs.flatMap((l) =>
      [...(l.creatures ?? []), ...(l.hotspot?.creatures ?? [])].flatMap((c) =>
        c.drops.flatMap((d) => [d.item, ...(d.aliases ?? [])]),
      ),
    ),
  );
}

export function loadLocations() {
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8')));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = validateAll(loadLocations());
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('Data OK');
}
