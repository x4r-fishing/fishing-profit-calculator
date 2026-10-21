import type { BazaarMode, PriceData, ResolvedPrice } from './types';

/**
 * Auction House fees for a BIN sale at `price` coins:
 * - listing fee: 1% under 10M, 2% from 10M, 2.5% from 100M
 * - claim tax: 1% on sales above 1M
 */
export function auctionFeeRate(price: number): number {
  const listing = price >= 100_000_000 ? 0.025 : price >= 10_000_000 ? 0.02 : 0.01;
  const claim = price > 1_000_000 ? 0.01 : 0;
  return listing + claim;
}

export interface PriceOptions {
  bazaarMode: BazaarMode;
  applyTax: boolean;
  bazaarTax: number;
  overrides?: Record<string, number>;
  excluded?: Set<string>;
}

/** Best way to turn one unit of `item` into coins: Bazaar, then lowest BIN, then NPC. */
export function resolvePrice(item: string, prices: PriceData, opts: PriceOptions): ResolvedPrice {
  if (opts.excluded?.has(item)) return { unit: 0, gross: 0, source: 'excluded' };

  const override = opts.overrides?.[item];
  if (override !== undefined && Number.isFinite(override)) {
    return { unit: override, gross: override, source: 'override' };
  }

  const npc = prices.npc[item] ?? 0;
  const candidates: ResolvedPrice[] = [];

  const bz = prices.bazaar[item];
  if (bz) {
    const gross = opts.bazaarMode === 'sellOffer' ? bz.sellOffer || bz.instaSell : bz.instaSell;
    if (gross > 0) {
      const unit = opts.applyTax ? gross * (1 - opts.bazaarTax / 100) : gross;
      candidates.push({ unit, gross, source: 'bazaar' });
    }
  }

  const ah = prices.auction[item];
  if (!bz && ah && ah.lowestBin > 0) {
    const gross = ah.lowestBin;
    const unit = opts.applyTax ? gross * (1 - auctionFeeRate(gross)) : gross;
    candidates.push({ unit, gross, source: 'auction' });
  }

  if (npc > 0) candidates.push({ unit: npc, gross: npc, source: 'npc' });

  if (candidates.length === 0) return { unit: 0, gross: 0, source: 'none' };
  return candidates.reduce((best, c) => (c.unit > best.unit ? c : best));
}
