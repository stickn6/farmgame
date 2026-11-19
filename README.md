# 🌻 Sunny Acres

A cozy 3D farming game built with **Vite + three.js**. Runs in the browser today and is built touch-first so it can be wrapped for iOS and Android later.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173 (also on your LAN, so you can test on a phone)
npm run build    # production build in dist/
npm test         # game-rule and guide tests (Node, no browser)
npm run sim      # pacing simulator: how long each level/unlock takes, bots and a guided beginner
```

`/gallery.html?keys=coop,cow,tree:apple:fruit` (while `npm run dev` is running) shows any 3D models side by side.

## What's in the game

**A guided start.** Grandma Mabel hands you her farm, which has gone a bit wild, and walks you through the first chapter (see [Tutorial and guide](#tutorial-and-guide)).

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

**Turn and tilt.** Twist two fingers to turn your farm, or tap **🧭** for a small view pad: ↺ ↻ turn it 90°, ▲ *Top* / ▼ *Side* step through 5 tilt levels, and *Home* goes back to the usual view. Hold 🧭 to go Home, or drag it to orbit. Your view is remembered between visits. 🧭 and the twist arrive at the end of the tour; while Mabel holds the screen during the tour, the camera stays put.

**The Post.** Your first parcel comes 5 minutes after you start, and each next one is on its way the moment you open the last: 10 min, 15 min, 30 min, then 3 hours, then every 8 hours. One always waits for you, even while the game is closed; parcels never pile up or expire. The 📪 pill (next to 🧭) counts down and turns into 📬 *Open!*; you open each parcel yourself with a little reveal. They come from Grandma Mabel and the villagers with a note, and hold gems, keepsakes for Mabel's album, pantry goods and a little coin that grows with your level (the first coins at 4 hours), plus a 📮 **Mailbox** for your farm at 1 hour: its flag goes up when a parcel waits. Parcels never give XP or building materials. Farms from before the Post get one *Post office opening* parcel instead of the welcome ones.

**Mabel's Keepsake Album** (🏆 → 📖 Album). 72 keepsakes on 12 pages of 6. They turn up while you farm (each page has a favourite source: crops, animals, workshops, orders and visitors, fruit, or anywhere) and in parcels, and you never get a duplicate. The chance of a find grows with the XP an action earns, with a pity meter, so quick crops can't farm them. The album opens with Kip's clover in parcel #3 (or at level 8); page 1 opens with it, the others at levels 8, 11, 14, 17, 19, 24, 27, 31, 35, 37 and 39. A full page pays gems and a one-of-a-kind recoloured decoration (the Bluebird Bath, Copper Well, … Silver Rooster, Sky Balloon) to put up on the farm (tapping a one-of-a-kind piece offers 📦 **Put away** instead of Remove: it goes back to Shop → Decor → 🎁, gilding and all, to place again for free); the first 8 pages also bring the **Curio Cabinet** and the title *Keeper of Keepsakes*, all 12 *Valley Historian*. Album rewards never give XP or building materials. 🏆 **Treasures** holds the album, the ribbons and the achievements (**Awards**).

**Mayor Hank's Prettiest Farm** (🏆 → 💗 Ribbons, from level 19). Decorations make your farm charming: every placed decoration adds 💗 charm (4·√price, or its own value for the one-of-a-kind pieces), and up to 3 of each kind count. Charm climbs 30 ribbon ranks that pay 124 gems in all, the **Blossom Oak** (rank 5) and **Frosted Pine** (rank 15), titles (*Charming Farm* … *Grand Champion Farm*) and, at rank 10, a 🎀 rosette on your level star. Claimed ranks are kept even if you sell decorations later. From level 31 you can **gild** a premium piece (a flower arch, fountain, gazebo, rooster or balloon, or its album recolour) with coins and gems or a gilding voucher from Mabel's last album pages: it shines gold and counts triple. Gilding is the late-game coin and gem sink (up to about 0.6M coins and 332 gems); selling a gilded piece refunds only the usual half price. Shop → Decor shows what each piece adds (💗 +253 · 1/3 counted), and tapping a decoration shows its charm and the ✨ Gild button. Ribbons never give XP, coins or building materials.

**Village projects** (L16+). Restore the Old Bridge, the Bandstand and the Greenhouse, and turn your farmhouse into the **Master Farmhouse**. You donate coins and goods across 3 stages, which you can watch being built, and each finished project gives a small permanent perk.

**Progression and pacing** (see below).
- XP levels, with something unlocked at every level from 2 to 30.
- A **Silo** and **Barn** with limited capacity.
- Rare **building materials** (planks, bolts, paint).
- Field limits per level, and building limits per level.
- **Land expansion**, 8 steps from 16×16 to 32×32.

**Extras.**
- Achievements (🏆 → Awards).
- Gems, an earned-only currency for skipping timers, buying a few missing materials or unlocking production slots early.
- Premium decorations, from bird baths to a hot-air balloon.
- A day/night cycle, a farm dog, and synthesized music and sound.

**Saving.** Autosaves to `localStorage`. Everything keeps progressing while the game is closed, and setting the clock back doesn't undo time. Saves from the first version migrate automatically:
- you keep your level and how far through it you were;
- you keep anything you had already unlocked;
- crops that were ripe stay ripe, and factories keep their slots;
- a backup of the old save is stored.

Saves from before the tutorial update keep their current goal (mapped onto the new goal list), skip the tour and start with hints set to *Glow only*. They get no starter debris, ripe field or free bake.

Saves from before the Post (save version 3) move to version 4:
- a young farm (level 6 or below, started with the tour, less than 4 hours old), or one still in the guided tour however long ago it was played, gets the full run of welcome parcels, the first one a minute after loading at the earliest;
- every other farm gets one *Post office opening* parcel from Mayor Hank, waiting on the 📬 pill (it never pops up by itself): the Mailbox to put up, 💎5, a little coin and Kip's clover, which opens Mabel's album. After that a parcel comes every 8 hours, and a single *What's new* card explains the Post, the album and 🧭;
- the new level-up tips (levels 31, 35, 37 and 39) are marked as seen when the farm is already past them, and the view starts at Home.

The save also keeps the Post's countdown, the album, ribbon ranks, gilding vouchers and titles, which decorations are gilded, your turn and tilt, and the album's own random seed (so keepsake picks never change the orders, visitors or drops). On every load the Post's countdown is capped at one full gap plus 5 minutes, so a save written while the clock was ahead is never locked out of its parcels.

## Tutorial and guide

**Chapter 1, "A Fresh Start"** (about 7 minutes, levels 1–4) is a guided tour. Mabel's finger points at one thing at a time: harvest the ripe wheat, plant, deliver an order, build a coop, buy and feed chickens, plow, plant carrots, collect eggs (tidying weeds and stones while you wait, and opening your first parcel when the Post arrives at 5 minutes), build a bakery and bake bread. The HUD fills in as each part is needed. Only the first three taps hold the screen, and even those let go after a second missed tap.

Graduation ends the tour. You open a chest (gems and a Scarecrow to place), claim your first daily gift, and Mabel shows you the goal card. 🧭 and the Post's pill join the HUD at this point. "I've farmed before" on her welcome card, or **Skip tour** in ⚙️ Settings, skips straight to the coached mode with the same goals.

**Chapters 2 and 3** ("Barnyard Friends", "Open for Business") take the scripted goals to about level 9 or 10. Each chapter's chest holds gems and a decoration, never coins, XP or materials. After that come the endless repeat goals.

**Modes** (they only move forward):

| Mode | When | Help |
|---|---|---|
| guided | the Chapter 1 tour | the finger on every step, and a Mabel line for each |
| coached | after graduation or a skip, and for older saves below level 10 | nothing automatic. With hints on *Full*, an idle target glows after 25 s and gets the finger after 50 s |
| independent | after the scripted goals, or at level 10 | a glow after 45 s idle |

**Show me.** Tap the goal card (👆) and the finger walks you through it, e.g. Shop → Buildings → Dairy → ✓. Long-press the card for a text hint. The card also shows what's in the way:
- a coin bar (🪙217/400);
- a level lock (🔒 Reach Lv 5);
- or a materials line, which has no finger because materials drop while you farm.

When the goal is a wait, a **Meanwhile** row suggests something useful to do in the meantime (collect, harvest, deliver, cook, plant, tidy up, …), or tells you everything's busy and what's ready next.

**Settings** (⚙️):
- **Hints:** *Full*, *Glow only* or *Off*. Show me always works.
- **Tap harvests whole field.**
- **Camera:** two-finger turn on/off and **Reset view** (shown once 🧭 is out, at the end of the tour). Your turn and tilt are remembered.
- **Skip tour**, shown only during the tour.

**Mabel's other appearances.**
- She is your first visitor at level 7, asking for something you already have (when you hold enough of anything).
- She pops up once each for a nearly full Silo or Barn, your first building material, the extra workshop slot at level 6 and that first visit.
- From level 5, each level-up brings a one-line tip about what it unlocks.

**New-farm assists.** These are plain once-per-save rules, and the pacing bot never uses them:
- the 6 starter plots begin ripe;
- the first bread job can be finished for free;
- 12 bits of starter debris (weeds, stones, stumps) give 1–3 coins and a little XP each;
- if a farm is truly stuck (no coins for seeds, nothing growing, nothing to sell), Mabel gives 🪙20, at most once a day.

The planner behind all of this (`src/game/guide.js`) is pure: it reads the game and returns the next step and its target, and every purchase still needs your tap. `tools/simui.mjs` plays those steps headlessly for the tests and the sim.

## Pacing

The goal: nobody unlocks everything in one sitting, the first 15 minutes are full of level-ups, and the framework leaves room for future content.

Simulated with `tools/sim.mjs`. The bots play the real rules at realistic tap speed. They open every parcel and claim every album page the moment they can (like the daily gift, at no tap cost), but never put up gifts or decorate. The **guided beginner** is a new player who does exactly what Mabel points at. It follows the real planner through a headless HUD and costs:
- 4 s per tap, doubled the first time a kind of button is used;
- 3 s per new Mabel line;
- 6 s per level-up modal.

The beginner column is the median of 5 seeds, with the range in brackets, because visitor and order requests are random.

| Milestone | Guided beginner (first sitting) | Non-stop efficient | Engaged (~40 min/day) | Casual (~30 min/day) | Light (~16 min/day) |
|---|---|---|---|---|---|
| Chickens (L2) / Bakery (L3) | 0.6 / 3 min | 0.1 / 0.9 min | same | same | same |
| First parcel opened | 5:14 (in Chapter 1's egg wait) | 5 min | 5 min | 5 min | 5 min |
| Parcels after that | 15, 31 and 61 min | 15 min, 30 min, 1 h, 4 h | 15 min, then 2 a day | 2 a day | 2 a day |
| Chapter 1 (tour) done | 7.3 min | — | — | — | — |
| Cows (L5) | 13 min | 8.5 min | 8.5 min | 4.5 h (2nd session) | 8.5 min |
| Visitors (L7) | 30 min (26–34) | 24 min | day 1 | day 1 | day 1 |
| L10 | 83 min (78–84) | 63 min | day 1 | day 1.2 | day 2 |
| All scripted goals | 72 min (63–104) | — | — | — | — |
| Market Wagon (L14) | — | 2.7 h | day 2 | day 3 | day 5 |
| L20 | — | 7.4 h | day 5 | day 6.2 | day 11 |
| L25 | — | — | day 8.4 | day 10.4 | day 18 |
| **Last unlock (L30)** | — | **— (not in an 8 h sitting)** | **day 16** | **day 20** | **day 34** |
| Album pages 1–8 / all 12 | — | page 1 at 4 h | day 24 / day 44 | day 25 / day 51 | day 28 / day 84 |
| Ribbon rank 10 / 20 / 30 (with `--decorator 0.5`) | — | — (L19 at 6.4 h) | day 10 / 20 / 29 | day 11 / 23 / 37 | day 19 / 42 / 73 |

Other beginner figures (median of 5 seeds):
- the longest gap between rewards (harvests, collections, goods, orders, visitors, parcels, keepsakes, goals, levels) in the first 30 minutes is 93 s (worst seed 128 s);
- about a third of the time is spent waiting on timers;
- the Silo first reaches 90% at about 15 minutes.

**Prettiest Farm.** The plain bots never decorate, so their charm is the starter decor (rank 1). A `--decorator 0.5` engaged bot puts up its gifts and, from L19, spends half of what it earns (above 2,000 + 400·L) on the best 💗 per coin, gilding from L31: rank 10 on day 10.4, rank 20 on day 20, all 30 on day 29 (about 0.26M coins and 170 gems sunk by then, out of 0.7M coins earned). The same decorator on the casual profile reaches ranks 10 / 20 / 30 on days 11 / 23 / 37, and on the light profile on days 19 / 42 / 73. A player who only puts up gifts reaches rank 3 at L19 (day 4.4) and rank 11 by day 25.

**The Post and the album** never pay XP or building materials, and the first coins come at 4 hours. On days 2–30 they add, per day: 2 parcels, coins and pantry goods worth about 3% of the coins a player earns (engaged 3.1%, casual 3.3%, light players 5.3%, as intended catch-up), and about 6 new gems. With them turned off (`--features off`) the non-stop bot reaches every level up to L16 at exactly the same minute (the album draws from the save's own random numbers, so orders, visitors and drops don't change), and the engaged bot's L30 over 12 seeds is day 15.8 against 16.0 without them (a single seed can move by up to about three days either way).

Before the v2 pacing update, the simulated player unlocked **everything in ~12 minutes**. The bots play efficiently, so real players will probably take 20–30% longer.

How it's paced:
- **XP curve.** `xpToNext(L) = 10L + L^2.8` (`config.js` → `xpToNext`).
- **Field cap.** The number of fields grows with your level, and each new field costs a bit more. Clearing a field refunds its cost. (`PLOTS`)
- **Storage.** The Silo holds crops and fruit; the Barn holds goods. Each upgrade tier needs a player level, coins and materials. (`STORAGE`)
- **Materials.** They drop in proportion to the XP you earn, with a pity timer, so spamming quick crops can't farm them. They are shared between storage and land, so you choose what to build first. (`DROPS`)
- **Building limits.** Your 2nd and 3rd pens of a type unlock later. Workshops are one each. Extra production slots cost coins and need a level, or cost gems. (`OBJECTS[].limit`, `QUEUE_SLOTS`)
- **Timers.** Higher tiers take longer. Short crops pay best per minute while you play; long ones pay best per check-in.
- **Catch-up rewards.** Chores, wagon crates and project stages pay a fixed *share of your current level*. That helps casual players without letting fast players race ahead.

Commands:
- `npm run sim` prints a pacing report, with a Post / album line per profile and each beginner seed's first parcel. `--profile active|casual|engaged|light|beginner` runs one profile; `--seeds n` sets the number of beginner seeds; `--seed n` picks the bots' seed; `--features off` turns the Post, the album and ribbons off (for an A/B; the v4 checks are skipped); `--decorator 0.5` makes the bot decorate and gild (Prettiest Farm ranks on days 7–60 and the coins sunk; report only).
- `npm run sim:check` fails if a balance change breaks these targets:
  - **Non-stop bot:**
    - L6 within 15 minutes, but L5 no sooner than 6.5 minutes and L7 no sooner than 18;
    - L10 at 52–100 minutes;
    - L15 at 2.5–5 hours;
    - nothing near "everything unlocked" in a single 8-hour sitting.
  - **Engaged bot:** L30 between day 13 and day 24.
  - **Every level** unlocks something.
  - **Guided beginner, on every seed:**
    - Chapter 1 within 10 minutes;
    - L4 within 8 minutes;
    - L6 at 13–25 minutes;
    - L7 within 35 minutes;
    - no gap over 180 s between rewards in the first 30 minutes;
    - no planner dead ends.
  - **Guided beginner, median seed:** every scripted goal done within 90 minutes.
  - **The Post and the album** (one seed each):
    - parcels, album pages and ribbons pay no XP and no building materials (measured around every bot claim, and in `grant()`'s tallies);
    - the non-stop bot opens parcels #1–#5 at 5 min, 15 min, 30 min, 1 h and 4 h; the engaged bot opens 1.8–2.2 a day on days 2–30;
    - on the engaged bot's days 2–30, the Post's coins and goods stay within 4% of the coins it earns, and parcels plus album pages give at most 7 gems a day;
    - the guided beginner opens parcel #1 between 5:00 and 6:30, before Chapter 1 ends (every seed);
    - the album isn't filled absurdly early: at most 16 keepsakes in 8 hours of non-stop play; the engaged bot completes pages 1–8 between day 15 and day 35, and all 12 between day 35 and day 60 (its run is 60 days);
    - the welcome parcels #1–#4 hold no coins or goods;
    - levels 31, 35, 37 and 39 unlock something (album pages);
    - Prettiest Farm: the engaged bot, which never decorates, stays below ribbon rank 10; an engaged decorator (`--decorator 0.5`, a 21-day run) reaches rank 10 no sooner than day 7.
  - The checks for the Post, the album and the ribbons run on a single seed. There is no separate A/B command: compare `npm run sim -- --features off` with a normal run by hand (the last comparison is in the paragraph above).

To add content, use the reserved levels 31+ (`FUTURE_SLOTS` in config.js). Give the new thing a level and a timer, and the price/XP formulas in config.js price it for you.

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Move camera | drag (Hand tool) or two fingers | drag (Hand) · right-drag · WASD / arrows |
| Zoom | pinch | mouse wheel · `+` / `-` |
| Turn | twist two fingers · 🧭 ↺ ↻ · drag 🧭 | `E` ↺ / `Q` ↻ · middle-drag or Ctrl/⌘+drag |
| Tilt | 🧭 ▲ Top / ▼ Side · drag 🧭 | `Z` / `X` · `PageUp` / `PageDown` · Shift+wheel · middle-drag |
| Home view | 🧭 Home · hold 🧭 | `C` / `Home` |
| Tools | toolbar | `1` Hand · `2` Plow · `3` Seeds · `4` Clear |
| Panels | toolbar · 🎁 Today · 🏆 · ⚙️ | `P` Shop · `B` Storage · `O` Orders · `Esc` close |
| Placing buildings | drag, then ✓ | click to place · `R` rotate |
| Help with the goal | tap the goal card (Show me) · long-press for a hint | click the goal card |

## Project structure

```
src/
  main.js              Controller: input → game rules → views/effects/UI, main loop
  gallery.js           Dev model gallery (gallery.html)
  game/
    config.js          ALL data & balancing (items, crops, animals, recipes, buildings, storage,
                       drops, fields, land, gems, daily, mastery, achievements, visitors, quests,
                       chapters, XP) + the tutorial's lines, lots and tips
    state.js           Game model + rules + save/load/migration (no rendering; emits events)
    layout.js          Pure helpers: field patches, smart building spots, plow suggestions
    guide.js           Guide planner (pure): the next step for the current goal, Show me, Meanwhile
    guide-keys.js      The data-guide target keys the HUD renders and the planner points at
    camera.js          Pure turn & tilt helpers (90° steps, tilt levels, Home, snap, two-finger twist)
    assets.js          Procedural model toolkit + original models, baked to 1 mesh each
    models/*.js        Additional models (buildings, decor, animals & villagers, crops & trees)
    world.js           Renderer, camera rig, lights, day/night, ground, forest, pond, road, clouds
    views.js           Syncs the 3D scene with the model (fields, buildings, trees, animals, visitors)
    input.js           Unified touch / mouse / keyboard
    effects.js         Particles, floating text, "fly to UI" icons
    audio.js           WebAudio synth sound effects + generative music
  ui/
    hud.js             DOM HUD: toolbar, shop, storage, orders, production, visitors, the Post pill and parcel
                       reveal, 🧭 view pad, 🏆 Treasures (album, ribbons, awards)…
    guide-ui.js        Mabel's card, finger, spotlight and hints (GuideLayer + GuideController)
    guide.css          Styles for the guide layer (imported by guide-ui.js)
    bubbles.js         Speech bubbles pinned to 3D objects
tools/
  test.mjs             Rule tests (npm test)
  test-guide.mjs       Planner tests, guide-follower runs and the wander fuzz (npm test)
  simui.mjs            Headless HUD + guide follower used by the guide tests and the sim
  sim.mjs              Pacing simulator + guardrails (npm run sim / npm run sim:check)
  gallery-shot.cjs     Screenshot the model gallery (needs the dev server running)
```

## Going mobile (next steps)

The game already uses safe-area insets, prevents browser zoom and scroll, and has touch gestures and large hit targets. To ship it as an app:

1. Add [Capacitor](https://capacitorjs.com/): `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`, then `npx cap init` and `npx cap add ios android`.
2. `npm run build && npx cap sync` to copy `dist/` into the native projects.
3. Swap `localStorage` for `@capacitor/preferences` (or cloud saves).
4. Bundle the Fredoka font locally instead of loading it from Google Fonts.
