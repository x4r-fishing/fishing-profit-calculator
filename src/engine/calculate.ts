import { resolvePrice } from './pricing';
import type {
  CalcResult,
  CreatureResult,
  DropResult,
  Inputs,
  LocationData,
  PriceData,
  SeaCreature,
} from './types';

export const TROPHY_TITLES = ['None', 'Novice', 'Adept', 'Expert', 'Master'] as const;

/** Magic Find only boosts drops whose base chance is below 5%. */
export const MAGIC_FIND_THRESHOLD = 0.05;

/** Looting adds 15% per level to drop chance; above 100% it's a chance at a second stack. */
export const LOOTING_PER_LEVEL = 0.15;
export const MAX_LOOTING_LEVEL = 5;

export function lootingMultiplier(inputs: Pick<Inputs, 'lootingEnabled' | 'lootingLevel'>): number {
  if (!inputs.lootingEnabled) return 1;
  const level = Math.min(Math.max(Math.round(inputs.lootingLevel), 0), MAX_LOOTING_LEVEL);
  return 1 + LOOTING_PER_LEVEL * level;
}

export function prettyId(id: string): string {
  return id
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function lockReason(c: SeaCreature, inputs: Inputs): string | undefined {
  if (inputs.fishingLevel < c.requires.fishingLevel) return `Needs Fishing ${c.requires.fishingLevel}`;
  const title = c.requires.trophyTitle ?? 0;
  if (inputs.trophyTitle < title) return `Needs ${TROPHY_TITLES[title]} Trophy Fisher`;
  return undefined;
}

/** Additions to the chance that a sea creature caught in a hotspot is a hotspot creature. */
export const HOTSPOT_BONUS = { tonic: 0.1, hook: 0.2, bait: 0.2, hermitCrab: 0.2 } as const;

export function hotspotChance(inputs: Inputs, loc: LocationData): number {
  if (!loc.hotspot) return 0;
  let h = loc.hotspot.baseChance;
  if (inputs.hotspotTonic) h += HOTSPOT_BONUS.tonic;
  if (inputs.hotspotHook) h += HOTSPOT_BONUS.hook;
  if (inputs.bait === 'hotspot') h += HOTSPOT_BONUS.bait;
  if (inputs.hermitCrab) h += HOTSPOT_BONUS.hermitCrab;
  return Math.min(Math.max(h, 0), 1);
}

export function effectiveWeight(c: SeaCreature, inputs: Inputs, loc: LocationData): number {
  let w = c.weight;
  if (inputs.bait === 'rare' && loc.baitBonus && c.weight <= loc.baitBonus.maxBaseWeight) {
    w *= loc.baitBonus.multiplier;
  }
  if (c.elusive && inputs.tracking > 0) w *= 1 + inputs.tracking / 100;
  return w;
}

export function seaCreaturesPerHour(inputs: Inputs): number {
  const scc = Math.min(Math.max(inputs.seaCreatureChance, 0), 100) / 100;
  const dh = Math.max(inputs.doubleHookChance, 0) / 100;
  return Math.max(inputs.catchesPerHour, 0) * scc * (1 + dh);
}

export function calculate(inputs: Inputs, loc: LocationData, prices: PriceData): CalcResult {
  const scPerHour = seaCreaturesPerHour(inputs);
  const excluded = new Set(inputs.excludedItems);
  const priceOpts = {
    bazaarMode: inputs.bazaarMode,
    applyTax: inputs.applyTax,
    bazaarTax: inputs.bazaarTax,
    overrides: inputs.priceOverrides,
    excluded,
  };
  const mf = Math.max(inputs.magicFind, 0) / 100;
  const looting = lootingMultiplier(inputs);

  // Each catch is a hotspot creature with chance h, otherwise a regular one; within a pool the
  // creature is picked by weight. A pool with nothing unlocked hands its share to the other.
  const pools = [
    { pool: 'regular' as const, creatures: loc.creatures, chance: 1 - hotspotChance(inputs, loc) },
    { pool: 'hotspot' as const, creatures: loc.hotspot?.creatures ?? [], chance: hotspotChance(inputs, loc) },
  ].map((p) => {
    const weights = p.creatures.map((c) => (lockReason(c, inputs) ? 0 : effectiveWeight(c, inputs, loc)));
    return { ...p, weights, total: weights.reduce((a, b) => a + b, 0) };
  });
  const livePoolChance = pools.reduce((a, p) => a + (p.total > 0 ? p.chance : 0), 0);
  const missing = new Set<string>();

  const entries = pools.flatMap((p) =>
    p.creatures.map((c, i) => ({
      c,
      pool: p.pool,
      weight: p.weights[i],
      share: p.total > 0 && livePoolChance > 0 ? (p.chance / livePoolChance) * (p.weights[i] / p.total) : 0,
    })),
  );

  const creatures: CreatureResult[] = entries.map(({ c, pool, weight, share }) => {
    const reason = lockReason(c, inputs);
    const perHour = scPerHour * share;

    const drops: DropResult[] = c.drops.map((d) => {
      // Looting applies first; Magic Find then checks the looted chance against the 5% threshold.
      // A looted chance above 100% gives a chance at a second stack (1.75 = one stack + 75% for
      // another), except for drops marked lootingExtra: false, which stop at 100%.
      const canExceed = d.lootingExtra !== false;
      const looted = canExceed ? d.chance * looting : Math.min(Math.max(1, d.chance), d.chance * looting);
      const mfApplies = d.magicFind ?? looted < MAGIC_FIND_THRESHOLD;
      const chance = mfApplies ? looted * (1 + mf) : looted;
      const avgCount = (d.min + d.max) / 2;
      const perKill = chance * avgCount;
      const price = [d.item, ...(d.aliases ?? [])]
        .map((id) => resolvePrice(id, prices, priceOpts))
        .find((p) => p.source !== 'none') ?? resolvePrice(d.item, prices, priceOpts);
      if (price.source === 'none') missing.add(d.item);
      const dropsPerHour = perHour * chance;
      return {
        item: d.item,
        name: prices.names[d.item] ?? d.name ?? prettyId(d.item),
        chance,
        lootingApplied: looting > 1 && (canExceed || d.chance < 1),
        magicFindApplied: mfApplies && mf > 0,
        avgCount,
        perKill,
        perHour: perHour * perKill,
        price,
        coinsPerKill: perKill * price.unit,
        coinsPerHour: perHour * perKill * price.unit,
        hoursPerDrop: dropsPerHour > 0 ? 1 / dropsPerHour : Infinity,
      };
    });

    const coinsPerKill = drops.reduce((a, d) => a + d.coinsPerKill, 0);
    return {
      id: c.id,
      name: c.name,
      rarity: c.rarity,
      pool,
      unlocked: !reason,
      lockReason: reason,
      baseWeight: c.weight,
      effectiveWeight: weight,
      share,
      perHour,
      hoursPerSpawn: perHour > 0 ? 1 / perHour : Infinity,
      coinsPerKill,
      coinsPerHour: coinsPerKill * perHour,
      xpPerHour: c.fishingXp * perHour,
      drops,
    };
  });

  const coinsPerHour = creatures.reduce((a, c) => a + c.coinsPerHour, 0);
  return {
    seaCreaturesPerHour: scPerHour,
    hotspotChance: hotspotChance(inputs, loc),
    coinsPerHour,
    xpPerHour: creatures.reduce((a, c) => a + c.xpPerHour, 0),
    coinsPerSeaCreature: scPerHour > 0 ? coinsPerHour / scPerHour : 0,
    creatures,
    missingPrices: [...missing].sort(),
  };
}
