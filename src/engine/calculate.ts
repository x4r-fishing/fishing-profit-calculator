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

/** Looting adds 15% per level to drop chance (and to amount, once the chance passes 100%). */
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

export function effectiveWeight(c: SeaCreature, inputs: Inputs, loc: LocationData): number {
  let w = c.weight;
  if (inputs.rareBait && loc.baitBonus && c.weight <= loc.baitBonus.maxBaseWeight) {
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

  const weights = loc.creatures.map((c) =>
    lockReason(c, inputs) ? 0 : effectiveWeight(c, inputs, loc),
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const missing = new Set<string>();

  const creatures: CreatureResult[] = loc.creatures.map((c, i) => {
    const reason = lockReason(c, inputs);
    const share = totalWeight > 0 ? weights[i] / totalWeight : 0;
    const perHour = scPerHour * share;

    const drops: DropResult[] = c.drops.map((d) => {
      // Looting applies first; Magic Find then checks the looted chance against the 5% threshold.
      const looted = d.chance * looting;
      const mfApplies = d.magicFind ?? looted < MAGIC_FIND_THRESHOLD;
      const chance = mfApplies ? looted * (1 + mf) : looted;
      const avgCount = (d.min + d.max) / 2;
      const perKill = chance * avgCount;
      const price = resolvePrice(d.item, prices, priceOpts);
      if (price.source === 'none') missing.add(d.item);
      const dropsPerHour = perHour * chance;
      return {
        item: d.item,
        name: prices.names[d.item] ?? d.name ?? prettyId(d.item),
        chance,
        lootingApplied: looting > 1,
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
      unlocked: !reason,
      lockReason: reason,
      baseWeight: c.weight,
      effectiveWeight: weights[i],
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
    coinsPerHour,
    xpPerHour: creatures.reduce((a, c) => a + c.xpPerHour, 0),
    coinsPerSeaCreature: scPerHour > 0 ? coinsPerHour / scPerHour : 0,
    creatures,
    missingPrices: [...missing].sort(),
  };
}
