// All static game data lives here so balancing and adding content is easy.

export const MAP_SIZE = 32; // total tiles per side (land can expand up to this)
export const START_LAND = 16; // unlocked square at start
export const LAND_STEP = 4; // tiles gained per expansion (2 per side)
export const landExpandCost = (size) => Math.round(150 * Math.pow((size - START_LAND) / LAND_STEP + 1, 1.8));
export const landExpandLevel = (size) => 2 + ((size - START_LAND) / LAND_STEP) * 2;

// ---------------------------------------------------------------- items
export const ITEMS = {
  wheat: { name: 'Wheat', icon: '🌾', price: 2 },
  carrot: { name: 'Carrot', icon: '🥕', price: 5 },
  corn: { name: 'Corn', icon: '🌽', price: 9 },
  sunflower: { name: 'Sunflower', icon: '🌻', price: 14 },
  tomato: { name: 'Tomato', icon: '🍅', price: 18 },
  strawberry: { name: 'Strawberry', icon: '🍓', price: 26 },
  pumpkin: { name: 'Pumpkin', icon: '🎃', price: 40 },
  egg: { name: 'Egg', icon: '🥚', price: 12 },
  milk: { name: 'Milk', icon: '🥛', price: 30 },
  wool: { name: 'Wool', icon: '🧶', price: 45 },
  bread: { name: 'Bread', icon: '🍞', price: 14 },
  cookie: { name: 'Cookie', icon: '🍪', price: 42 },
  pie: { name: 'Pumpkin Pie', icon: '🥧', price: 150 },
  butter: { name: 'Butter', icon: '🧈', price: 75 },
  cheese: { name: 'Cheese', icon: '🧀', price: 120 },
  sweater: { name: 'Sweater', icon: '🧥', price: 120 },
};

// ---------------------------------------------------------------- crops
// growTime in seconds; yield = items per harvest
export const CROPS = {
  wheat: { name: 'Wheat', seedCost: 1, growTime: 20, yield: 2, xp: 1, level: 1 },
  carrot: { name: 'Carrot', seedCost: 3, growTime: 45, yield: 2, xp: 2, level: 1 },
  corn: { name: 'Corn', seedCost: 6, growTime: 90, yield: 2, xp: 3, level: 3 },
  sunflower: { name: 'Sunflower', seedCost: 10, growTime: 150, yield: 2, xp: 4, level: 5 },
  tomato: { name: 'Tomato', seedCost: 12, growTime: 200, yield: 2, xp: 5, level: 6 },
  strawberry: { name: 'Strawberry', seedCost: 18, growTime: 300, yield: 2, xp: 7, level: 7 },
  pumpkin: { name: 'Pumpkin', seedCost: 30, growTime: 420, yield: 2, xp: 10, level: 9 },
};

// ---------------------------------------------------------------- animals
export const ANIMALS = {
  chicken: { name: 'Chicken', icon: '🐔', cost: 25, food: 'wheat', foodQty: 1, product: 'egg', time: 60, xp: 3, level: 2, home: 'coop' },
  cow: { name: 'Cow', icon: '🐄', cost: 120, food: 'corn', foodQty: 1, product: 'milk', time: 150, xp: 6, level: 4, home: 'cowbarn' },
  sheep: { name: 'Sheep', icon: '🐑', cost: 220, food: 'carrot', foodQty: 2, product: 'wool', time: 240, xp: 8, level: 6, home: 'sheepfold' },
};

// ---------------------------------------------------------------- recipes (production buildings)
export const RECIPES = {
  bread: { inputs: { wheat: 3 }, time: 30, xp: 3, building: 'bakery' },
  cookie: { inputs: { wheat: 2, egg: 2 }, time: 90, xp: 7, building: 'bakery' },
  pie: { inputs: { pumpkin: 2, egg: 2, wheat: 2 }, time: 240, xp: 18, building: 'bakery' },
  butter: { inputs: { milk: 2 }, time: 120, xp: 8, building: 'dairy' },
  cheese: { inputs: { milk: 3 }, time: 200, xp: 12, building: 'dairy' },
  sweater: { inputs: { wool: 2 }, time: 240, xp: 12, building: 'loom' },
};

