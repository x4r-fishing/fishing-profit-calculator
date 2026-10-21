import './style.css';
import { calculate, prettyId } from './engine/calculate';
import type { CalcResult, Inputs, LocationData, PriceData, Rarity } from './engine/types';

const locations = Object.values(
  import.meta.glob<LocationData>('../data/*.json', { eager: true, import: 'default' }),
);

const DEFAULTS: Inputs = {
  catchesPerHour: 700,
  seaCreatureChance: 60,
  doubleHookChance: 20,
  magicFind: 100,
  lootingEnabled: false,
  lootingLevel: 5,
  tracking: 0,
  fishingLevel: 50,
  trophyTitle: 2,
  rareBait: false,
  bazaarMode: 'instaSell',
  applyTax: true,
  bazaarTax: 1.25,
  priceOverrides: {},
  excludedItems: [],
};

const STORAGE_KEY = 'sb-fishing-calc:v1';
const BAZAAR_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('inputs');
const locSelect = $<HTMLSelectElement>('location');

let inputs: Inputs = loadInputs();
let location: LocationData = locations[0];
let prices: PriceData = { updated: '', bazaar: {}, auction: {}, npc: {}, names: {} };
let bazaarLive = false;
const open = new Set<string>();

function loadInputs(): Inputs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return structuredClone(DEFAULTS);
}

function saveInputs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
  } catch {
    /* storage unavailable */
  }
}

// ---------- formatting ----------

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function coins(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (a >= 100) return intFmt.format(n);
  return n.toFixed(a >= 10 ? 0 : 1);
}

function count(n: number): string {
  if (n >= 100) return intFmt.format(n);
  if (n >= 10) return n.toFixed(1);
  if (n >= 0.01) return n.toFixed(2);
  if (n === 0) return '0';
  return n.toPrecision(2);
}

function boostMark(d: { lootingApplied: boolean; magicFindApplied: boolean }): string {
  const parts = [d.lootingApplied && 'Looting', d.magicFindApplied && 'Magic Find'].filter(Boolean);
  return parts.length ? `<abbr title="Includes ${parts.join(' and ')}"> ✦</abbr>` : '';
}

function chance(p: number): string {
  if (p >= 1) return `${+(p * 100).toFixed(1)}%`;
  if (p >= 0.001) return `${+(p * 100).toFixed(2)}%`;
  return `1 in ${intFmt.format(Math.round(1 / p))}`;
}

function duration(hours: number): string {
  if (!Number.isFinite(hours)) return '—';
  if (hours < 1 / 60) return `${Math.max(1, Math.round(hours * 3600))} s`;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 10) return `${hours.toFixed(1)} h`;
  return `${intFmt.format(hours)} h`;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return 'unknown time';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const rarityClass = (r: Rarity) => `r-${r.toLowerCase()}`;

const SOURCE_LABEL: Record<string, string> = {
  bazaar: 'Bazaar',
  auction: 'Lowest BIN',
  npc: 'NPC',
  override: 'Your price',
  excluded: 'Kept',
  none: 'No price',
};

// ---------- form ----------

function writeForm() {
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    const key = el.name as keyof Inputs;
    if (!key || !(key in inputs)) continue;
    const v = inputs[key];
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v);
  }
  syncDependentFields();
}

/** The Looting level only matters while the Looting box is ticked. */
function syncDependentFields() {
  const level = form.elements.namedItem('lootingLevel') as HTMLSelectElement;
  level.disabled = !inputs.lootingEnabled;
}

function readForm() {
  const next = { ...inputs } as Record<string, unknown>;
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    const key = el.name;
    if (!key || !(key in DEFAULTS)) continue;
    const def = DEFAULTS[key as keyof Inputs];
    if (el.type === 'checkbox') next[key] = el.checked;
    else if (typeof def === 'number') {
      const n = parseFloat(el.value);
      next[key] = Number.isFinite(n) ? n : def;
    } else next[key] = el.value;
  }
  inputs = next as unknown as Inputs;
  syncDependentFields();
}

form.addEventListener('input', () => {
  readForm();
  saveInputs();
  render();
});

$('reset').addEventListener('click', () => {
  inputs = structuredClone(DEFAULTS);
  saveInputs();
  writeForm();
  render();
});

// ---------- rendering ----------

