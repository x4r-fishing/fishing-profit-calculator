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
  if (!Array.isArray(loc.creatures) || loc.creatures.length === 0) err('no creatures');
  const seen = new Set();
  for (const c of loc.creatures ?? []) {
    const where = `creature ${c.id}`;
    if (seen.has(c.id)) err(`${where} duplicated`);
    seen.add(c.id);
    if (!RARITIES.includes(c.rarity)) err(`${where} bad rarity "${c.rarity}"`);
    if (!(c.weight > 0)) err(`${where} weight must be > 0`);
    if (!(c.requires?.fishingLevel >= 0)) err(`${where} missing requires.fishingLevel`);
    if (!(c.fishingXp >= 0)) err(`${where} missing fishingXp`);
    for (const d of c.drops ?? []) {
      if (!/^[A-Z0-9_:;]+$/.test(d.item)) err(`${where} drop has bad item id "${d.item}"`);
      if (!(d.chance > 0 && d.chance <= 1)) err(`${where} ${d.item} chance must be in (0, 1]`);
      if (!(d.min >= 1 && d.max >= d.min)) err(`${where} ${d.item} bad min/max`);
    }
  }
  return errors;
}

export function loadLocations() {
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8')));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = loadLocations().flatMap(validateLocation);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('Data OK');
}
