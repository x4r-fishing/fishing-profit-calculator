import type { LocationData } from './types';

/**
 * Fills in `extends`: a location that extends another gets that location's creatures
 * ahead of its own in the regular pool (e.g. lava hotspots = normal lava pool + hotspot pool).
 */
export function resolveLocations(raw: LocationData[]): LocationData[] {
  const byId = new Map(raw.map((l) => [l.id, l]));
  const resolve = (l: LocationData, seen: Set<string>): LocationData => {
    if (!l.extends) return l;
    if (seen.has(l.id)) throw new Error(`Location ${l.id} extends itself`);
    const base = byId.get(l.extends);
    if (!base) throw new Error(`Location ${l.id} extends unknown location ${l.extends}`);
    const parent = resolve(base, new Set([...seen, l.id]));
    return {
      ...l,
      baitBonus: l.baitBonus ?? parent.baitBonus,
      sources: [...new Set([...(parent.sources ?? []), ...(l.sources ?? [])])],
      creatures: [...parent.creatures, ...l.creatures],
    };
  };
  return raw.map((l) => resolve(l, new Set()));
}
