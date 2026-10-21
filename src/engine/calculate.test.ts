import { describe, expect, it } from 'vitest';
import crimson from '../../data/crimson-isle.json';
import { calculate, effectiveWeight, seaCreaturesPerHour } from './calculate';
import { auctionFeeRate, resolvePrice } from './pricing';
import type { Inputs, LocationData, PriceData } from './types';

const loc = crimson as LocationData;

const baseInputs: Inputs = {
  catchesPerHour: 1000,
  seaCreatureChance: 50,
  doubleHookChance: 20,
  magicFind: 0,
  lootingEnabled: false,
  lootingLevel: 5,
  tracking: 0,
  fishingLevel: 50,
  trophyTitle: 4,
  rareBait: false,
  bazaarMode: 'instaSell',
  applyTax: false,
  bazaarTax: 1.25,
  priceOverrides: {},
  excludedItems: [],
};

const emptyPrices: PriceData = { updated: '', bazaar: {}, auction: {}, npc: {}, names: {} };

const byId = (r: ReturnType<typeof calculate>, id: string) => r.creatures.find((c) => c.id === id)!;

describe('sea creature rate', () => {
  it('is catches × SCC × (1 + DHC)', () => {
    expect(seaCreaturesPerHour(baseInputs)).toBeCloseTo(1000 * 0.5 * 1.2);
  });

  it('caps sea creature chance at 100%', () => {
    expect(seaCreaturesPerHour({ ...baseInputs, seaCreatureChance: 140, doubleHookChance: 0 })).toBe(1000);
  });
});

describe('creature selection', () => {
  it('uses weight / total weight (4648 for the full Crimson pool)', () => {
    const r = calculate(baseInputs, loc, emptyPrices);
    const total = r.creatures.reduce((a, c) => a + c.share, 0);
    expect(total).toBeCloseTo(1);
    expect(byId(r, 'LORD_JAWBUS').share).toBeCloseTo(8 / 4648);
    expect(byId(r, 'THUNDER').share).toBeCloseTo(40 / 4648);
    expect(byId(r, 'LORD_JAWBUS').perHour).toBeCloseTo(600 * (8 / 4648));
  });

  it('locks creatures by fishing level and trophy title', () => {
    const r = calculate({ ...baseInputs, fishingLevel: 44, trophyTitle: 1 }, loc, emptyPrices);
    const jawbus = byId(r, 'LORD_JAWBUS');
    expect(jawbus.unlocked).toBe(false);
    expect(jawbus.share).toBe(0);
    expect(byId(r, 'THUNDER').share).toBeCloseTo(40 / (4648 - 8));

    const noTitle = calculate({ ...baseInputs, trophyTitle: 0 }, loc, emptyPrices);
    expect(byId(noTitle, 'THUNDER').unlocked).toBe(false);
    expect(byId(noTitle, 'THUNDER').lockReason).toMatch(/Novice/);
  });

  it('applies rare bait (x1.25) only to creatures below 400 base weight', () => {
    const bait = { ...baseInputs, rareBait: true };
    const worm = loc.creatures.find((c) => c.id === 'PYROCLASTIC_WORM')!;
    const flame = loc.creatures.find((c) => c.id === 'LAVA_FLAME')!;
    expect(effectiveWeight(worm, bait, loc)).toBe(400);
    expect(effectiveWeight(flame, bait, loc)).toBe(450);
  });

  it('applies Tracking only to elusive creatures', () => {
    const t = { ...baseInputs, tracking: 50 };
    const jawbus = loc.creatures.find((c) => c.id === 'LORD_JAWBUS')!;
    const taurus = loc.creatures.find((c) => c.id === 'TAURUS')!;
    expect(effectiveWeight(jawbus, t, loc)).toBe(12);
    expect(effectiveWeight(taurus, t, loc)).toBe(160);
  });
});

