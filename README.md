# SkyBlock Fishing Profit Calculator

A browser calculator for Hypixel SkyBlock sea creature fishing. Enter your catches per hour, Sea Creature Chance, Double Hook Chance, Magic Find and unlocks. It shows the expected coins per hour, creature by creature and drop by drop, using current Bazaar and Auction House prices.

First location: **Crimson Isle lava fishing outside hotspots** (Thunder and Lord Jawbus).

## How it works

- **Sea creatures per hour** = catches/h × min(SCC, 100%) × (1 + DHC).
- **Which creature you get** = its weight ÷ the total weight of all creatures you have unlocked (fishing level and Trophy Fisher title).
  - Whale, Light and Dark bait multiply the weight of creatures under 400 base weight by 1.25.
  - Tracking multiplies the weight of elusive creatures (Thunder, Lord Jawbus) by (1 + Tracking/100).
- **Drops**: base chance × Looting (1 + 0.15 × level, I–V), then × (1 + Magic Find/100) if the looted chance is still under 5%.
  - Looting also boosts guaranteed drops: above 100% means a chance of an extra drop.
  - Amounts use the average of min and max.
- **Prices**: the best of the Bazaar (instant sell or sell offer, minus Bazaar tax), the lowest BIN (minus AH listing and claim fees) and the NPC price. You can override any price, or untick an item you keep.

## Project layout

| Path | What it is |
|---|---|
| `data/*.json` | One file per fishing location: creatures, weights, unlocks, XP, drop tables |
| `src/engine/` | Pure calculation (`calculate(inputs, location, prices)`) and pricing, with tests |
| `src/main.ts`, `index.html`, `src/style.css` | The web page |
| `scripts/fetch-prices.mjs` | Pulls Bazaar, every Auction House page (lowest BIN) and NPC prices from the Hypixel API into `public/prices.json` |
| `scripts/validate-data.mjs` | Checks the data files |
| `.github/workflows/deploy.yml` | Every 15 min: test, fetch prices, build, deploy to GitHub Pages |

`public/prices.json` in the repo holds **sample prices** for local development. The deploy job replaces it with live prices before each build.

## Commands

```sh
npm install
npm run dev           # local dev server
npm test              # engine, NBT decoder and data tests
npm run validate      # check data/*.json
npm run fetch-prices  # needs internet access to api.hypixel.net
npm run build
```

## Setup on GitHub (one time)

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Push to `main` (or run the workflow from the Actions tab). The site appears at `https://<user>.github.io/<repo>/`.

GitHub turns scheduled workflows off after 60 days without commits. Re-enable it from the Actions tab if prices stop updating.

## Adding a location

Copy `data/crimson-isle.json`, change the creatures and drops, and run `npm run validate` and `npm test`. The price fetcher picks up new item ids automatically and prints any id it can't find a price for.

## Data sources

- [Hypixel SkyBlock Wiki: Crimson Isle sea creatures](https://hypixelskyblock.minecraft.wiki/w/Sea_Creatures/List/Crimson_Isle)
- [NotEnoughUpdates item repo](https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO), used to check item ids and drop tables
- Hypixel API v2 (`/skyblock/bazaar`, `/skyblock/auctions`, `/resources/skyblock/items`)

Not affiliated with Hypixel.