// ---------------------------------------------------------------- placeable objects
// kind: 'house' | 'pen' | 'factory' | 'decor' | 'special'
export const OBJECTS = {
  farmhouse: { name: 'Farmhouse', kind: 'house', size: [3, 3], cost: 0, level: 99, fixed: true },
  orderboard: { name: 'Order Board', kind: 'special', size: [2, 1], cost: 0, level: 99, fixed: true },

  coop: { name: 'Chicken Coop', icon: '🐔', kind: 'pen', size: [4, 4], cost: 60, level: 2, animal: 'chicken', capacity: 6, xp: 5, desc: 'Home for chickens. They lay eggs.' },
  cowbarn: { name: 'Cow Pasture', icon: '🐄', kind: 'pen', size: [5, 5], cost: 300, level: 4, animal: 'cow', capacity: 5, xp: 10, desc: 'A red barn & pasture for cows.' },
  sheepfold: { name: 'Sheep Meadow', icon: '🐑', kind: 'pen', size: [5, 5], cost: 600, level: 6, animal: 'sheep', capacity: 5, xp: 15, desc: 'Fluffy sheep grow wool here.' },

  bakery: { name: 'Bakery', icon: '🍞', kind: 'factory', size: [3, 3], cost: 120, level: 3, queue: 3, xp: 8, desc: 'Bake bread, cookies and pies.' },
  dairy: { name: 'Dairy', icon: '🧀', kind: 'factory', size: [3, 3], cost: 450, level: 5, queue: 3, xp: 12, desc: 'Churn butter and age cheese.' },
  loom: { name: 'Loom', icon: '🧥', kind: 'factory', size: [3, 3], cost: 700, level: 7, queue: 3, xp: 15, desc: 'Knit cozy sweaters from wool.' },

  oak: { name: 'Oak Tree', icon: '🌳', kind: 'decor', size: [1, 1], cost: 15, level: 1 },
  pine: { name: 'Pine Tree', icon: '🌲', kind: 'decor', size: [1, 1], cost: 20, level: 1 },
  bush: { name: 'Bush', icon: '🌿', kind: 'decor', size: [1, 1], cost: 8, level: 1 },
  flowers: { name: 'Flower Bed', icon: '🌷', kind: 'decor', size: [1, 1], cost: 12, level: 1 },
  fence: { name: 'Fence', icon: '🪵', kind: 'decor', size: [1, 1], cost: 4, level: 1 },
  path: { name: 'Stone Path', icon: '🪨', kind: 'decor', size: [1, 1], cost: 2, level: 1, flat: true },
  hay: { name: 'Hay Bale', icon: '🟨', kind: 'decor', size: [1, 1], cost: 10, level: 2 },
  scarecrow: { name: 'Scarecrow', icon: '🧑‍🌾', kind: 'decor', size: [1, 1], cost: 40, level: 2 },
  lamp: { name: 'Lamp Post', icon: '🏮', kind: 'decor', size: [1, 1], cost: 35, level: 3 },
  bench: { name: 'Bench', icon: '🪑', kind: 'decor', size: [2, 1], cost: 30, level: 3 },
  well: { name: 'Well', icon: '⛲', kind: 'decor', size: [2, 2], cost: 90, level: 4 },
  windmill: { name: 'Windmill', icon: '🌬️', kind: 'decor', size: [3, 3], cost: 400, level: 5 },
};

// ---------------------------------------------------------------- levels
export function xpForLevel(level) {
  // total xp needed to REACH `level` (level 1 = 0)
  if (level <= 1) return 0;
  let total = 0;
  for (let l = 1; l < level; l++) total += Math.round(12 * Math.pow(l, 1.55));
  return total;
}

export function unlocksAtLevel(level) {
  const list = [];
  for (const [id, c] of Object.entries(CROPS)) if (c.level === level) list.push({ icon: ITEMS[id].icon, name: c.name + ' seeds' });
  for (const a of Object.values(ANIMALS)) if (a.level === level) list.push({ icon: a.icon, name: a.name });
  for (const o of Object.values(OBJECTS)) if (o.level === level) list.push({ icon: o.icon, name: o.name });
  return list;
}