describe('drops and money', () => {
  it('applies Magic Find only to drops under 5% base chance', () => {
    const r = calculate({ ...baseInputs, magicFind: 100 }, loc, emptyPrices);
    const leech = byId(r, 'LAVA_LEECH');
    const blade = leech.drops.find((d) => d.item === 'BLADE_OF_THE_VOLCANO')!;
    const koi = leech.drops.find((d) => d.item === 'PITCHIN_KOI')!;
    expect(blade.chance).toBeCloseTo(0.05);
    expect(koi.chance).toBeCloseTo(0.008);
  });

  it('ignores the Looting level while the checkbox is off', () => {
    const r = calculate({ ...baseInputs, lootingLevel: 5 }, loc, emptyPrices);
    const frag = byId(r, 'LORD_JAWBUS').drops.find((d) => d.item === 'MAGMA_LORD_FRAGMENT')!;
    expect(frag.perKill).toBe(1);
    expect(frag.lootingApplied).toBe(false);
  });

  it('boosts every drop by 15% per Looting level, guaranteed ones included', () => {
    const r = calculate({ ...baseInputs, lootingEnabled: true, lootingLevel: 5 }, loc, emptyPrices);
    const jawbus = byId(r, 'LORD_JAWBUS');
    const frag = jawbus.drops.find((d) => d.item === 'MAGMA_LORD_FRAGMENT')!;
    const silver = jawbus.drops.find((d) => d.item === 'MAGMA_FISH_SILVER')!;
    expect(frag.chance).toBeCloseTo(1.75);
    expect(frag.perKill).toBeCloseTo(1.75);
    expect(silver.perKill).toBeCloseTo(24 * 1.75);
    const level3 = calculate({ ...baseInputs, lootingEnabled: true, lootingLevel: 3 }, loc, emptyPrices);
    expect(byId(level3, 'LORD_JAWBUS').drops.find((d) => d.item === 'RADIOACTIVE_VIAL')!.chance).toBeCloseTo(0.005 * 1.45);
  });

  it('applies Looting before Magic Find and checks the 5% limit on the looted chance', () => {
    const withBoth = (lootingLevel: number) =>
      byId(calculate({ ...baseInputs, magicFind: 100, lootingEnabled: true, lootingLevel }, loc, emptyPrices), 'LAVA_FLAME')
        .drops.find((d) => d.item === 'FLAMING_CHESTPLATE')!;
    // 2% base: Looting I → 2.3%, still under 5%, so Magic Find doubles it.
    expect(withBoth(1).chance).toBeCloseTo(0.02 * 1.15 * 2);
    // Looting V → 3.5%, still under 5%.
    expect(withBoth(5).chance).toBeCloseTo(0.02 * 1.75 * 2);
    // Wiki example: a 3% drop becomes 3.45% with Looting I (Magic Find still applies)
    // but 5.25% with Looting V (Magic Find no longer applies).
    const mini: LocationData = {
      id: 'TEST', name: 'Test', liquid: 'water',
      creatures: [{
        id: 'X', name: 'X', rarity: 'RARE', weight: 1, requires: { fishingLevel: 0 }, fishingXp: 0,
        drops: [{ item: 'TORN_CLOTH', min: 1, max: 1, chance: 0.03 }],
      }],
    };
    const cloth = (lootingLevel: number) =>
      calculate({ ...baseInputs, magicFind: 100, lootingEnabled: true, lootingLevel }, mini, emptyPrices).creatures[0].drops[0];
    expect(cloth(1).chance).toBeCloseTo(0.0345 * 2);
    expect(cloth(1).magicFindApplied).toBe(true);
    expect(cloth(5).chance).toBeCloseTo(0.0525);
    expect(cloth(5).magicFindApplied).toBe(false);
  });

  it('uses the average of min and max for drop counts', () => {
    const r = calculate(baseInputs, loc, emptyPrices);
    const silver = byId(r, 'LORD_JAWBUS').drops.find((d) => d.item === 'MAGMA_FISH_SILVER')!;
    expect(silver.perKill).toBe(24);
  });

  it('adds up coins per hour from drop prices', () => {
    const prices: PriceData = {
      ...emptyPrices,
      bazaar: { MAGMA_LORD_FRAGMENT: { instaSell: 100_000, sellOffer: 120_000 } },
    };
    const onlyJawbus = calculate(baseInputs, loc, prices);
    const jawbus = byId(onlyJawbus, 'LORD_JAWBUS');
    expect(jawbus.coinsPerKill).toBeCloseTo(100_000);
    expect(onlyJawbus.coinsPerHour).toBeCloseTo(jawbus.perHour * 100_000);
    expect(onlyJawbus.missingPrices).toContain('RADIOACTIVE_VIAL');
  });

  it('counts excluded items as zero', () => {
    const prices: PriceData = { ...emptyPrices, npc: { MAGMA_FISH: 10 } };
    const r = calculate({ ...baseInputs, excludedItems: ['MAGMA_FISH'] }, loc, prices);
    expect(r.coinsPerHour).toBe(0);
  });
});

describe('pricing', () => {
  const prices: PriceData = {
    ...emptyPrices,
    bazaar: { A: { instaSell: 100, sellOffer: 110 } },
    auction: { B: { lowestBin: 20_000_000, count: 3 } },
    npc: { A: 5, C: 7 },
  };
  const opts = { bazaarMode: 'instaSell' as const, applyTax: true, bazaarTax: 1.25 };

  it('takes Bazaar price minus tax', () => {
    expect(resolvePrice('A', prices, opts)).toMatchObject({ unit: 98.75, source: 'bazaar' });
    expect(resolvePrice('A', prices, { ...opts, bazaarMode: 'sellOffer' }).gross).toBe(110);
  });

  it('takes lowest BIN minus AH fees', () => {
    expect(auctionFeeRate(500_000)).toBeCloseTo(0.01);
    expect(auctionFeeRate(20_000_000)).toBeCloseTo(0.03);
    expect(auctionFeeRate(200_000_000)).toBeCloseTo(0.035);
    expect(resolvePrice('B', prices, opts).unit).toBeCloseTo(19_400_000);
  });

  it('falls back to NPC price and reports missing items', () => {
    expect(resolvePrice('C', prices, opts)).toMatchObject({ unit: 7, source: 'npc' });
    expect(resolvePrice('D', prices, opts).source).toBe('none');
  });

  it('honours overrides', () => {
    expect(resolvePrice('A', prices, { ...opts, overrides: { A: 1 } })).toMatchObject({ unit: 1, source: 'override' });
  });
});
