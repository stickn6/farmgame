# 🌻 Sunny Acres

A cozy 3D farming game built with **Vite + three.js**. Runs in the browser today and is built touch-first so it can be wrapped for iOS and Android later.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173 (also on your LAN, so you can test on a phone)
npm run build    # production build in dist/
npm test         # game-rule tests (Node, no browser)
npm run sim      # pacing simulator: how long each level/unlock takes
```

`/gallery.html?keys=coop,cow,tree:apple:fruit` (while `npm run dev` is running) shows any 3D models side by side.

## What's in the game

**Farming.** 12 crops, from wheat (45 s) to lavender (3 h). Each crop has 4 visible growth stages, and you can swipe across a field to harvest it. Fruit trees (apple, cherry, peach) give 8 harvests before they need clearing. Crop **mastery** stars make a crop grow faster and give a chance of bonus yield.

**Animals.** Chickens, cows, pigs, sheep, goats and bee colonies, each in its own pen. Feed them and collect eggs, milk, truffles, wool, goat milk and honey. Bees need no feed.

**Production.** 7 workshops with 23 recipes that unlock in stages. Products are worth more than their ingredients, so every step of a chain adds value. The workshops:
- Bakery
- Popcorn Stand
- Dairy
- Sugar Mill
- Loom
- Juice Press
- Candle Shop

**Selling.**
- **Delivery orders** pay about 45% over the shop price.
- **Villagers** stroll in along the road and pay about 80% over. They never leave on their own. Serving them builds **friendship hearts**, which give rewards and better prices. New villagers move in as you level up.
- The **Market Wagon** (L14) parks on the road with big crates to fill, plus a bonus for filling all of them.
- The **shop** buys anything.

**Daily rhythm.** Every day brings a **gift calendar** and **3 daily chores** scaled to your level. The calendar never resets if you miss a day.

**Village projects** (L16+). Restore the Old Bridge, the Bandstand and the Greenhouse, and turn your farmhouse into the **Master Farmhouse**. You donate coins and goods across 3 stages, which you can watch being built, and each finished project gives a small permanent perk.

**Progression and pacing** (see below).
- XP levels, with something unlocked at every level from 2 to 30.
- A **Silo** and **Barn** with limited capacity.
- Rare **building materials** (planks, bolts, paint).
- Field limits per level, and building limits per level.
- **Land expansion**, 8 steps from 16×16 to 32×32.

**Extras.**
- Achievements.
- Gems, an earned-only currency for skipping timers, buying a few missing materials or unlocking production slots early.
- Premium decorations, from bird baths to a hot-air balloon.
- A day/night cycle, a farm dog, and synthesized music and sound.

**Saving.** Autosaves to `localStorage`. Everything keeps progressing while the game is closed, and setting the clock back doesn't undo time. Saves from the first version migrate automatically:
- you keep your level and how far through it you were;
- you keep anything you had already unlocked;
- crops that were ripe stay ripe, and factories keep their slots;
- a backup of the old save is stored.

## Pacing

The goal: nobody unlocks everything in one sitting, the first 15 minutes are full of level-ups, and the framework leaves room for future content.

Simulated with `tools/sim.mjs`. The bot plays the real rules at realistic tap speed:

| Milestone | Non-stop efficient | Engaged (~40 min/day) | Casual (~30 min/day) | Light (~16 min/day) |
|---|---|---|---|---|
| Chickens (L2) / Bakery (L3) | 0.5 / 1.3 min | same | same | same |
| Cows (L5) | 7 min | 7 min | 7 min | 7 min |
| Visitors (L7) | 23 min | day 1 | day 1 | day 1 |
| L10 | 1 h | day 1 | day 1.2 | day 1.5 |
| Market Wagon (L14) | 2.5 h | day 2 | day 3 | day 4.5 |
| L20 | 7 h | day 5 | day 6 | day 10.5 |
| L25 | — | day 8.4 | day 10 | day 21 |
| **Last unlock (L30)** | **— (not in an 8 h sitting)** | **day 15** | **day 18** | **day 37** |

Before this update, the same simulated player unlocked **everything in ~12 minutes**. The bot plays efficiently, so real players will probably take 20–30% longer.

How it's paced:
- **XP curve.** `xpToNext(L) = 10L + L^2.8` (`config.js` → `xpToNext`).
- **Field cap.** The number of fields grows with your level, and each new field costs a bit more. Clearing a field refunds its cost. (`PLOTS`)
- **Storage.** The Silo holds crops and fruit; the Barn holds goods. Each upgrade tier needs a player level, coins and materials. (`STORAGE`)
- **Materials.** They drop in proportion to the XP you earn, with a pity timer, so spamming quick crops can't farm them. They are shared between storage and land, so you choose what to build first. (`DROPS`)
- **Building limits.** Your 2nd and 3rd pens of a type unlock later. Workshops are one each. Extra production slots cost coins and need a level, or cost gems. (`OBJECTS[].limit`, `QUEUE_SLOTS`)
- **Timers.** Higher tiers take longer. Short crops pay best per minute while you play; long ones pay best per check-in.
- **Catch-up rewards.** Chores, wagon crates and project stages pay a fixed *share of your current level*. That helps casual players without letting fast players race ahead.

Commands:
- `npm run sim` prints a pacing report.
- `npm run sim:check` fails if a balance change breaks these targets:
  - L6 within 15 minutes;
  - L10 at 45–100 minutes;
  - L15 at 2.5–5 hours;
  - nothing near "everything unlocked" in a single 8-hour sitting;
  - an engaged player reaches L30 between day 13 and day 24;
  - every level unlocks something.

To add content, use the reserved levels 31+ (`FUTURE_SLOTS` in config.js). Give the new thing a level and a timer, and the price/XP formulas in config.js price it for you.

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Move camera | drag (Hand tool) or two fingers | drag (Hand) · right-drag · WASD / arrows |
| Zoom | pinch | mouse wheel · `+` / `-` |
| Rotate | — | `Q` / `E` |
| Tools | toolbar | `1` Hand · `2` Plow · `3` Seeds · `4` Clear |
| Panels | toolbar · 🎁 Today · 🏆 · ⚙️ | `P` Shop · `B` Storage · `O` Orders · `Esc` close |
| Placing buildings | drag, then ✓ | click to place · `R` rotate |

## Project structure

```
src/
  main.js              Controller: input → game rules → views/effects/UI, main loop
  gallery.js           Dev model gallery (gallery.html)
  game/
    config.js          ALL data & balancing (items, crops, animals, recipes, buildings, storage,
                       drops, fields, land, gems, daily, mastery, achievements, visitors, quests, XP)
    state.js           Game model + rules + save/load/migration (no rendering; emits events)
    assets.js          Procedural model toolkit + original models, baked to 1 mesh each
    models/*.js        Additional models (buildings, decor, animals & villagers, crops & trees)
    world.js           Renderer, camera rig, lights, day/night, ground, forest, pond, road, clouds
    views.js           Syncs the 3D scene with the model (fields, buildings, trees, animals, visitors)
    input.js           Unified touch / mouse / keyboard
    effects.js         Particles, floating text, "fly to UI" icons
    audio.js           WebAudio synth sound effects + generative music
  ui/
    hud.js             DOM HUD: toolbar, shop, storage, orders, production, visitors, achievements…
    bubbles.js         Speech bubbles pinned to 3D objects
tools/
  test.mjs             Rule tests (npm test)
  sim.mjs              Pacing simulator + guardrails (npm run sim / npm run sim:check)
  gallery-shot.cjs     Screenshot the model gallery (needs the dev server running)
```

## Going mobile (next steps)

The game already uses safe-area insets, prevents browser zoom and scroll, and has touch gestures and large hit targets. To ship it as an app:

1. Add [Capacitor](https://capacitorjs.com/): `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`, then `npx cap init` and `npx cap add ios android`.
2. `npm run build && npx cap sync` to copy `dist/` into the native projects.
3. Swap `localStorage` for `@capacitor/preferences` (or cloud saves).
4. Bundle the Fredoka font locally instead of loading it from Google Fonts.