// Which items can appear in orders at this level (things the player can produce)
export function producibleItems(level) {
  const out = [];
  for (const [id, c] of Object.entries(CROPS)) if (c.level <= level) out.push(id);
  for (const a of Object.values(ANIMALS)) if (a.level <= level) out.push(a.product);
  for (const [id, r] of Object.entries(RECIPES)) {
    const b = OBJECTS[r.building];
    if (b.level > level) continue;
    // all inputs must be producible too
    const ok = Object.keys(r.inputs).every((i) => out.includes(i) || (CROPS[i] && CROPS[i].level <= level));
    if (ok) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------- quests (guided goals)
export const QUESTS = [
  { text: 'Plow 4 plots of land', event: 'plow', count: 4, reward: { coins: 10, xp: 2 }, hint: 'Pick the 🚜 Plow tool and tap/drag on grass.' },
  { text: 'Plant 4 wheat', event: 'plant', filter: 'wheat', count: 4, reward: { coins: 10, xp: 2 }, hint: 'Pick 🌱 Seeds → Wheat, then tap your plowed soil.' },
  { text: 'Harvest 8 wheat', event: 'harvest', filter: 'wheat', count: 8, reward: { coins: 15, xp: 3 }, hint: 'Swipe across golden wheat with ✋ to harvest.' },
  { text: 'Deliver an order', event: 'order', count: 1, reward: { coins: 20, xp: 5 }, hint: 'Open 🚚 Orders and fill a request.' },
  { text: 'Plant 6 carrots', event: 'plant', filter: 'carrot', count: 6, reward: { coins: 15, xp: 3 } },
  { text: 'Reach level 2', event: 'level', count: 2, absolute: true, reward: { coins: 20 } },
  { text: 'Build a Chicken Coop', event: 'build', filter: 'coop', count: 1, reward: { coins: 30, xp: 5 }, hint: 'Open 🏪 Shop → Buildings.' },
  { text: 'Buy 3 chickens', event: 'buyAnimal', filter: 'chicken', count: 3, reward: { coins: 30, xp: 5 }, hint: 'Shop → Animals. Tap the coop to feed them wheat.' },
  { text: 'Collect 5 eggs', event: 'collect', filter: 'egg', count: 5, reward: { coins: 40, xp: 8 } },
  { text: 'Expand your land', event: 'expand', count: 1, reward: { coins: 50, xp: 8 }, hint: 'Shop → Land.' },
  { text: 'Build a Bakery', event: 'build', filter: 'bakery', count: 1, reward: { coins: 40, xp: 8 } },
  { text: 'Bake 3 bread', event: 'produce', filter: 'bread', count: 3, reward: { coins: 50, xp: 10 }, hint: 'Tap the Bakery to start baking.' },
  { text: 'Deliver 5 orders', event: 'order', count: 5, reward: { coins: 80, xp: 15 } },
  { text: 'Build a Cow Pasture', event: 'build', filter: 'cowbarn', count: 1, reward: { coins: 80, xp: 15 } },
  { text: 'Collect 5 milk', event: 'collect', filter: 'milk', count: 5, reward: { coins: 100, xp: 20 } },
  { text: 'Build a Dairy', event: 'build', filter: 'dairy', count: 1, reward: { coins: 100, xp: 20 } },
];

// After the scripted quests run out we generate endless ones from these templates.
export const REPEAT_QUESTS = [
  (n) => ({ text: `Harvest ${20 + n * 10} crops`, event: 'harvest', count: 20 + n * 10 }),
  (n) => ({ text: `Deliver ${3 + n} orders`, event: 'order', count: 3 + n }),
  (n) => ({ text: `Collect ${8 + n * 4} animal goods`, event: 'collect', count: 8 + n * 4 }),
  (n) => ({ text: `Make ${4 + n * 2} goods`, event: 'produce', count: 4 + n * 2 }),
  (n) => ({ text: `Earn ${300 + n * 200} coins`, event: 'earn', count: 300 + n * 200 }),
];