function renderBar(el: HTMLElement, parts: { key: string; label: string; rarity: Rarity; value: number }[]) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  el.innerHTML = total > 0
    ? parts
        .filter((p) => p.value > 0)
        .map((p) => {
          const pct = (p.value / total) * 100;
          const tip = `${p.label}: ${pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
          return `<span class="seg ${rarityClass(p.rarity)}" style="flex-basis:${pct}%" title="${esc(tip)}"></span>`;
        })
        .join('')
    : '';
}

function renderCreatures(r: CalcResult) {
  const rows = r.creatures.map((c) => {
    const isOpen = open.has(c.id);
    const main = `
      <tr class="creature ${c.unlocked ? '' : 'locked'}">
        <th scope="row">
          <button type="button" class="expand" data-toggle="${c.id}" aria-expanded="${isOpen}">
            <span class="dot ${rarityClass(c.rarity)}"></span>
            <span class="cname ${rarityClass(c.rarity)}">${esc(c.name)}</span>
            ${c.lockReason ? `<span class="lock">${esc(c.lockReason)}</span>` : ''}
          </button>
        </th>
        <td class="num">${c.unlocked ? chance(c.share) : '—'}</td>
        <td class="num opt">${c.unlocked ? count(c.perHour) : '—'}</td>
        <td class="num opt">${c.unlocked ? duration(c.hoursPerSpawn) : '—'}</td>
        <td class="num opt">${coins(c.coinsPerKill)}</td>
        <td class="num strong">${c.unlocked ? coins(c.coinsPerHour) : '—'}</td>
      </tr>`;
    if (!isOpen) return main;
    const drops = c.drops
      .map((d) => {
        const kept = d.price.source === 'excluded';
        const override = inputs.priceOverrides[d.item];
        return `
          <tr class="${kept ? 'kept' : ''}">
            <td>
              <label class="drop-name">
                <input type="checkbox" data-sell="${d.item}" ${kept ? '' : 'checked'} aria-label="Sell ${esc(d.name)}" />
                ${esc(d.name)}${d.avgCount === 1 ? '' : ` <span class="qty">×${Number.isInteger(d.avgCount) ? d.avgCount : count(d.avgCount)}</span>`}
              </label>
            </td>
            <td class="num">${d.chance > 1
              ? `<abbr class="over" title="Over 100%: ${+((d.chance - 1) * 100).toFixed(1)}% chance of an extra drop">${chance(d.chance)}</abbr>`
              : chance(d.chance)}${boostMark(d)}</td>
            <td class="num">
              <input class="price" type="text" inputmode="decimal" data-price="${d.item}" data-focus="price-${c.id}-${d.item}"
                value="${override !== undefined ? override : ''}" placeholder="${kept ? '—' : coins(d.price.unit)}"
                aria-label="Price for ${esc(d.name)}" />
              <span class="src src-${d.price.source}">${SOURCE_LABEL[d.price.source]}</span>
            </td>
            <td class="num strong">${coins(d.coinsPerHour)}</td>
          </tr>`;
      })
      .join('');
    return `${main}
      <tr class="drops"><td colspan="6">
        <table>
          <thead><tr>
            <th scope="col">Drop (ticked = sold)</th><th scope="col" class="num">Chance</th><th scope="col" class="num">Price each</th><th scope="col" class="num">Coins / hour</th>
          </tr></thead>
          <tbody>${drops}</tbody>
        </table>
      </td></tr>`;
  });
  $('creature-rows').innerHTML = rows.join('');
}

function renderTimers(r: CalcResult) {
  const byItem = new Map<string, { name: string; perHour: number; value: number; from: string[]; rarity: Rarity }>();
  for (const c of r.creatures) {
    if (!c.unlocked) continue;
    for (const d of c.drops) {
      const base = location.creatures.find((x) => x.id === c.id)!.drops.find((x) => x.item === d.item)!;
      if (base.chance >= 0.05) continue;
      const cur = byItem.get(d.item) ?? { name: d.name, perHour: 0, value: d.price.unit, from: [], rarity: c.rarity };
      cur.perHour += c.perHour * d.chance;
      cur.from.push(c.name);
      byItem.set(d.item, cur);
    }
  }
  const list = [...byItem.values()].filter((t) => t.perHour > 0).sort((a, b) => b.perHour - a.perHour);
  $('timers').innerHTML = list.length
    ? list
        .map((t) => `
        <li>
          <span class="t-name">${esc(t.name)}</span>
          <span class="t-from">${esc(t.from.length > 2 ? `${t.from.length} creatures` : t.from.join(', '))}</span>
          <span class="t-time">${duration(1 / t.perHour)}</span>
          <span class="t-value">${t.value > 0 ? coins(t.value) : ''}</span>
        </li>`)
        .join('')
    : '<li class="empty">Unlock creatures to see rare drop timers.</li>';
}

function renderStatus() {
  const el = $('price-status');
  if (!prices.updated) {
    el.innerHTML = 'Loading prices…';
    return;
  }
  const live = bazaarLive ? ' · Bazaar live' : '';
  el.innerHTML = prices.sample
    ? `<span class="badge warn-badge">Sample prices</span> Real prices appear after the first price update runs.${live}`
    : `Prices updated ${ago(prices.updated)}${live}`;
  el.insertAdjacentHTML('beforeend', ' <button type="button" class="link" id="refresh">Refresh Bazaar</button>');
}

function render() {
  const r = calculate(inputs, location, prices);
  $('coins-hr').textContent = coins(r.coinsPerHour);
  $('sc-hr').textContent = `${count(r.seaCreaturesPerHour)} / h`;
  $('coins-sc').textContent = coins(r.coinsPerSeaCreature);
  $('xp-hr').textContent = `${coins(r.xpPerHour)} / h`;

  const unlocked = r.creatures.filter((c) => c.unlocked);
  renderBar($('bar-catches'), unlocked.map((c) => ({ key: c.id, label: c.name, rarity: c.rarity, value: c.share })));
  renderBar($('bar-coins'), unlocked.map((c) => ({ key: c.id, label: c.name, rarity: c.rarity, value: c.coinsPerHour })));

  const missing = $('missing');
  missing.hidden = r.missingPrices.length === 0;
  missing.textContent = `No market price for ${r.missingPrices
    .map((id) => prices.names[id] ?? prettyId(id))
    .join(', ')}. These count as 0 coins until you enter a price.`;

  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focus;
  renderCreatures(r);
  renderTimers(r);
  if (focusKey) (document.querySelector(`[data-focus="${focusKey}"]`) as HTMLElement | null)?.focus();
}

// ---------- table interactions ----------

$('creature-rows').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle]');
  if (!btn) return;
  const id = btn.dataset.toggle!;
  if (open.has(id)) open.delete(id);
  else open.add(id);
  render();
});

$('creature-rows').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.sell) {
    const id = el.dataset.sell;
    const set = new Set(inputs.excludedItems);
    if (el.checked) set.delete(id);
    else set.add(id);
    inputs = { ...inputs, excludedItems: [...set] };
  } else if (el.dataset.price) {
    const id = el.dataset.price;
    const raw = el.value.trim().toLowerCase().replace(/,/g, '');
    const m = raw.match(/^([\d.]+)\s*([kmb]?)$/);
    const overrides = { ...inputs.priceOverrides };
    if (m) overrides[id] = parseFloat(m[1]) * ({ '': 1, k: 1e3, m: 1e6, b: 1e9 } as Record<string, number>)[m[2]];
    else delete overrides[id];
    inputs = { ...inputs, priceOverrides: overrides };
  } else return;
  saveInputs();
  render();
});

// ---------- prices ----------

async function loadPrices() {
  try {
    const res = await fetch('./prices.json', { cache: 'no-cache' });
    prices = await res.json();
  } catch {
    $('price-status').textContent = 'Could not load prices.json. Coins show as 0 until you enter prices.';
    return;
  }
  renderStatus();
  render();
  if (prices.sample) refreshBazaar();
}

/** Pulls fresh Bazaar prices straight from the Hypixel API, if the browser allows it. */
async function refreshBazaar() {
  const wanted = new Set(locations.flatMap((l) => l.creatures.flatMap((c) => c.drops.map((d) => d.item))));
  try {
    const res = await fetch(BAZAAR_URL);
    const json = await res.json();
    if (!json.success) throw new Error('bazaar');
    const bazaar = { ...prices.bazaar };
    for (const [id, p] of Object.entries<any>(json.products)) {
      if (!wanted.has(id)) continue;
      bazaar[id] = {
        instaSell: p.sell_summary?.[0]?.pricePerUnit ?? p.quick_status?.sellPrice ?? 0,
        sellOffer: p.buy_summary?.[0]?.pricePerUnit ?? p.quick_status?.buyPrice ?? 0,
      };
    }
    prices = { ...prices, bazaar };
    bazaarLive = true;
  } catch {
    bazaarLive = false;
  }
  renderStatus();
  render();
}

$('price-status').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'refresh') refreshBazaar();
});

// ---------- boot ----------

locSelect.innerHTML = locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
locSelect.addEventListener('change', () => {
  location = locations.find((l) => l.id === locSelect.value) ?? locations[0];
  render();
});

$('foot').innerHTML = `
  <p>Expected values: sea creatures per hour = catches × Sea Creature Chance × (1 + Double Hook Chance), split by spawn weight.
  Looting adds 15% per level to every drop's chance (over 100% means a chance of an extra drop), then
  Magic Find boosts drops that are still under 5%. Rare drops are averages — your luck will vary a lot over a few hours.</p>
  <p>Data: ${(location.sources ?? []).map((s) => (s.startsWith('http') ? `<a href="${esc(s)}">${esc(new URL(s).hostname)}</a>` : esc(s))).join(' and ')}.
  Prices from the Hypixel API. Not affiliated with Hypixel.</p>`;

writeForm();
renderStatus();
render();
loadPrices();
