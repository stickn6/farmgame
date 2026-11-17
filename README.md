# 🌻 Sunny Acres

A cozy 3D farming game built with **Vite + three.js**. Runs in the browser today and is built touch-first so it can be wrapped for iOS and Android later.

## Run it

```bash
npm install
npm run dev      # opens on http://localhost:5173 (also exposed on your LAN so you can test on a phone)
npm run build    # production build in dist/
npm run preview  # serve the production build
```

## What's in the game

- **Crops:** plow land, plant 7 crops (wheat, carrot, corn, sunflower, tomato, strawberry, pumpkin). Each crop has 4 visible growth stages. Swipe across ripe crops to harvest a whole field at once.
- **Animals:** build a Chicken Coop, Cow Pasture or Sheep Meadow, then buy animals. They wander their pen. Feed them crops and they give you eggs, milk or wool.
- **Production:** the Bakery, Dairy and Loom turn raw goods into bread, cookies, pie, butter, cheese and sweaters. Each has a 3-slot queue.
- **Orders:** the order board and the 🚚 button show 4 delivery requests. They pay about 50% more than selling in the barn, and the truck drives off when you deliver.
- **Progression:** XP and levels unlock new crops, animals, buildings and decorations. A guided goal list teaches the game, then turns into endless goals.
- **Land expansion:** clear the wild meadow to grow the farm from 16×16 up to 32×32 tiles.
- **Decor:** trees, flowers, fences, paths, hay, a scarecrow, lamps that light up at night, a bench, a well and a spinning windmill. You can move or sell decor, and move any building.
- **World:** a day/night cycle (one day is 10 real minutes), drifting clouds, a pond, a forest, a farm dog, chimney smoke and particle effects.
- **Audio:** sound effects and a gentle generative music loop. Everything is synthesized with WebAudio, so the game has no audio files.
- **Saving:** the game autosaves to `localStorage`. Crops, animals and production keep progressing while the game is closed.

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Move camera | drag (Hand tool) or two fingers | drag (Hand) · right-drag · WASD / arrows |
| Zoom | pinch | mouse wheel · `+` / `-` |
| Rotate | — | `Q` / `E` |
| Tools | toolbar | `1` Hand · `2` Plow · `3` Seeds · `4` Clear |
| Panels | toolbar | `P` Shop · `B` Barn · `O` Orders · `Esc` close |
| Placing buildings | drag, then ✓ | click to place · `R` rotate |

## Project structure

```
src/
  main.js            Controller: wires input → game rules → views/effects/UI, main loop
  game/
    config.js        All game data & balancing (items, crops, animals, recipes, buildings, quests, levels)
    state.js         Game model + rules + save/load (no rendering; emits events)
    assets.js        Procedural low-poly models, baked to 1 vertex-colored mesh each (few draw calls)
    world.js         Renderer, camera rig, lights, day/night, ground, forest, pond, road, clouds
    views.js         Syncs the 3D scene with the model (soil, crops, buildings, animals, dog, ghost)
    input.js         Unified touch / mouse / keyboard (pan, pinch, paint, tap)
    effects.js       Particle bursts, floating text, "fly to UI" icons
    audio.js         WebAudio synth SFX + generative music
  ui/
    hud.js           DOM HUD: toolbar, shop, barn, orders, production, quests, level-up
    bubbles.js       Speech bubbles pinned to 3D objects
```

To add content, start in `config.js`. For example, a new crop needs an entry in `ITEMS` and `CROPS` plus a `case` in `assets.js → crop()`.

## Going mobile (next steps)

The game already uses safe-area insets, prevents browser zoom and scroll, and has touch gestures and large hit targets. To ship it as an app:

1. Add [Capacitor](https://capacitorjs.com/): `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`, then `npx cap init` and `npx cap add ios android`.
2. `npm run build && npx cap sync` to copy `dist/` into the native projects.
3. Swap `localStorage` for `@capacitor/preferences` (or cloud saves) and bundle the Fredoka font locally instead of loading it from Google Fonts.
