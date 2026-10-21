// Fetches Bazaar, Auction House (lowest BIN) and NPC prices for every item used in data/*.json
// and writes public/prices.json. No API key needed. Runs in GitHub Actions on a schedule.
// Usage: node scripts/fetch-prices.mjs [outFile]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { skyblockIdFromItemBytes } from './nbt.mjs';
import { loadLocations } from './validate-data.mjs';

const API = 'https://api.hypixel.net/v2';
const out = process.argv[2] ?? new URL('../public/prices.json', import.meta.url).pathname;

async function getJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'skyblock-fishing-calc' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success === false) throw new Error(json.cause ?? 'success=false');
      return json;
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

const wanted = new Set(
  loadLocations().flatMap((l) => l.creatures.flatMap((c) => c.drops.map((d) => d.item))),
);

const [bazaarRes, itemsRes, firstPage] = await Promise.all([
  getJson(`${API}/skyblock/bazaar`),
  getJson(`${API}/resources/skyblock/items`),
  getJson(`${API}/skyblock/auctions?page=0`),
]);

const bazaar = {};
for (const [id, p] of Object.entries(bazaarRes.products)) {
  if (!wanted.has(id)) continue;
  bazaar[id] = {
    instaSell: round(p.sell_summary?.[0]?.pricePerUnit ?? p.quick_status?.sellPrice ?? 0),
    sellOffer: round(p.buy_summary?.[0]?.pricePerUnit ?? p.quick_status?.buyPrice ?? 0),
  };
}

const npc = {};
const names = {};
const knownItems = new Set();
for (const it of itemsRes.items) {
  knownItems.add(it.id);
  if (!wanted.has(it.id)) continue;
  if (it.npc_sell_price) npc[it.id] = it.npc_sell_price;
  if (it.name) names[it.id] = it.name.replace(/§./g, '');
}

const pages = [firstPage];
const rest = Array.from({ length: Math.max(firstPage.totalPages - 1, 0) }, (_, i) => i + 1);
pages.push(...(await mapLimit(rest, 6, (p) => getJson(`${API}/skyblock/auctions?page=${p}`).catch(() => null))));

const auction = {};
let scanned = 0;
for (const page of pages) {
  for (const a of page?.auctions ?? []) {
    if (!a.bin) continue;
    scanned++;
    let id;
    try {
      id = skyblockIdFromItemBytes(a.item_bytes);
    } catch {
      continue;
    }
    if (!id || !wanted.has(id)) continue;
    const price = a.starting_bid / (a.count ?? 1);
    const cur = auction[id];
    if (!cur) auction[id] = { lowestBin: price, count: 1 };
    else {
      cur.count++;
      if (price < cur.lowestBin) cur.lowestBin = price;
    }
  }
}

const missing = [...wanted].filter((id) => !bazaar[id] && !auction[id] && !npc[id]).sort();
const unknown = [...wanted].filter((id) => !bazaar[id] && !knownItems.has(id)).sort();

const result = {
  updated: new Date(bazaarRes.lastUpdated ?? Date.now()).toISOString(),
  bazaar,
  auction,
  npc,
  names,
  missing,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));

console.log(`Wrote ${out}`);
console.log(`Bazaar: ${Object.keys(bazaar).length}, AH: ${Object.keys(auction).length} (scanned ${scanned} BINs on ${pages.length} pages), NPC: ${Object.keys(npc).length}`);
if (missing.length) console.warn(`No price found for: ${missing.join(', ')}`);
if (unknown.length) console.warn(`Not a known item id (check the spelling): ${unknown.join(', ')}`);

function round(n) {
  return Math.round(n * 10) / 10;
}
