export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';

export interface Drop {
  /** SkyBlock item id as used by the Bazaar / item NBT (e.g. MAGMA_FISH). */
  item: string;
  /** Optional display name override (used when the item API has no name, e.g. books). */
  name?: string;
  min: number;
  max: number;
  /** Base drop chance, 0..1. */
  chance: number;
  /** Force Magic Find on/off. Default: affected when base chance < 5%. */
  magicFind?: boolean;
}

export interface SeaCreature {
  id: string;
  name: string;
  rarity: Rarity;
  /** Elusive mobs (Thunder, Lord Jawbus) are boosted by the Tracking stat. */
  elusive?: boolean;
  weight: number;
  requires: {
    fishingLevel: number;
    /** Trophy Fisher title index: 0 none, 1 Novice, 2 Adept, 3 Expert, 4 Master. */
    trophyTitle?: number;
  };
  fishingXp: number;
  drops: Drop[];
}

export interface LocationData {
  id: string;
  name: string;
  liquid: 'water' | 'lava';
  notes?: string;
  sources?: string[];
  /** Whale / Light / Dark bait multiply weights of creatures at or below this base weight. */
  baitBonus?: { maxBaseWeight: number; multiplier: number };
  creatures: SeaCreature[];
}

export interface BazaarPrice {
  /** Instant-sell price per unit (highest buy order). */
  instaSell: number;
  /** Price per unit when listing a sell offer (lowest current sell offer). */
  sellOffer: number;
}

export interface AuctionPrice {
  lowestBin: number;
  count: number;
}

export interface PriceData {
  updated: string;
  sample?: boolean;
  bazaar: Record<string, BazaarPrice>;
  auction: Record<string, AuctionPrice>;
  npc: Record<string, number>;
  names: Record<string, string>;
}

export type BazaarMode = 'instaSell' | 'sellOffer';

export interface Inputs {
  catchesPerHour: number;
  /** Percent, e.g. 45 for 45%. */
  seaCreatureChance: number;
  /** Percent. */
  doubleHookChance: number;
  magicFind: number;
  /** Looting enchantment on the weapon that kills the sea creatures. */
  lootingEnabled: boolean;
  /** Looting level 1–5 (+15% drop chance and amount per level). */
  lootingLevel: number;
  tracking: number;
  fishingLevel: number;
  trophyTitle: number;
  /** Whale / Light / Dark bait active. */
  rareBait: boolean;
  bazaarMode: BazaarMode;
  /** Apply Bazaar tax and Auction House fees. */
  applyTax: boolean;
  /** Bazaar tax in percent (1.25 default, 1.0 with max Bazaar Flipper). */
  bazaarTax: number;
  /** Per-item manual price overrides (coins per unit, after tax). */
  priceOverrides: Record<string, number>;
  /** Items the user doesn't sell (counted as 0 coins). */
  excludedItems: string[];
}

export type PriceSource = 'bazaar' | 'auction' | 'npc' | 'override' | 'excluded' | 'none';

export interface ResolvedPrice {
  /** Coins per unit after tax. */
  unit: number;
  /** Coins per unit before tax. */
  gross: number;
  source: PriceSource;
}

export interface DropResult {
  item: string;
  name: string;
  /** Chance after Looting and Magic Find. Above 1 means a chance of an extra drop. */
  chance: number;
  lootingApplied: boolean;
  magicFindApplied: boolean;
  avgCount: number;
  /** Expected items per kill. */
  perKill: number;
  perHour: number;
  price: ResolvedPrice;
  coinsPerKill: number;
  coinsPerHour: number;
  /** Hours until one drop is expected (for rare drops). */
  hoursPerDrop: number;
}

export interface CreatureResult {
  id: string;
  name: string;
  rarity: Rarity;
  unlocked: boolean;
  lockReason?: string;
  baseWeight: number;
  effectiveWeight: number;
  /** Chance that a sea creature roll picks this creature. */
  share: number;
  perHour: number;
  hoursPerSpawn: number;
  coinsPerKill: number;
  coinsPerHour: number;
  xpPerHour: number;
  drops: DropResult[];
}

export interface CalcResult {
  seaCreaturesPerHour: number;
  coinsPerHour: number;
  xpPerHour: number;
  coinsPerSeaCreature: number;
  creatures: CreatureResult[];
  /** Item ids with no price anywhere. */
  missingPrices: string[];
}
