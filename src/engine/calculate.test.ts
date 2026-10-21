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
