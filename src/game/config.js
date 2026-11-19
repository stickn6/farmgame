// All static game data & balancing lives here. Systems in state.js read these tables,
// so adding content = adding rows. See tools/sim.mjs for the pacing simulator.
//
// PACING PHILOSOPHY
//  - First 10-15 min: fast crops, several level-ups, first animals → hook.
//  - Then the XP curve outgrows income, timers lengthen, and soft gates kick in:
//    field caps per level, storage capacity (upgraded with rare materials),
//    building limits per level, and land expansion needing deeds.
//  - Content is spread over levels 1-30 (every level unlocks something); levels 31+
//    hold the last album pages and are otherwise reserved for future updates (see FUTURE_SLOTS at the bottom).
//  - Numbers were picked by a design panel and checked with tools/sim.mjs, which drives
//    these exact rules with a bot: run `npm run sim` after changing anything.

export const MAP_SIZE = 32; // total tiles per side (land can expand up to this)
export const START_LAND = 16; // unlocked square at start
export const LAND_STEP = 2; // tiles gained per expansion (1 per side)

const min = (m) => m * 60; // minutes → seconds
const hr = (h) => h * 3600;

// ---------------------------------------------------------------- start
export const START = { coins: 50, gems: 10, inventory: { wheat: 4 } };

// ---------------------------------------------------------------- items
// cat decides which storage holds it: crop/fruit → Silo, everything else → Barn.
// price/xp for animal products & goods are derived below from their inputs + time.
export const ITEMS = {
  // crops
  wheat: { name: 'Wheat', icon: '🌾', cat: 'crop', price: 2, colors: ['#f2cf5b', '#e6bf4a', '#fff1a8'] },
  carrot: { name: 'Carrot', icon: '🥕', cat: 'crop', price: 5, colors: ['#f08a24', '#5fae3e'] },
  corn: { name: 'Corn', icon: '🌽', cat: 'crop', price: 11, colors: ['#f7cf3b', '#5fae3e'] },
  sunflower: { name: 'Sunflower', icon: '🌻', cat: 'crop', price: 19, colors: ['#f7cf3b', '#6b3d1c'] },
  tomato: { name: 'Tomato', icon: '🍅', cat: 'crop', price: 26, colors: ['#e8402f', '#5fae3e'] },
  potato: { name: 'Potato', icon: '🥔', cat: 'crop', price: 32, colors: ['#c9a26b', '#5fae3e'] },
  sugarcane: { name: 'Sugarcane', icon: '🎋', cat: 'crop', price: 42, colors: ['#9fd36a', '#e6e2a0'] },
  strawberry: { name: 'Strawberry', icon: '🍓', cat: 'crop', price: 52, colors: ['#e8304a', '#5fae3e', '#ffffff'] },
  pumpkin: { name: 'Pumpkin', icon: '🎃', cat: 'crop', price: 74, colors: ['#f08a24', '#e57a1c'] },
  cotton: { name: 'Cotton', icon: '☁️', cat: 'crop', price: 98, colors: ['#ffffff', '#5fae3e'] },
  chili: { name: 'Chili', icon: '🌶️', cat: 'crop', price: 120, colors: ['#e8302a', '#5fae3e'] },
  lavender: { name: 'Lavender', icon: '💜', cat: 'crop', price: 160, colors: ['#9b7ad8', '#5fae3e'] },
  // fruit (trees)
  apple: { name: 'Apple', icon: '🍎', cat: 'fruit', price: 14, colors: ['#e8402f', '#5fae3e'] },
  cherry: { name: 'Cherry', icon: '🍒', cat: 'fruit', price: 26, colors: ['#c8102e', '#5fae3e'] },
  peach: { name: 'Peach', icon: '🍑', cat: 'fruit', price: 40, colors: ['#ffab76', '#5fae3e'] },
  // animal products
  egg: { name: 'Egg', icon: '🥚', cat: 'animal' },
  milk: { name: 'Milk', icon: '🥛', cat: 'animal' },
  truffle: { name: 'Truffle', icon: '🍄', cat: 'animal' },
  wool: { name: 'Wool', icon: '🧶', cat: 'animal' },
  honey: { name: 'Honey', icon: '🍯', cat: 'animal' },
  goatmilk: { name: 'Goat Milk', icon: '🍼', cat: 'animal' },
  // goods
  bread: { name: 'Bread', icon: '🍞', cat: 'goods' },
  cookie: { name: 'Cookie', icon: '🍪', cat: 'goods' },
  applepie: { name: 'Apple Pie', icon: '🥧', cat: 'goods' },
  pie: { name: 'Pumpkin Pie', icon: '🥮', cat: 'goods' },
  popcorn: { name: 'Popcorn', icon: '🍿', cat: 'goods' },
  butterpop: { name: 'Butter Popcorn', icon: '🧺', cat: 'goods' },
  chilipop: { name: 'Spicy Popcorn', icon: '🔥', cat: 'goods' },
  butter: { name: 'Butter', icon: '🧈', cat: 'goods' },
  cheese: { name: 'Cheese', icon: '🧀', cat: 'goods' },
  icecream: { name: 'Ice Cream', icon: '🍦', cat: 'goods' },
  goatcheese: { name: 'Goat Cheese', icon: '🫕', cat: 'goods' },
  sugar: { name: 'Sugar', icon: '🧂', cat: 'goods' },
  caramel: { name: 'Caramel', icon: '🍬', cat: 'goods' },
  tomjuice: { name: 'Tomato Juice', icon: '🥫', cat: 'goods' },
  applejuice: { name: 'Apple Juice', icon: '🧃', cat: 'goods' },
  smoothie: { name: 'Cherry Smoothie', icon: '🥤', cat: 'goods' },
  sweater: { name: 'Sweater', icon: '🧥', cat: 'goods' },
  shirt: { name: 'Cotton Shirt', icon: '👕', cat: 'goods' },
  candle: { name: 'Honey Candle', icon: '🕯️', cat: 'goods' },
  lavcandle: { name: 'Lavender Candle', icon: '🪔', cat: 'goods' },
  peachjam: { name: 'Peach Jam', icon: '🫙', cat: 'goods' },
  caramelcorn: { name: 'Caramel Corn', icon: '🍭', cat: 'goods' },
  quilt: { name: 'Cozy Quilt', icon: '🛏️', cat: 'goods' },
  // building materials (rare drops) — used for storage upgrades and land
  plank: { name: 'Plank', icon: '🪵', cat: 'material', price: 12 },
  bolt: { name: 'Bolt', icon: '🔩', cat: 'material', price: 12 },
  paint: { name: 'Paint', icon: '🎨', cat: 'material', price: 12 },
};

// ---------------------------------------------------------------- crops
// Short crops pay best per minute but need you there; long crops are for while you're away.
export const CROPS = {
  wheat: { name: 'Wheat', seedCost: 1, growTime: 45, yield: 2, level: 1 },
  carrot: { name: 'Carrot', seedCost: 2, growTime: min(2), yield: 2, level: 2 },
  corn: { name: 'Corn', seedCost: 4, growTime: min(5), yield: 2, level: 4 },
  sunflower: { name: 'Sunflower', seedCost: 7, growTime: min(10), yield: 2, level: 6 },
  tomato: { name: 'Tomato', seedCost: 9, growTime: min(15), yield: 2, level: 8 },
  potato: { name: 'Potato', seedCost: 11, growTime: min(20), yield: 2, level: 9 },
  sugarcane: { name: 'Sugarcane', seedCost: 14, growTime: min(30), yield: 2, level: 11 },
  strawberry: { name: 'Strawberry', seedCost: 18, growTime: min(45), yield: 2, level: 13 },
  pumpkin: { name: 'Pumpkin', seedCost: 26, growTime: hr(1), yield: 2, level: 17 },
  cotton: { name: 'Cotton', seedCost: 34, growTime: hr(1.5), yield: 2, level: 19 },
  chili: { name: 'Chili', seedCost: 42, growTime: hr(2), yield: 2, level: 22 },
  lavender: { name: 'Lavender', seedCost: 55, growTime: hr(3), yield: 2, level: 25 },
};
for (const c of Object.values(CROPS)) c.xp = c.xp || Math.max(1, Math.round(1.1 * Math.pow(c.growTime / 60, 0.88)));

// ---------------------------------------------------------------- animals
export const ANIMALS = {
  chicken: { name: 'Chicken', icon: '🐔', cost: 30, costGrowth: 0.2, food: 'wheat', foodQty: 1, product: 'egg', time: min(3), level: 2, home: 'coop', sound: 'cluck', speed: 0.8 },
  cow: { name: 'Cow', icon: '🐄', cost: 150, costGrowth: 0.2, food: 'corn', foodQty: 1, product: 'milk', time: min(8), level: 5, home: 'cowbarn', sound: 'moo', speed: 0.45, scale: 0.82 },
  pig: { name: 'Pig', icon: '🐖', cost: 350, costGrowth: 0.2, food: 'carrot', foodQty: 2, product: 'truffle', time: min(15), level: 10, home: 'pigsty', sound: 'oink', speed: 0.55 },
  sheep: { name: 'Sheep', icon: '🐑', cost: 550, costGrowth: 0.2, food: 'potato', foodQty: 1, altFood: { item: 'carrot', qty: 2 }, product: 'wool', time: min(25), level: 12, home: 'sheepfold', sound: 'baa', speed: 0.5 },
  bee: { name: 'Bee Colony', plural: 'bee colonies', icon: '🐝', cost: 700, costGrowth: 0.25, food: null, foodQty: 0, product: 'honey', time: min(40), level: 15, home: 'apiary', sound: 'buzz', flying: true, scale: 1 },
  goat: { name: 'Goat', icon: '🐐', cost: 1200, costGrowth: 0.2, food: 'sunflower', foodQty: 1, product: 'goatmilk', time: min(45), level: 20, home: 'goatpen', sound: 'baa', speed: 0.6 },
};

// ---------------------------------------------------------------- recipes (production buildings)
export const RECIPES = {
  bread: { inputs: { wheat: 3 }, time: min(4), building: 'bakery', level: 3 },
  cookie: { inputs: { wheat: 2, egg: 2 }, time: min(12), building: 'bakery', level: 4 },
  applepie: { inputs: { apple: 3, wheat: 2, egg: 1 }, time: min(35), building: 'bakery', level: 10 },
  pie: { inputs: { pumpkin: 1, egg: 2, wheat: 2 }, time: hr(1), building: 'bakery', level: 17 },
  popcorn: { inputs: { corn: 2 }, time: min(8), building: 'popcorn', level: 8 },
  butterpop: { inputs: { corn: 2, butter: 1 }, time: min(25), building: 'popcorn', level: 9 },
  chilipop: { inputs: { corn: 2, chili: 1 }, time: min(40), building: 'popcorn', level: 22 },
  butter: { inputs: { milk: 2 }, time: min(15), building: 'dairy', level: 7 },
  cheese: { inputs: { milk: 3 }, time: min(40), building: 'dairy', level: 10 },
  icecream: { inputs: { milk: 2, sugar: 1, strawberry: 1 }, time: min(45), building: 'dairy', level: 16 },
  goatcheese: { inputs: { goatmilk: 2 }, time: hr(1), building: 'dairy', level: 21 },
  sugar: { inputs: { sugarcane: 1 }, time: min(12), building: 'sugarmill', level: 11 },
  caramel: { inputs: { sugar: 2, milk: 1 }, time: min(30), building: 'sugarmill', level: 13 },
  tomjuice: { inputs: { tomato: 3 }, time: min(20), building: 'juicepress', level: 13 },
  applejuice: { inputs: { apple: 3 }, time: min(25), building: 'juicepress', level: 13 },
  smoothie: { inputs: { cherry: 2, milk: 1, sugar: 1 }, time: min(45), building: 'juicepress', level: 16 },
  sweater: { inputs: { wool: 2 }, time: hr(1), building: 'loom', level: 12 },
  shirt: { inputs: { cotton: 3 }, time: hr(1.5), building: 'loom', level: 19 },
  candle: { inputs: { honey: 2 }, time: min(40), building: 'candleshop', level: 18 },
  lavcandle: { inputs: { honey: 1, lavender: 2 }, time: hr(1.5), building: 'candleshop', level: 26 },
  peachjam: { inputs: { peach: 3, sugar: 1 }, time: min(45), building: 'juicepress', level: 27 },
  caramelcorn: { inputs: { corn: 2, caramel: 1 }, time: min(50), building: 'popcorn', level: 28 },
  quilt: { inputs: { shirt: 1, sweater: 1 }, time: hr(2), building: 'loom', level: 29 },
};

// ---------------------------------------------------------------- placeable objects
// kind: 'house' | 'storage' | 'special' | 'pen' | 'factory' | 'tree' | 'decor' | 'debris'
// limit(level): how many you may own at that level (pens get a 2nd/3rd copy later).
const oneEach = () => 1;
const penLimit = (unlock) => (lvl) => (lvl < unlock ? 0 : lvl < unlock + 8 ? 1 : lvl < unlock + 18 ? 2 : 3);
const penCost = (base) => (owned) => Math.round(base * Math.pow(2.2, owned));
const treeCost = (base) => (owned) => Math.round(base * (1 + owned * 0.25));
const treeLimit = (unlock) => (lvl) => (lvl < unlock ? 0 : Math.min(8, 3 + Math.floor((lvl - unlock) / 3)));

export const OBJECTS = {
  farmhouse: { name: 'Farmhouse', kind: 'house', size: [3, 3], cost: 0, level: 99, fixed: true },
  orderboard: { name: 'Order Board', kind: 'special', size: [2, 1], cost: 0, level: 99, fixed: true },
  storagebarn: { name: 'Barn', icon: '🏚️', kind: 'storage', storage: 'barn', size: [3, 3], cost: 0, level: 99, fixed: true, chimney: null },
  silo: { name: 'Silo', icon: '🛢️', kind: 'storage', storage: 'silo', size: [2, 2], cost: 0, level: 99, fixed: true },

  coop: { name: 'Chicken Coop', icon: '🐔', kind: 'pen', size: [4, 4], cost: 80, costFn: penCost(80), limit: penLimit(2), level: 2, animal: 'chicken', capacity: 6, xp: 5, desc: 'Home for chickens. They lay eggs.' },
  cowbarn: { name: 'Cow Pasture', icon: '🐄', kind: 'pen', size: [5, 5], cost: 400, costFn: penCost(400), limit: penLimit(5), level: 5, animal: 'cow', capacity: 5, xp: 10, desc: 'A red barn & pasture for cows.' },
  pigsty: { name: 'Pig Sty', icon: '🐖', kind: 'pen', size: [4, 4], cost: 900, costFn: penCost(900), limit: penLimit(10), level: 10, animal: 'pig', capacity: 4, xp: 14, desc: 'Muddy fun. Pigs sniff out truffles.', yard: [[-1.5, 1.5, -0.2, 1.5], [0.2, 1.5, -1.5, -0.2]] },
  sheepfold: { name: 'Sheep Meadow', icon: '🐑', kind: 'pen', size: [5, 5], cost: 1300, costFn: penCost(1300), limit: penLimit(12), level: 12, animal: 'sheep', capacity: 5, xp: 18, desc: 'Fluffy sheep grow wool here.' },
  apiary: { name: 'Apiary', icon: '🐝', kind: 'pen', size: [3, 3], cost: 2000, costFn: penCost(2000), limit: penLimit(15), level: 15, animal: 'bee', capacity: 3, xp: 20, desc: 'Bee colonies make honey — no feeding needed.' },
  goatpen: { name: 'Goat Hill', icon: '🐐', kind: 'pen', size: [4, 4], cost: 3000, costFn: penCost(3000), limit: penLimit(20), level: 20, animal: 'goat', capacity: 4, xp: 26, desc: 'Sure-footed goats give rich goat milk.', yard: [[-1.5, 1.5, 0.0, 1.5], [-1.5, 0.0, -1.5, 0.0]] },

  bakery: { name: 'Bakery', icon: '🍞', kind: 'factory', size: [3, 3], cost: 150, limit: oneEach, level: 3, queue: 2, maxExtraSlots: 3, xp: 8, desc: 'Bake bread, cookies and pies.', chimney: [0.7, 2.5, -0.5] },
  popcorn: { name: 'Popcorn Stand', icon: '🍿', kind: 'factory', size: [2, 2], cost: 900, limit: oneEach, level: 8, queue: 2, maxExtraSlots: 3, xp: 10, desc: 'Pop, butter and spice up corn.', chimney: [0, 2.0, 0] },
  dairy: { name: 'Dairy', icon: '🧀', kind: 'factory', size: [3, 3], cost: 700, limit: oneEach, level: 7, queue: 2, maxExtraSlots: 3, xp: 12, desc: 'Churn butter, age cheese, scoop ice cream.' },
  sugarmill: { name: 'Sugar Mill', icon: '🧂', kind: 'factory', size: [3, 3], cost: 1600, limit: oneEach, level: 11, queue: 2, maxExtraSlots: 3, xp: 15, desc: 'Grind sugarcane into sugar and caramel.' },
  loom: { name: 'Loom', icon: '🧥', kind: 'factory', size: [3, 3], cost: 2000, limit: oneEach, level: 12, queue: 2, maxExtraSlots: 3, xp: 16, desc: 'Knit cozy sweaters and shirts.' },
  juicepress: { name: 'Juice Press', icon: '🧃', kind: 'factory', size: [2, 2], cost: 2400, limit: oneEach, level: 13, queue: 2, maxExtraSlots: 3, xp: 18, desc: 'Fresh juices and smoothies.' },
  candleshop: { name: 'Candle Shop', icon: '🕯️', kind: 'factory', size: [2, 2], cost: 3600, limit: oneEach, level: 18, queue: 2, maxExtraSlots: 3, xp: 22, desc: 'Hand-dipped candles from honey.', chimney: [0.3, 2.2, -0.2] },

  appletree: { name: 'Apple Tree', icon: '🍎', kind: 'tree', model: 'apple', fruit: 'apple', size: [1, 1], cost: 120, costFn: treeCost(120), limit: treeLimit(9), level: 9, growTime: min(30), fruitTime: min(20), harvests: 8, yield: 3, xp: 4 },
  cherrytree: { name: 'Cherry Tree', icon: '🍒', kind: 'tree', model: 'cherry', fruit: 'cherry', size: [1, 1], cost: 300, costFn: treeCost(300), limit: treeLimit(16), level: 16, growTime: hr(1), fruitTime: min(40), harvests: 8, yield: 3, xp: 8 },
  peachtree: { name: 'Peach Tree', icon: '🍑', kind: 'tree', model: 'peach', fruit: 'peach', size: [1, 1], cost: 500, costFn: treeCost(500), limit: treeLimit(23), level: 23, growTime: hr(2), fruitTime: hr(1), harvests: 8, yield: 3, xp: 12 },

  oak: { name: 'Oak Tree', icon: '🌳', kind: 'decor', size: [1, 1], cost: 15, level: 1 },
  bush: { name: 'Bush', icon: '🌿', kind: 'decor', size: [1, 1], cost: 8, level: 1 },
  flowers: { name: 'Flower Bed', icon: '🌷', kind: 'decor', size: [1, 1], cost: 12, level: 1 },
  fence: { name: 'Fence', icon: '🪵', kind: 'decor', size: [1, 1], cost: 4, level: 1 },
  path: { name: 'Stone Path', icon: '🪨', kind: 'decor', size: [1, 1], cost: 2, level: 1, flat: true },
  pine: { name: 'Pine Tree', icon: '🌲', kind: 'decor', size: [1, 1], cost: 20, level: 2 },
  hay: { name: 'Hay Bale', icon: '🟨', kind: 'decor', size: [1, 1], cost: 10, level: 2 },
  scarecrow: { name: 'Scarecrow', icon: '🧑‍🌾', kind: 'decor', size: [1, 1], cost: 40, level: 3 },
  lamp: { name: 'Lamp Post', icon: '🏮', kind: 'decor', size: [1, 1], cost: 35, level: 5 },
  bench: { name: 'Bench', icon: '🪑', kind: 'decor', size: [2, 1], cost: 30, level: 6 },
  well: { name: 'Well', icon: '🪣', kind: 'decor', size: [2, 2], cost: 120, level: 8 },
  windmill: { name: 'Windmill', icon: '🌬️', kind: 'decor', size: [3, 3], cost: 600, level: 11 },
  // premium decor: the late-game coin sink, and a way to make the farm yours
  birdbath: { name: 'Bird Bath', icon: '🐦', kind: 'decor', size: [1, 1], cost: 150, level: 4 },
  picnic: { name: 'Picnic Table', icon: '🧺', kind: 'decor', size: [2, 2], cost: 350, level: 9 },
  flowerarch: { name: 'Flower Arch', icon: '💐', kind: 'decor', size: [2, 1], cost: 1500, level: 14 },
  fountain: { name: 'Fountain', icon: '⛲', kind: 'decor', size: [2, 2], cost: 4000, level: 13 },
  gazebo: { name: 'Gazebo', icon: '🛖', kind: 'decor', size: [3, 3], cost: 9000, level: 17 },
  statue: { name: 'Golden Rooster', icon: '🐓', kind: 'decor', size: [1, 1], cost: 20000, level: 20 },
  balloon: { name: 'Hot Air Balloon', icon: '🎈', kind: 'decor', size: [2, 2], cost: 40000, level: 24 },

  // one-of-a-kind decorations (level 99: never sold, never in the Shop list): free gifts that refund nothing (removing
  // one puts it away, back to s.gifts: see oneOfAKind).
  // model: whose 3D model they reuse; tint: a recolour of it ('gold' = GOLD; tintDesat: how far its own colours fade to
  // grey first, tintLift: how far that grey is brightened (default 0.35·tintDesat), tintMetal / tintRough: a metal
  // look); charm: for Prettiest Farm. (The grey is multiplied by the tint, so a pale tint gives a greyish result:
  // the sky, frost and blossom tints are a little deeper, with more lift.)
  mailbox: { name: 'Mailbox', icon: '📮', kind: 'decor', size: [1, 1], cost: 0, level: 99, charm: 40, desc: 'The flag goes up when a parcel waits.' },
  goldscarecrow: { name: 'Golden Scarecrow', icon: '🧑‍🌾', kind: 'decor', model: 'scarecrow', tint: 'gold', size: [1, 1], cost: 0, level: 99, charm: 75 },
  goldlamp: { name: 'Golden Lamp Post', icon: '🏮', kind: 'decor', model: 'lamp', tint: 'gold', size: [1, 1], cost: 0, level: 99, charm: 75 },
  // Mabel's album page prizes: recoloured versions of real decorations (never sold), and the Curio Cabinet
  bluebath: { name: 'Bluebird Bath', icon: '🐦', kind: 'decor', model: 'birdbath', tint: '#8fc9ff', size: [1, 1], cost: 0, level: 99, charm: 60, desc: 'From Mabel\'s album: Meadow Finds.' },
  copperwell: { name: 'Copper Well', icon: '🪣', kind: 'decor', model: 'well', tint: '#f0a868', size: [2, 2], cost: 0, level: 99, charm: 55, desc: 'From Mabel\'s album: Barnyard Bits.' },
  rosepicnic: { name: 'Rose Picnic Table', icon: '🧺', kind: 'decor', model: 'picnic', tint: '#ffb3b3', size: [2, 2], cost: 0, level: 99, charm: 90, desc: 'From Mabel\'s album: Grandma\'s Kitchen.' },
  blossomarch: { name: 'Blossom Arch', icon: '💐', kind: 'decor', model: 'flowerarch', tint: '#ffc0d9', size: [2, 1], cost: 0, level: 99, charm: 185, desc: 'From Mabel\'s album: Neighbourly Notes.' },
  harvestmill: { name: 'Harvest Windmill', icon: '🌬️', kind: 'decor', model: 'windmill', tint: '#ffbe7a', size: [3, 3], cost: 0, level: 99, charm: 120, desc: 'From Mabel\'s album: Orchard Treasures.' },
  mossfountain: { name: 'Mossy Fountain', icon: '⛲', kind: 'decor', model: 'fountain', tint: '#b5e8a8', size: [2, 2], cost: 0, level: 99, charm: 300, desc: 'From Mabel\'s album: Market Day.' },
  lilacgazebo: { name: 'Lilac Gazebo', icon: '🛖', kind: 'decor', model: 'gazebo', tint: '#d9c6ff', size: [3, 3], cost: 0, level: 99, charm: 455, desc: 'From Mabel\'s album: Mill Pond.' },
  silverrooster: { name: 'Silver Rooster', icon: '🐓', kind: 'decor', model: 'statue', tint: '#e3e9f0', tintDesat: 1, tintMetal: 0.2, tintRough: 0.35, size: [1, 1], cost: 0, level: 99, charm: 680, desc: 'From Mabel\'s album: Mabel\'s Attic.' },
  curio: { name: 'Curio Cabinet', icon: '🗄️', kind: 'decor', size: [2, 1], cost: 0, level: 99, charm: 300, desc: 'Mabel\'s keepsakes on show: the launch album is complete.' },
  skyballoon: { name: 'Sky Balloon', icon: '🎈', kind: 'decor', model: 'balloon', tint: '#8fd0ff', tintDesat: 0.85, tintLift: 0.6, size: [2, 2], cost: 0, level: 99, charm: 960, desc: 'From Mabel\'s album: Family Heirlooms.' },
  // Prettiest Farm ribbon prizes (ranks 5 and 15)
  blossomoak: { name: 'Blossom Oak', icon: '🌳', kind: 'decor', model: 'oak', tint: '#ffb3d1', tintDesat: 0.8, tintLift: 0.6, size: [1, 1], cost: 0, level: 99, charm: 90 },
  frostpine: { name: 'Frosted Pine', icon: '🌲', kind: 'decor', model: 'pine', tint: '#cfeaff', tintDesat: 0.85, tintLift: 0.75, size: [1, 1], cost: 0, level: 99, charm: 90 },

  // starter debris on a new farm ("gone a bit wild"): never sold or unlocked (level 99), cleared
  // by tapping for a tiny one-off reward. Finite: 12 pieces, 🪙20 ⭐14 in total, no materials.
  weed: { name: 'Weeds', icon: '🌿', kind: 'debris', size: [1, 1], cost: 0, level: 99, clear: { coins: 1, xp: 1 } },
  stone: { name: 'Stone', icon: '🪨', kind: 'debris', size: [1, 1], cost: 0, level: 99, clear: { coins: 2, xp: 1 } },
  stump: { name: 'Old Stump', icon: '🪵', kind: 'debris', size: [1, 1], cost: 0, level: 99, clear: { coins: 3, xp: 2 } },
};
// a one-of-a-kind decoration (a parcel, album page or ribbon prize): never sold, so removing it puts it away instead
export const oneOfAKind = (type) => OBJECTS[type]?.kind === 'decor' && OBJECTS[type].level >= 99;

// ---------------------------------------------------------------- derived prices & xp
// Products are worth their inputs plus a premium for the time spent, so every step of a
// production chain adds value and longer timers are rewarded per item (not per minute).
const priceOf = (i) => ITEMS[i].price;
for (const [id, a] of Object.entries(ANIMALS)) {
  const m = a.time / 60;
  const food = a.food ? priceOf(a.food) * a.foodQty : 0;
  ITEMS[a.product].price ??= Math.round(food * 1.3 + m * 1.2 + 6);
  a.xp ??= Math.max(2, Math.round(m * 0.45 + 1));
  a.buyXp ??= Math.max(2, Math.round(a.cost / 60));
}
// resolve in dependency order (e.g. butter popcorn needs butter's price first)
for (let pass = 0, pending = true; pending && pass < 10; pass++) {
  pending = false;
  for (const [id, r] of Object.entries(RECIPES)) {
    if (ITEMS[id].price != null && r.xp != null) continue;
    if (!Object.keys(r.inputs).every((i) => ITEMS[i].price != null)) { pending = true; continue; }
    const m = r.time / 60;
    const inVal = Object.entries(r.inputs).reduce((s, [i, n]) => s + priceOf(i) * n, 0);
    ITEMS[id].price ??= Math.round(inVal * 1.25 + m * 0.9 + 4);
    r.xp ??= Math.max(2, Math.round(m * 0.4 + Object.keys(r.inputs).length));
  }
}
for (const o of Object.values(OBJECTS)) if (o.kind === 'tree') o.harvestXp ??= o.xp;

// ---------------------------------------------------------------- storage
// Two buildings: the Silo holds crops & fruit, the Barn holds everything else.
// Tier t needs player level 2t+3, coins (×1.5 per tier) and building materials.
const tierMats = (t, a, b) => { const k = 1 + Math.floor((t - 1) / 2); return { [a]: k, [b]: k }; };
export const STORAGE = {
  silo: {
    name: 'Silo', icon: '🛢️', building: 'silo', cats: ['crop', 'fruit'], maxLevel: 40,
    capacity: (lvl) => 75 + lvl * 25,
    // upgrade(lvl) → requirements to go from tier lvl to lvl+1
    upgrade: (lvl) => { const t = lvl + 1; return { level: 2 * t + 3, coins: Math.round(100 * Math.pow(1.5, t - 1)), items: tierMats(t, 'plank', 'bolt'), xp: 10 + 5 * (t - 1) }; },
    emptyHint: 'Harvest crops to fill it.',
  },
  barn: {
    name: 'Barn', icon: '🏚️', building: 'storagebarn', cats: ['animal', 'goods', 'fish'], maxLevel: 40,
    capacity: (lvl) => 50 + lvl * 25,
    upgrade: (lvl) => { const t = lvl + 1; return { level: 2 * t + 3, coins: Math.round(150 * Math.pow(1.5, t - 1)), items: tierMats(t, 'plank', 'paint'), xp: 10 + 5 * (t - 1) }; },
    emptyHint: 'Animal goods and products go here.',
  },
};

// ---------------------------------------------------------------- material drops
// Chance per harvest/collect/produce = actionXp / divisor(level) (so spamming quick crops can't
// farm materials faster than you level), with a pity meter guaranteeing one after pity × divisor XP.
// Orders, visitors and clearing a spent fruit tree use flat chances. Materials are uncapped (toolshed).
export const DROPS = {
  minLevel: 5,
  divisor: (lvl) => Math.max(30, Math.round(0.2 * xpToNext(lvl))),
  pity: 2,
  maxChance: 0.6,
  neededShare: 0.5, // half the drops are what you're shortest of for your next upgrade or expansion
  flat: { order: 0.08, visitor: 0.2, clearTree: 0.5 },
  table: [
    { item: 'plank', weight: 2, level: 1 },
    { item: 'bolt', weight: 1.5, level: 1 },
    { item: 'paint', weight: 1, level: 1 },
  ],
};

// Production queue slots beyond the base 2: buy with coins (once you reach the level) or gems.
export const QUEUE_SLOTS = [
  { coins: 400, gems: 8, level: 6 },
  { coins: 3000, gems: 20, level: 15 },
  { coins: 12000, gems: 40, level: 22 },
];

// ---------------------------------------------------------------- fields
export const PLOTS = {
  // max fields you may have at a level
  cap: (lvl) => Math.min(60, lvl <= 10 ? 6 + lvl * 2 : 26 + (lvl - 10) * 1.5 | 0),
  // cost to plow the next field, given how many you have
  cost: (n) => (n < 6 ? 0 : Math.round(8 + (n - 6) * 5 + Math.pow(n - 6, 2) * 0.35)),
};

// ---------------------------------------------------------------- land
// 8 expansions (16→32), each needing a level, coins and common building materials.
export const LAND = {
  levels: [6, 9, 12, 15, 18, 22, 26, 30],
  expand: (size) => {
    const i = (size - START_LAND) / LAND_STEP; // 0..7
    const level = LAND.levels[i] ?? 30 + (i - 7) * 3;
    const items = { plank: 1 + i, bolt: 1 + Math.floor(i / 2) };
    if (i >= 2) items.paint = Math.floor(i / 2);
    return { level, coins: Math.round(400 * Math.pow(1.7, i)), items, xp: 15 + 10 * i };
  },
};

// ---------------------------------------------------------------- gems (soft premium, earned only)
export const GEMS = {
  speedUp: (sec) => Math.max(1, Math.ceil(Math.pow(sec / 60, 0.75) / 1.5)),
  itemPrice: (item, lvl = 1) => (ITEMS[item].cat === 'material' ? 4 + Math.floor(lvl / 4) : Math.max(1, Math.ceil(ITEMS[item].price / 10))),
  slotLevelLead: 3, // gems can buy a production slot at most this many levels before coins can
};

export function levelUpReward(lvl) {
  return { coins: Math.round((10 * Math.pow(lvl, 1.5)) / 5) * 5, gems: (lvl < 10 ? 1 : 2) + (lvl % 5 === 0 ? 3 : 0) };
}
const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

// ---------------------------------------------------------------- daily gift (7-day loop)
export const DAILY = [
  { coins: 60 },
  { items: { bolt: 1 } },
  { coins: 150 },
  { gems: 3 },
  { items: { plank: 1, paint: 1 } },
  { coins: 300 },
  { gems: 8, items: { paint: 1, bolt: 1 } },
];

// ---------------------------------------------------------------- crop mastery
export const MASTERY = {
  // items harvested to reach ★, ★★, ★★★ — quick crops need more harvests
  thresholds: (type) => {
    const k = Math.round(250 * Math.sqrt(45 / CROPS[type].growTime));
    return [k, k * 6, k * 25];
  },
  speedBonus: 0.05, // per star: grows 5% faster
  bonusYieldChance: 0.1, // per star: chance of +1 item
  rewards: [{ gems: 1 }, { gems: 3 }, { gems: 6, coins: 300 }],
  describe: 'Each ★ makes this crop grow 5% faster with a 10% chance of a bonus item.',
};

// ---------------------------------------------------------------- achievements
const tiers = (goals, gems) => goals.map((goal, i) => ({ goal, gems: gems[i] }));
export const ACHIEVEMENTS = [
  { id: 'harvest', name: 'Green Thumb', icon: '🌾', stat: 'harvest', desc: 'Harvest {n} crops & fruit', tiers: tiers([100, 1000, 7500, 40000], [3, 6, 12, 25]) },
  { id: 'collect', name: 'Animal Friend', icon: '🐮', stat: 'collect', desc: 'Collect {n} animal goods', tiers: tiers([30, 300, 2500, 12000], [3, 6, 12, 25]) },
  { id: 'produce', name: 'Master Maker', icon: '🍞', stat: 'produce', desc: 'Make {n} goods', tiers: tiers([20, 200, 1500, 8000], [3, 6, 12, 25]) },
  { id: 'orders', name: 'Delivery Hero', icon: '🚚', stat: 'ordersDone', desc: 'Deliver {n} orders', tiers: tiers([10, 75, 400, 1500], [3, 6, 12, 25]) },
  { id: 'visitors', name: 'Good Neighbor', icon: '👋', stat: 'visitors', desc: 'Serve {n} visitors', tiers: tiers([10, 75, 400, 1500], [3, 6, 12, 25]) },
  { id: 'coins', name: 'Tycoon', icon: '💰', stat: 'coinsEarned', desc: 'Earn {n} coins', tiers: tiers([2000, 25000, 250000, 2000000], [3, 6, 12, 25]) },
  { id: 'materials', name: 'Scavenger', icon: '🧰', stat: 'materials', desc: 'Find {n} building materials', tiers: tiers([10, 60, 300], [3, 8, 20]) },
];

// ---------------------------------------------------------------- visitors (villagers)
// Villagers stroll in and wait by the front fence. They never leave on their own (no FOMO);
// dismissing is free but that villager stays away a while. Serving builds friendship hearts.
export const VISITORS = {
  level: 7,
  max: (lvl) => (lvl < 7 ? 0 : lvl < 13 ? 2 : lvl < 19 ? 3 : 4),
  firstDelay: 20, // seconds after unlocking
  // on a new farm the first visitor is always Grandma Mabel, asking for something you already hold
  firstLine: 'Visiting my old farm! Could you spare some {item}, dear?',
  interval: min(8), // average gap between arrivals (±25%), also while the game is closed
  dismissCooldown: min(30), // a dismissed villager stays away this long
  dismissGap: min(10), // and the next arrival is at least this far away
  minValue: (lvl) => 12 + 6 * lvl,
  coinMult: 1.8,
  xpMult: 0.2,
  maxHearts: 15,
  heartBonusPay: 0.1, // at max hearts a villager pays 10% more
  heartRewards: {
    3: { gems: 2, text: 'brought you a thank-you gift' },
    6: { gems: 3, materials: 2, text: 'helped fix up your tools' },
    10: { materials: 3, coins: 500, text: 'wrote you a lovely letter' },
    15: { gems: 5, text: 'is your best friend now — they will pay 10% more' },
  },
  npcs: [
    { id: 'rosa', level: 7, name: 'Rosa the Baker', icon: '👩‍🍳', color: '#ffd6a5', likes: ['crop', 'animal'], line: 'I need some {item} for a new recipe!' },
    { id: 'mabel', level: 7, name: 'Grandma Mabel', icon: '👵', color: '#ffc9de', likes: ['goods', 'animal'], line: 'Dearie, could you spare some {item}?' },
    { id: 'kip', level: 7, name: 'Kip the Kid', icon: '🧒', color: '#b2f2bb', likes: ['fruit', 'goods'], line: 'Pleeease can I have {item}?' },
    { id: 'theo', level: 11, name: 'Theo the Fisher', icon: '🎣', color: '#a5d8ff', likes: ['goods', 'fruit'], line: 'A bit of {item} would hit the spot.' },
    { id: 'hank', level: 16, name: 'Mayor Hank', icon: '🎩', color: '#d0bfff', likes: ['goods'], line: 'The town fair needs {item}!' },
    { id: 'juno', level: 21, name: 'Juno the Artist', icon: '🎨', color: '#ffec99', likes: ['crop', 'fruit'], line: 'I paint with {item}. Don\'t ask.' },
  ],
};

// ---------------------------------------------------------------- daily chores
// Three small goals per day (one free reroll). Rewards are a share of the current level's XP,
// so they help slower players catch up without letting fast players race ahead.
export const CHORES = {
  level: 4,
  perDay: 3,
  rerolls: 1,
  xp: (lvl) => round5(0.04 * xpToNext(lvl)),
  coins: (lvl) => 25 * lvl,
  allDone: { gems: 1, materials: 1 },
  templates: [
    { id: 'harvest', make: (lvl) => ({ text: `Harvest ${20 + 3 * lvl} crops`, event: 'harvest', count: 20 + 3 * lvl }) },
    { id: 'harvestX', make: (lvl, pick) => { const c = pick('crop'); const n = Math.min(40, Math.max(6, Math.round(400 / (CROPS[c].growTime / 60)))); return { text: `Harvest ${n} ${ITEMS[c].name.toLowerCase()}`, event: 'harvest', filter: c, count: n }; } },
    { id: 'collect', level: 2, make: (lvl) => ({ text: `Collect ${8 + Math.floor(lvl / 2)} animal goods`, event: 'collect', count: 8 + Math.floor(lvl / 2) }) },
    { id: 'produce', level: 3, make: (lvl) => ({ text: `Make ${3 + Math.floor(lvl / 4)} goods`, event: 'produce', count: 3 + Math.floor(lvl / 4) }) },
    { id: 'orders', make: (lvl) => ({ text: `Deliver ${3 + Math.floor(lvl / 8)} orders`, event: 'order', count: 3 + Math.floor(lvl / 8) }) },
    { id: 'visitors', level: 7, make: () => ({ text: 'Serve 2 visitors', event: 'visitor', count: 2 }) },
    { id: 'wagon', level: 14, make: () => ({ text: 'Fill 2 wagon crates', event: 'crate', count: 2 }) },
    { id: 'fruit', level: 9, make: () => ({ text: 'Pick 12 fruit', event: 'fruit', count: 12 }) },
  ],
};

// ---------------------------------------------------------------- market wagon
// Parks on the road with crates to fill. Each crate pays when filled; filling all of them
// sends it off early with a bonus. Stays 12h, comes back 6h after leaving. No penalties.
export const WAGON = {
  level: 14,
  crates: (lvl) => (lvl < 20 ? 6 : 9),
  crateValue: (lvl) => 20 * Math.pow(lvl, 1.3),
  maxQty: 12,
  coinMult: 1.3,
  xp: (lvl) => round5(0.0125 * xpToNext(lvl)),
  fullBonus: { coinShare: 0.25, materials: 3, gems: 2 },
  stay: hr(12),
  away: hr(6),
};

// ---------------------------------------------------------------- village projects (late coin & goods sink)
// Community buildings near the farm, rebuilt in 3 stages by donating coins and goods.
// Each finished stage gives XP (a share of the level), gems, and the last stage a small perk.
export const PROJECTS = {
  bridge: {
    name: 'Old Bridge', icon: '🌉', level: 16, place: 'pond',
    desc: 'The footbridge over the pond has seen better days.',
    perk: 'Visitors arrive 20% more often', perkKey: 'visitorRate', perkValue: 0.8,
    stages: [
      { coins: 3000, items: { bread: 10, butter: 6, cheese: 4 } },
      { coins: 5000, items: { applepie: 4, tomjuice: 6, sweater: 4 } },
      { coins: 8000, items: { caramel: 4, icecream: 4, smoothie: 4 } },
    ],
  },
  bandstand: {
    name: 'Bandstand', icon: '🎺', level: 21, place: 'road',
    desc: 'Music used to fill the evenings here.',
    perk: 'Wagon crates pay 10% more', perkKey: 'wagonPay', perkValue: 1.1,
    stages: [
      { coins: 8000, items: { butterpop: 6, candle: 4, pie: 4 } },
      { coins: 12000, items: { shirt: 3, cheese: 6, goatcheese: 4 } },
      { coins: 16000, items: { icecream: 4, sweater: 4, smoothie: 4 } },
    ],
  },
  greenhouse: {
    name: 'Greenhouse', icon: '🪴', level: 25, place: 'north',
    desc: 'An old glasshouse, waiting for new panes.',
    perk: 'Crops grow 5% faster', perkKey: 'cropSpeed', perkValue: 0.05,
    stages: [
      { coins: 15000, items: { chilipop: 6, goatcheese: 4 } },
      { coins: 20000, items: { shirt: 4, candle: 6 } },
      { coins: 25000, items: { pie: 4, smoothie: 4, caramel: 3 } },
    ],
  },
  master: {
    name: 'Master Farmhouse', icon: '🏡', level: 30, place: 'farmhouse',
    desc: 'Turn your farmhouse into the pride of the valley.',
    perk: '+1 order slot and the Master Farmer title', perkKey: 'orderSlot', perkValue: 1,
    stages: [
      { coins: 25000, items: { lavcandle: 4, peachjam: 3 } },
      { coins: 35000, items: { caramelcorn: 3, goatcheese: 4, shirt: 4 } },
      { coins: 50000, items: { quilt: 2, lavcandle: 4, icecream: 4 } },
    ],
  },
};
export const PROJECT_REWARD = { xp: (lvl) => round5(0.15 * xpToNext(lvl)), gems: [3, 5, 8] };
// total crop speed bonus (mastery + greenhouse) is capped
export const MAX_CROP_SPEEDUP = 0.2;

// ---------------------------------------------------------------- orders
export const ORDERS = {
  slots: (lvl) => (lvl < 4 ? 3 : lvl < 14 ? 4 : lvl < 24 ? 5 : 6),
  minValue: (lvl) => 10 + 5 * lvl, // quantities are raised until an order is worth at least this
  maxKinds: (lvl) => (lvl < 4 ? 1 : lvl < 10 ? 2 : 3),
  maxQty: (price, lvl) => {
    const base = price < 6 ? 6 : price < 15 ? 4 : price < 40 ? 3 : price < 100 ? 2 : 1;
    return base + Math.floor(lvl / 12);
  },
  coinMult: 1.45,
  xpMult: 0.2,
  refill: 60, // seconds until a new order appears after delivering
  discardWait: 180, // discarding is free but slow, so rerolling for easy orders isn't worth it
};

// ---------------------------------------------------------------- levels
// XP needed to go from level L to L+1. Grows ~cubically so that income growth
// (more fields, better crops) doesn't make later levels fly by.
export const xpToNext = (lvl) => Math.round(10 * lvl + Math.pow(lvl, 2.8));
const XP_TABLE = [0, 0];
for (let l = 1; l < 120; l++) XP_TABLE[l + 1] = XP_TABLE[l] + xpToNext(l);
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return XP_TABLE[Math.min(level, XP_TABLE.length - 1)];
}

const ordinal = (n) => n + (n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
export function unlocksAtLevel(level) {
  const list = [];
  for (const [id, c] of Object.entries(CROPS)) if (c.level === level) list.push({ icon: ITEMS[id].icon, name: c.name + ' seeds' });
  for (const a of Object.values(ANIMALS)) if (a.level === level) list.push({ icon: a.icon, name: a.name });
  for (const o of Object.values(OBJECTS)) if (o.level === level) list.push({ icon: o.icon, name: o.name });
  for (const [id, r] of Object.entries(RECIPES)) if ((r.level || 0) === level && OBJECTS[r.building].level < level) list.push({ icon: ITEMS[id].icon, name: ITEMS[id].name + ' recipe' });
  for (const o of Object.values(OBJECTS)) {
    if (!o.limit || o.level >= level || o.kind === 'tree') continue;
    const n = o.limit(level);
    if (n > o.limit(level - 1)) list.push({ icon: o.icon, name: `${ordinal(n)} ${o.name}` });
  }
  if (VISITORS.level === level) list.push({ icon: '👋', name: 'Visitors' });
  for (const n of VISITORS.npcs) if (n.level === level && level !== VISITORS.level) list.push({ icon: n.icon, name: n.name + ' visits' });
  if (CHORES.level === level) list.push({ icon: '✅', name: 'Daily chores' });
  if (WAGON.level === level) list.push({ icon: '🛒', name: 'Market Wagon' });
  for (const p of Object.values(PROJECTS)) if (p.level === level) list.push({ icon: p.icon, name: `Project: ${p.name}` });
  if (LAND.levels.includes(level)) list.push({ icon: '🗺️', name: 'Land expansion' });
  for (const q of QUEUE_SLOTS) if (q.level === level) list.push({ icon: '➕', name: 'Production slot' });
  if (ORDERS.slots(level) > ORDERS.slots(level - 1)) list.push({ icon: '🚚', name: 'Order slot' });
  if (DROPS.minLevel === level) list.push({ icon: '🧰', name: 'Building materials' });
  // Mabel's album: a new page (page 1 opens with the first keepsake, not at a level)
  for (const p of ALBUM.pages) if (p.level > 0 && p.level === level) list.push({ icon: '📖', name: `Album page: ${p.name}` });
  // Prettiest Farm: Mayor Hank's ribbons, then gilding
  if (CHARM.level === level) list.push({ icon: '💗', name: 'Prettiest Farm ribbons' });
  if (CHARM.gildLevel === level) list.push({ icon: '✨', name: 'Gilding' });
  return list;
}

// first level (after `from`) at which fn(level) > current
export function nextUnlockLevel(fn, from, current) {
  for (let l = from + 1; l < 120; l++) if (fn(l) > current) return l;
  return null;
}

// Which items can appear in orders at this level (things the player can produce)
export function producibleItems(level) {
  const out = [];
  for (const [id, c] of Object.entries(CROPS)) if (c.level <= level) out.push(id);
  for (const o of Object.values(OBJECTS)) if (o.kind === 'tree' && o.level <= level) out.push(o.fruit);
  for (const a of Object.values(ANIMALS)) if (a.level <= level) out.push(a.product);
  // recipes in dependency order (inputs must already be producible)
  let added = true;
  while (added) {
    added = false;
    for (const [id, r] of Object.entries(RECIPES)) {
      if (out.includes(id)) continue;
      if (Math.max(r.level || 0, OBJECTS[r.building].level) > level) continue;
      if (Object.keys(r.inputs).every((i) => out.includes(i))) { out.push(id); added = true; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- quests (guided goals)
// Three chapters of scripted goals; Grandma Mabel says `say` when a goal starts, `hint` is the
// long-press help text. build / buyAnimal / expand / feed / storage goals count what you already
// have, so doing things early never soft-locks the list. Each id is saved next to the index
// (quest.qid), so reordering this list later is safe. Rewards stay small on purpose: the list
// is a guide, not a faucet (a test caps the totals).
export const QUESTS = [
  // Chapter 1 "A Fresh Start" (guided tour, L1-L4)
  { id: 'harvest', chapter: 1, text: 'Harvest 12 wheat', event: 'harvest', filter: 'wheat', count: 12, reward: { coins: 10, xp: 3 }, say: 'Your wheat is ripe, dear! Tap it to harvest.', hint: 'Tap ripe wheat with ✋ — the whole patch is harvested. Swiping works too.' },
  { id: 'plant', chapter: 1, text: 'Plant 6 wheat', event: 'plant', filter: 'wheat', count: 6, reward: { coins: 10, xp: 3 }, say: 'Empty soil is sad soil! Tap it to plant wheat — seeds cost 🪙1.', hint: 'Tap your empty soil with ✋ to plant wheat.' },
  { id: 'order1', chapter: 1, text: 'Deliver an order', event: 'order', count: 1, reward: { coins: 15, xp: 3 }, say: 'Folks in town post orders on this board. You\'ve got the wheat — let\'s deliver!', hint: 'Open 🚚 Orders and fill a request.' },
  { id: 'coop', chapter: 1, text: 'Build a Chicken Coop', event: 'build', filter: 'coop', count: 1, reward: { coins: 25, xp: 4 }, say: 'Eggs sell nicely. Let\'s build a Chicken Coop!', hint: 'Open 🏪 Shop → Buildings.' },
  { id: 'chickens', chapter: 1, text: 'Buy 2 chickens', event: 'buyAnimal', filter: 'chicken', count: 2, reward: { coins: 25, xp: 4 }, say: 'An empty coop is a sad coop. Let\'s get two chickens!', hint: 'Tap the coop, or Shop → Animals.' },
  { id: 'feed', chapter: 1, text: 'Feed your chickens', event: 'feed', filter: 'chicken', count: 2, reward: { coins: 5, xp: 2 }, say: 'They\'re peckish! Tap the coop to feed them wheat.', hint: 'Tap the coop — chickens eat wheat.' },
  { id: 'plow', chapter: 1, text: 'Plow 2 new fields', event: 'plow', count: 2, reward: { coins: 10, xp: 2 }, say: 'More fields, more food! Pick the Plow.', hint: 'Pick the 🚜 Plow tool and tap/drag on grass.' },
  { id: 'carrots', chapter: 1, text: 'Plant 2 carrots', event: 'plant', filter: 'carrot', count: 2, reward: { coins: 5, xp: 2 }, say: 'Carrots grow in 2 minutes. Tap your new soil and pick Carrot!', hint: 'Tap empty soil with ✋ and pick 🥕 Carrot.' },
  { id: 'eggs', chapter: 1, text: 'Collect 2 eggs', event: 'collect', filter: 'egg', count: 2, reward: { coins: 15, xp: 3 }, say: 'Eggs take 3 minutes. Tap the coop when they pop out!', hint: 'Fed chickens lay an egg every 3 minutes. Tap the coop to collect.' },
  { id: 'bakery', chapter: 1, text: 'Build a Bakery', event: 'build', filter: 'bakery', count: 1, reward: { coins: 30, xp: 6 }, say: 'Bread sells for far more than plain wheat. Let\'s build a Bakery!', hint: 'Shop → Buildings. Orders are the quickest coins.' },
  { id: 'bread', chapter: 1, text: 'Bake bread', event: 'produce', filter: 'bread', count: 1, reward: { coins: 20, xp: 5 }, say: 'Tap the Bakery, then Make on Bread.', hint: 'Tap the Bakery to start baking.' },
  // Chapter 2 "Barnyard Friends" (L4-L6)
  { id: 'corn', chapter: 2, text: 'Plant 4 corn', event: 'plant', filter: 'corn', count: 4, reward: { coins: 20, xp: 6 }, say: 'Corn\'s unlocked! Cows will love it — plant 4.', hint: 'Tap empty soil with ✋ and pick 🌽 Corn.' },
  { id: 'orders3', chapter: 2, text: 'Deliver 3 orders', event: 'order', count: 3, reward: { coins: 40, xp: 10 }, say: 'Orders pay much better than the shop. Let\'s fill three!', hint: 'Open 🚚 Orders and fill requests.' },
  { id: 'pasture', chapter: 2, text: 'Build a Cow Pasture', event: 'build', filter: 'cowbarn', count: 1, reward: { coins: 50, xp: 12 }, say: 'Time for cows! Orders will get you to 🪙400.', hint: 'Shop → Buildings. Orders are the quickest coins.' },
  { id: 'cows', chapter: 2, text: 'Buy 2 cows', event: 'buyAnimal', filter: 'cow', count: 2, reward: { coins: 30, xp: 8 }, say: 'Two cows make a herd. They eat corn.', hint: 'Tap the pasture, or Shop → Animals.' },
  // the "Surveyor's Kit": materials for the first land expansion, handed out right before it
  { id: 'milk', chapter: 2, text: 'Collect 2 milk', event: 'collect', filter: 'milk', count: 2, reward: { coins: 50, xp: 12, items: { plank: 1, bolt: 1 } }, say: 'Tap the pasture to collect milk — my old toolkit is yours after!', hint: 'Cows eat corn. Tap the pasture to feed them and collect.' },
  { id: 'expand', chapter: 2, text: 'Expand your land', event: 'expand', count: 1, reward: { coins: 60, xp: 15 }, say: 'That plank and bolt are enough to clear more land. Shop → Land!', hint: 'Shop → Land. You found planks & bolts for it!' },
  // Chapter 3 "Open for Business" (L6-L9)
  { id: 'sunflower', chapter: 3, text: 'Plant 4 sunflowers', event: 'plant', filter: 'sunflower', count: 4, reward: { coins: 30, xp: 8 }, say: 'Sunflowers take 10 minutes — perfect while you do other things.', hint: 'Tap empty soil with ✋ and pick 🌻 Sunflower.' },
  { id: 'cookie', chapter: 3, text: 'Bake a cookie', event: 'produce', filter: 'cookie', count: 1, reward: { coins: 30, xp: 8 }, say: 'Cookies need eggs and wheat. Worth every crumb!', hint: 'Tap the Bakery: a cookie needs 2 wheat and 2 eggs.' },
  { id: 'dairy', chapter: 3, text: 'Build a Dairy', event: 'build', filter: 'dairy', count: 1, reward: { coins: 70, xp: 18 }, say: 'A Dairy turns milk into butter. Let\'s build one!', hint: 'Shop → Buildings.' },
  { id: 'visitors', chapter: 3, text: 'Serve 2 visitors', event: 'visitor', count: 2, reward: { coins: 60, xp: 15, gems: 2 }, say: 'Neighbours are stopping by — they pay extra. Tap them!', hint: 'Visitors wait by the front fence — tap them.' },
  { id: 'butter', chapter: 3, text: 'Churn butter', event: 'produce', filter: 'butter', count: 1, reward: { coins: 60, xp: 15 }, say: 'Visitors adore fresh butter. Let\'s churn some!', hint: 'Tap the Dairy: butter needs 2 milk.' },
  { id: 'popcorn', chapter: 3, text: 'Build a Popcorn Stand', event: 'build', filter: 'popcorn', count: 1, reward: { coins: 70, xp: 18 }, say: 'Corn\'s about to get exciting — build a Popcorn Stand!', hint: 'Shop → Buildings.' },
  { id: 'silo', chapter: 3, text: 'Upgrade your Silo', event: 'storage', count: 1, reward: { coins: 80, xp: 20 }, say: 'Out of room? Materials from farming upgrade your Silo.', hint: 'Open 📦 Storage. Materials drop while you farm.' },
  { id: 'apple', chapter: 3, text: 'Plant 2 Apple Trees', event: 'build', filter: 'appletree', count: 2, reward: { coins: 60, xp: 15 }, say: 'Apple trees fruit 8 times! Plant two.', hint: 'Shop → Trees.' },
];

// Finishing a chapter's `last` goal opens its chest: gems and a decoration only (never coins, XP
// or materials). Each gift unlocks in the Shop before its chest arrives.
export const CHAPTERS = [
  { id: 1, name: 'A Fresh Start', icon: '🌾', last: 'bread', reward: { gems: 3, gift: 'scarecrow' } },
  { id: 2, name: 'Barnyard Friends', icon: '🐄', last: 'expand', reward: { gems: 3, gift: 'birdbath' } },
  { id: 3, name: 'Open for Business', icon: '🧺', last: 'apple', reward: { gems: 5, gift: 'picnic' } },
];

// v2 had 17 scripted goals; this maps a v2 quest.index to the v3 goal id (see Game.migrate)
export const V2_QUEST_COUNT = 17;
export const QUEST_MIGRATION_V3 = ['harvest', 'plant', 'order1', 'order1', 'coop', 'chickens', 'eggs', 'bakery', 'bread', 'carrots', 'orders3', 'pasture', 'milk', 'expand', 'dairy', 'visitors', 'silo'];

// The player level a goal needs before it can be done (shown as "🔒 Reach Lv N" on the card).
export function questLevel(q) {
  const f = q?.filter;
  switch (q?.event) {
    case 'build': return OBJECTS[f]?.level ?? 1;
    case 'buyAnimal': case 'feed': return ANIMALS[f]?.level ?? 1;
    case 'plant': return CROPS[f]?.level ?? 1;
    case 'harvest': return CROPS[f]?.level ?? Object.values(OBJECTS).find((o) => o.kind === 'tree' && o.fruit === f)?.level ?? 1;
    case 'fruit': return Math.min(...Object.values(OBJECTS).filter((o) => o.kind === 'tree' && (!f || o.fruit === f)).map((o) => o.level));
    case 'produce': { const r = RECIPES[f]; return r ? Math.max(r.level || 0, OBJECTS[r.building].level) : 1; }
    case 'collect': return Object.values(ANIMALS).find((a) => a.product === f)?.level ?? 1;
    case 'visitor': return VISITORS.level;
    case 'expand': return LAND.levels[0];
    case 'storage': return STORAGE[f || 'silo'].upgrade(0).level;
    case 'crate': return WAGON.level;
    default: return 1;
  }
}

// After the scripted quests run out we generate endless ones from these templates.
export const REPEAT_QUESTS = [
  (n, lvl) => ({ text: `Harvest ${30 + lvl * 4 + n * 10} crops`, event: 'harvest', count: 30 + lvl * 4 + n * 10 }),
  (n, lvl) => ({ text: `Deliver ${3 + Math.floor(n / 2)} orders`, event: 'order', count: 3 + Math.floor(n / 2) }),
  (n, lvl) => ({ text: `Collect ${8 + lvl + n * 3} animal goods`, event: 'collect', count: 8 + lvl + n * 3 }),
  (n, lvl) => ({ text: `Make ${4 + Math.floor(lvl / 3) + n} goods`, event: 'produce', count: 4 + Math.floor(lvl / 3) + n }),
  (n, lvl) => ({ text: `Serve ${2 + Math.floor(n / 2)} visitors`, event: 'visitor', count: 2 + Math.floor(n / 2) }),
  (n, lvl) => ({ text: `Earn ${(300 + lvl * 80 + n * 150).toLocaleString('en-US')} coins`, event: 'earn', count: 300 + lvl * 80 + n * 150 }),
];

// ---------------------------------------------------------------- tutorial & guide
// The guide is Grandma Mabel, who hands you her farm and comes back as your first visitor.
// The tutorial only changes presentation and input shortcuts; the few economic assists below
// are plain once-per-save rules for new farms (see Game.newGame / freeFinishAvailable / checkSafetyNet).
export const GUIDE = { name: 'Grandma Mabel', npc: 'mabel', icon: '👵', color: '#ffc9de' };

export const TUTORIAL = {
  // tutorial tiles are offsets from the STARTER land corner, never from landLo() (expansion moves it)
  startLo: (MAP_SIZE - START_LAND) / 2,
  lots: { coop: [5, 10], bakery: [11, 6] }, // where the first coop / bakery ghost starts
  plowSuggest: [[9, 6], [9, 7]], // the two ghost plots of "Plow 2 new fields"
  // [type, dx, dz]: the farm has "gone a bit wild" (clear of the lots, the field and building rings)
  debris: [
    ['weed', 4, 15], ['weed', 15, 5], ['weed', 15, 1], ['weed', 12, 15], ['weed', 15, 14], ['weed', 2, 15],
    ['stone', 6, 15], ['stone', 15, 4], ['stone', 14, 11], ['stone', 3, 13],
    ['stump', 14, 0], ['stump', 0, 12],
  ],
  patchMax: 24, // most tiles one tap harvests or plants
  idle: { coached: [25, 50], independent: 45 }, // seconds before a glow / soft finger nudge
  revealAfter: { level: 5, hours: 2 }, // the whole HUD shows from here on, even mid-tour
  freeFinish: { recipe: 'bread' }, // the first bread of a new farm can be finished for free, once
  safetyNet: { coins: 20, cooldownH: 24 }, // "Mabel's pocket money" when completely stuck
  // Mabel's lines by step key (each <= 90 characters; {item}/{icon}/{time} are filled in by the UI)
  lines: {
    welcome: 'Hello, dear! I\'m Grandma Mabel. This farm is yours now — let\'s wake it up together!',
    harvest: 'Your wheat is ripe, dear! Tap it to harvest.',
    claim: 'Goal done! Tap Claim for your reward.',
    plant: 'Empty soil is sad soil! Tap it to plant wheat — seeds cost 🪙1.',
    claimL2: 'Claim it — that\'s enough ⭐ for Level 2!',
    levelup2: 'Level 2! Chickens and carrots are yours now.',
    levelup3: 'Level 3 — a Bakery!',
    levelup4: 'Level 4 — corn, cookies and daily chores!',
    order1: 'Folks in town post orders on this board. You\'ve got the wheat — let\'s deliver!',
    order1Panel: 'Tap Deliver — the truck takes it to town.',
    coop: 'Eggs sell nicely. Let\'s build a Chicken Coop!',
    coopShop: 'The Coop is 🪙80. Tap it!',
    coopPlace: 'Looks lovely there! Tap ✓ to build. (You can drag it first.)',
    place: 'Looks lovely there! Tap ✓ to build. (You can drag it first.)',
    cameraTip: 'Drag to look around · pinch to zoom.',
    chickens: 'An empty coop is a sad coop. Let\'s get two chickens!',
    chickensPanel: 'Tap Buy — then once more, so she has a friend.',
    chickensMore: 'One more chicken so she has a friend — the Shop has them!',
    feed: 'They\'re peckish! Tap the coop to feed them wheat.',
    plow: 'More fields, more food! Pick the Plow.',
    plowTiles: 'Tap the marked grass. New fields cost a few coins.',
    plowTip: 'Tip: drag with the Plow to make lots of fields at once.',
    carrots: 'Carrots grow in 2 minutes. Tap your new soil and pick Carrot!',
    eggs: 'Eggs take 3 minutes. Tap the coop when they pop out!',
    eggsMeanwhile: 'Meanwhile, this old farm\'s gone wild — tap weeds and stones to tidy up!',
    eggsCollected: 'Eggs! Goods go to your Barn 📦, crops to the Silo.',
    bakery: 'Bread sells for far more than plain wheat. Let\'s build a Bakery!',
    bakeryCoins: 'We need 🪙150 — orders are the quickest coins!',
    bread: 'Tap the Bakery, then Make on Bread.',
    breadWheat: 'Bread needs 3 wheat, dear — let\'s grow a little more first!',
    breadFree: 'Bread takes 4 minutes… this first batch is on me. Tap Finish!',
    breadCollect: 'Fresh bread! Tap it to collect.',
    grad: 'Chapter 1 done — you\'re a natural!',
    gradGift: 'A Scarecrow to guard your crops. Tap ✓ to put it up!',
    gradDaily: 'And a little gift waits for you every day you visit!',
    gradEnd: 'Your next goal is always up here. Tap it and I\'ll show you the way!',
    skipConfirm: 'Skip the tour? Tap your goal card any time and I\'ll still show you the way.',
    // one-time interrupts (guided & coached)
    siloFull: 'Your Silo is nearly full, dear! Sell some extras — orders pay even more.',
    barnFull: 'Your Barn is nearly full, dear! Sell some extras — orders pay even more.',
    firstDrop: 'A {icon} {item}! Materials drop while you farm — they upgrade storage and land.',
    slot6: 'Workshops can hold one more job now — tap the 🔒 slot in the Bakery.',
    firstVisitor: 'Yoo-hoo, it\'s me, dear! Visitors pay extra — tap me to see what I\'d like.',
    firstVisitorPanel: VISITORS.firstLine,
    migratedTip: 'New: tap your goal card and I\'ll show you the way 👆',
    safetyNet: 'A little something to get you going, dear.',
    busy: 'Everything\'s busy! Next: {icon} {time}',
    busyIdle: 'Nothing\'s growing or cooking just now — check back a little later, dear.',
    sellFew: 'Short on coins, dear? Sell a spare or two from storage 📦 — tap it, then Sell.',
    giftWaits: 'No rush, dear — your {gift} waits in Shop → Decor 🎁',
    // the Post (parcel #1 comes during Chapter 1's egg wait)
    post1: 'The post\'s here! 📬 I sent you a little parcel, dear — tap it to open.',
    post1Open: 'Open it up! The next one comes in 10 minutes — it waits if you\'re busy.',
    postMailbox: '📮 Your very own Mailbox! Tap ✓ to put it up by the road.',
    postAway: '📬 A parcel came while you were away, dear!',
  },
};
// the Chapter 1 tour lines: shown once each; Skip and old saves mark them all as seen
TUTORIAL.ch1Lines = ['welcome', 'harvest', 'claim', 'plant', 'claimL2', 'levelup2', 'levelup3', 'levelup4', 'order1', 'order1Panel',
  'coop', 'coopShop', 'coopPlace', 'place', 'cameraTip', 'chickens', 'chickensPanel', 'chickensMore', 'feed', 'plow', 'plowTiles', 'plowTip', 'carrots',
  'eggs', 'eggsMeanwhile', 'eggsCollected', 'bakery', 'bakeryCoins', 'bread', 'breadWheat', 'breadFree', 'breadCollect',
  'grad', 'gradGift', 'gradDaily', 'gradEnd', 'skipConfirm', 'post1', 'post1Open'];

// absolute tile of a tutorial offset ([dx, dz] from TUTORIAL.startLo)
export const tutorialTile = ([dx, dz]) => [TUTORIAL.startLo + dx, TUTORIAL.startLo + dz];

// One short tip per level, shown once after the level-up (each <= 80 characters).
export const FEATURE_TIPS = {
  5: 'Cows give milk every 8 min — they eat corn. Materials start dropping now too!',
  6: 'Sunflowers take 10 min — plant them before a break. Land expansion is open!',
  7: 'The Dairy turns milk into butter — and visitors start dropping by!',
  8: 'Tomatoes and a Popcorn Stand! Popcorn is worth far more than raw corn.',
  9: 'Apple trees fruit 8 times. Butter Popcorn is a top seller!',
  10: 'Pigs sniff out truffles — they eat carrots. You can build a 2nd coop now.',
  11: 'Sugarcane becomes sugar at the Sugar Mill. Theo the Fisher may visit!',
  12: 'Sheep grow wool, and the Loom knits it into sweaters.',
  13: 'Strawberries and a Juice Press — tomatoes and apples become juice.',
  14: 'The Market Wagon parks by the road — fill all its crates for a bonus!',
  15: 'Bees make honey all by themselves — no feeding needed.',
  16: 'The Old Bridge needs help — donate coins and goods in stages.',
  17: 'Pumpkins take an hour — perfect before you log off.',
  18: 'The Candle Shop turns honey into candles.',
  19: 'Cotton for shirts — and Mayor Hank\'s ribbons: decorations now earn 💗 charm!',
  20: 'Goats give rich milk — they eat sunflowers.',
  21: 'The Bandstand project is open — finish it for better wagon pay.',
  22: 'Chili makes Spicy Popcorn. Another production slot is available too!',
  23: 'Peach trees! A 3rd pasture and a 2nd apiary are allowed now.',
  24: 'One more order slot — more orders, more coins.',
  25: 'Lavender, and the Greenhouse project — it makes every crop grow faster.',
  26: 'Lavender Candles — the fanciest thing in the valley.',
  27: 'Peach Jam: peaches and sugar at the Juice Press.',
  28: 'Caramel Corn — corn has never been so fancy.',
  29: 'Cozy Quilts need a shirt and a sweater — the ultimate gift.',
  30: 'The Master Farmhouse project is open. You\'re a true farmer, dear!',
  // past L30: the last album pages (31 is shared with gilding)
  31: 'Gilding! Make a fountain or gazebo golden for triple 💗 — and a new album page.',
  35: 'A new album page: Starry Nights 🔭 — keepsakes turn up as you farm.',
  37: 'A new album page: Festival Keepsakes 🎠 — fill it for a gilding voucher!',
  39: 'The last album page: Grand Champion 🥇 — fill it to become Valley Historian!',
};

// ---------------------------------------------------------------- camera (turn & tilt)
// Yaw/pitch in radians. Turning steps along the iso diagonals; tilting has 5 levels. The camera never moves
// on its own: tilt is only ever set by the player (zoomTilt is an optional polish, shipped off).
export const CAMERA = {
  yaw0: Math.PI / 4, // the default (and Home) view
  yawStep: Math.PI / 2, // ↺ ↻ Q E: along the iso diagonals π/4 + k·π/2
  snap: 0.12, // twist / orbit release: glide onto the nearest 45° view within 7°
  pitch: { min: 0.66, max: 1.22, def: 0.92, steps: [0.66, 0.79, 0.92, 1.07, 1.22] }, // 37.8° 45.3° 52.7° 61.3° 69.9°
  lowPitch: 0.80, lowMinDist: 9, // below 0.80 the closest zoom is 9 (else 7), so the camera never dips into roofs
  twist: { engage: 0.26, maxScale: 0.22 }, // 15°, and only while |ln(d/d0)| < 0.22 (a pinch never turns)
  armMs: 90, // touch paint waits this long for a second finger (a twist never harvests or plows)
  padIdle: 5, longPress: 0.6, dragStart: 6, // s, s, px (the 🧭 view pad)
  orbit: { yawPerPx: 0.010, pitchPerPx: 0.005, pitchPerWheel: 0.0015 },
  zoomTilt: { enabled: false, per: 0.004, lo: -0.05, hi: 0.08 }, // optional polish, shipped OFF
};

// the gold recolour of the exclusive golden decorations (and gilding); desat / lift: the model's own colours fade
// most of the way to a brightened grey first, so the whole piece reads as bright gold. No metalness: the scene has
// no environment map for a metal to reflect, so metalness would only darken it to olive (and no glow: at night that
// turns a piece into a flat orange shape). A fountain's or a bird bath's water stays water: see MATS.vcWater.
export const GOLD = { color: '#ffd54a', metalness: 0, roughness: 0.4, desat: 0.8, lift: 0.65 };

// ---------------------------------------------------------------- the Post (timed gifts)
// Parcel n (n = parcels opened so far) is ready at s.post.nextAt: 5 min after the farm starts, then each next one is
// on its way the moment you open the last — gapFor(n) = gaps[n] ?? every (10 min, 15 min, 30 min, 3 h, then 8 h).
// It runs in real time, at most one waits (no stacking, no expiry). Contents depend only on n, the level when opened
// and the save's own RNG: gems, keepsakes, pantry goods, the Mailbox and a little coin (P(L)), first coins at 4 h.
// Never XP and never building materials: every parcel pays out through Game.grant().
export const POST = {
  gaps: [min(5), min(10), min(15), min(30), hr(3)], every: hr(8), // seconds, like the rest of config
  coins: (L) => round5(5 * Math.pow(L, 1.5)), // P(L), at the level when the parcel is opened
  // #1–#5 on a new farm: no coins, crops or goods before 4 h
  welcome: [
    { from: 'mabel', gems: 2, note: 'Welcome home, dear! The post comes to the farm now — here\'s a little something.' },
    { from: 'rosa', gems: 2, note: 'Hello, neighbour! I can\'t wait to taste your bread. See you soon! — Rosa' },
    // noteOwned: the note when the clover is already in the album (found while farming first): another piece comes instead
    { from: 'kip', gems: 2, keepsake: 'meadow:clover', note: 'I found a four-leaf clover by your fence! Grandma Mabel says it goes in her album!',
      noteOwned: 'Is this treasure?! I found it by your fence. Grandma Mabel says it\'s for her album!' },
    { from: 'hank', gems: 3, gift: 'mailbox', place: true, note: 'The village voted you a proper mailbox! Put it up by the road. — Mayor Hank' },
    { from: 'mabel', gems: 5, coins: true, keepsake: true, big: true, note: 'Something from my attic — and a little pocket money. More comes every 8 hours!' },
  ],
  // the one-off parcel of a farm from before the Post (see Game.migrate); it does not advance n
  office: { from: 'hank', gems: 5, coins: true, keepsake: 'meadow:clover', gift: 'mailbox', place: true, big: true, note: 'The village post office is open! Here\'s your own mailbox — a parcel every 8 hours.' },
  // #6 onwards: slot k = (n − 5) mod 4
  cycle: ['keepsake', 'pantry', 'postcard', 'big'],
  slots: {
    keepsake: { gems: 1, keepsake: true, from: (L, n) => (L >= 21 && ((n - 5) >> 2) % 2 ? 'juno' : L >= 7 ? 'kip' : 'mabel') },
    pantry: { pantry: true, from: (L) => (L >= 7 ? 'rosa' : 'mabel') },
    postcard: { gems: 2, from: (L, n) => (L >= 16 && ((n - 5) >> 2) % 2 ? 'hank' : L >= 11 ? 'theo' : 'mabel') },
    big: { gems: 4, coins: true, keepsake: true, big: true, from: () => 'mabel' },
  },
  golds: ['goldscarecrow', 'goldlamp'], goldEvery: 3, goldFallbackGems: 3, // every 3rd Big parcel: n = 16, 28; then 💎3
  keepsakeFallbackGems: 2, pantryMaxQty: 6,
  // names in teasers and notes (the full name and icon come from VISITORS.npcs)
  short: { mabel: 'Grandma Mabel', rosa: 'Rosa', kip: 'Kip', theo: 'Theo', hank: 'Mayor Hank', juno: 'Juno' },
  kinds: {
    welcome: { icon: '📦', label: 'Parcel' }, keepsake: { icon: '🔖', label: 'Keepsake parcel' }, pantry: { icon: '📦', label: 'Pantry parcel' },
    postcard: { icon: '📨', label: 'Postcard' }, big: { icon: '✨', label: 'Big parcel' }, office: { icon: '📮', label: 'Post office opening' },
  },
  // recurring notes: notes[sender][floor((n − 5) / 4) % 3]
  notes: {
    mabel: ['Thought of you while knitting. Here\'s a little something.', 'Fresh from my pantry, dear — don\'t let the hens see!', 'Warm wishes from your Grandma Mabel!'],
    rosa: ['Baked one too many — I know you\'ll find a use!', 'For the hardest-working farmer in the valley!', 'Flour on everything, but love in the box!'],
    kip: ['Is this treasure?! I think it\'s treasure!', 'Don\'t tell Mum I sent this!', 'It\'s for your album! I checked twice!'],
    theo: ['Caught nothing today, but found this.', 'Quiet morning on the pond. Thought of you.', 'Mind the wet bits — it was near the river.'],
    hank: ['On behalf of the whole village: thank you!', 'The council voted. You get a parcel!', 'Official business: one parcel, with thanks.'],
    juno: ['I painted the wrapping myself. Open gently!', 'Inspired by your sunflowers. Enjoy!', 'Art is better shared. So is this!'],
  },
};

// ---------------------------------------------------------------- Mabel's Keepsake Album (data)
// 12 pages of 6 keepsakes ('<page>:<item>'). The album opens with the first keepsake (Kip's clover in parcel #3, the
// office parcel, or level 8); a page opens at its level. src: the actions whose finds go there (null = anywhere).
export const ALBUM = {
  openLevel: 8, divisor: (L) => Math.max(60, xpToNext(L)), maxChance: 0.5, pity: 1.5,
  launchPages: 8, launch: { gems: 10, gift: 'curio', title: 'Keeper of Keepsakes' },
  all: { title: 'Valley Historian' }, voucherFallbackGems: 15,
  pages: [
    { id: 'meadow', name: 'Meadow Finds', icon: '🌼', level: 0, src: ['crop'], hint: 'Turns up while harvesting crops', prize: { gems: 3, gift: 'bluebath' },
      items: [['clover', '🍀', 'Four-Leaf Clover'], ['ladybird', '🐞', 'Ladybird'], ['butterfly', '🦋', 'Butterfly'], ['snail', '🐌', 'Garden Snail'], ['caterpillar', '🐛', 'Caterpillar'], ['blossom', '🌸', 'Cherry Blossom']] },
    { id: 'barn', name: 'Barnyard Bits', icon: '🔔', level: 8, src: ['animal'], hint: 'Turns up while collecting from animals', prize: { gems: 4, gift: 'copperwell' },
      items: [['bell', '🔔', 'Cow Bell'], ['feather', '🪶', 'Rooster Feather'], ['gloves', '🧤', 'Work Gloves'], ['chick', '🐣', 'Hatching Chick'], ['paw', '🐾', 'Paw-Print Tag'], ['rosette', '🏵️', 'Prize Rosette']] },
    { id: 'kitchen', name: 'Grandma\'s Kitchen', icon: '🫖', level: 11, src: ['workshop'], hint: 'Turns up when you collect workshop goods', prize: { gems: 5, gift: 'rosepicnic' },
      items: [['teapot', '🫖', 'Teapot'], ['spoon', '🥄', 'Wooden Spoon'], ['skillet', '🍳', 'Skillet'], ['bowl', '🥣', 'Mixing Bowl'], ['cupcake', '🧁', 'Cupcake'], ['timer', '⏲️', 'Kitchen Timer']] },
    { id: 'notes', name: 'Neighbourly Notes', icon: '💌', level: 14, src: ['order', 'visitor', 'wagon'], hint: 'Turns up with orders, visitors and wagon crates', prize: { gems: 5, gift: 'blossomarch' },
      items: [['letter', '💌', 'Love Letter'], ['postcard', '✉️', 'Postcard'], ['camera', '📷', 'Old Camera'], ['photo', '🖼️', 'Old Photo'], ['scarf', '🧣', 'Knitted Scarf'], ['ticket', '🎟️', 'Fair Ticket']] },
    { id: 'orchard', name: 'Orchard Treasures', icon: '🦉', level: 17, src: ['fruit', 'crop'], hint: 'Turns up while picking fruit or harvesting', prize: { gems: 6, gift: 'harvestmill' },
      items: [['chestnut', '🌰', 'Chestnut'], ['maple', '🍁', 'Maple Leaf'], ['autumn', '🍂', 'Autumn Leaf'], ['squirrel', '🐿️', 'Carved Squirrel'], ['owl', '🦉', 'Owl Figurine'], ['hedgehog', '🦔', 'Hedgehog']] },
    { id: 'market', name: 'Market Day', icon: '⚖️', level: 19, src: null, hint: 'Turns up anywhere you farm', prize: { gems: 6, gift: 'mossfountain' },
      items: [['scales', '⚖️', 'Brass Scales'], ['abacus', '🧮', 'Abacus'], ['tag', '🏷️', 'Price Tag'], ['dice', '🎲', 'Lucky Dice'], ['yoyo', '🪀', 'Yo-yo'], ['marble', '🔮', 'Glass Marble']] },
    { id: 'pond', name: 'Mill Pond', icon: '🐸', level: 24, src: null, hint: 'Turns up anywhere you farm', prize: { gems: 7, gift: 'lilacgazebo' },
      items: [['frog', '🐸', 'Frog'], ['shell', '🐚', 'Pond Shell'], ['swan', '🦢', 'Swan'], ['turtle', '🐢', 'Turtle'], ['duck', '🦆', 'Duckling'], ['canoe', '🛶', 'Toy Canoe']] },
    { id: 'attic', name: 'Mabel\'s Attic', icon: '📔', level: 27, src: null, hint: 'Turns up anywhere you farm', prize: { gems: 8, gift: 'silverrooster' },
      items: [['diary', '📔', 'Mabel\'s Diary'], ['ring', '💍', 'Grandpa\'s Ring'], ['doll', '🪆', 'Nesting Doll'], ['teddy', '🧸', 'Teddy Bear'], ['radio', '📻', 'Old Radio'], ['clock', '🕰️', 'Mantel Clock']] },
    { id: 'heirloom', name: 'Family Heirlooms', icon: '👑', level: 31, src: null, hint: 'Turns up anywhere you farm', prize: { gems: 8, gift: 'skyballoon' },
      items: [['crown', '👑', 'Tin Crown'], ['key', '🗝️', 'Skeleton Key'], ['suitcase', '🧳', 'Old Suitcase'], ['fiddle', '🎻', 'Old Fiddle'], ['mirror', '🪞', 'Hand Mirror'], ['horn', '📯', 'Herald Horn']] },
    { id: 'stars', name: 'Starry Nights', icon: '🔭', level: 35, src: null, hint: 'Turns up anywhere you farm', prize: { gems: 8, voucher: 1 },
      items: [['telescope', '🔭', 'Telescope'], ['moon', '🌙', 'Moon Lantern'], ['star', '🌠', 'Shooting Star'], ['planet', '🪐', 'Planet Mobile'], ['comet', '☄️', 'Comet Charm'], ['cricket', '🦗', 'Cricket Box']] },
    { id: 'festival', name: 'Festival Keepsakes', icon: '🎠', level: 37, src: null, hint: 'Turns up anywhere you farm', prize: { gems: 10, voucher: 1 },
      items: [['carousel', '🎠', 'Carousel Horse'], ['kite', '🪁', 'Kite'], ['masks', '🎭', 'Theatre Masks'], ['bigtop', '🎪', 'Toy Big Top'], ['streamer', '🎏', 'Carp Streamer'], ['chime', '🎐', 'Wind Chime']] },
    { id: 'champion', name: 'Grand Champion', icon: '🥇', level: 39, src: null, hint: 'Turns up anywhere you farm', prize: { gems: 10, voucher: 2 },
      items: [['gold', '🥇', 'Gold Medal'], ['silver', '🥈', 'Silver Medal'], ['bronze', '🥉', 'Bronze Medal'], ['medal', '🏅', 'Prize Medal'], ['badge', '🎖️', 'Judge\'s Badge'], ['toast', '🥂', 'Toast Glasses']] },
  ],
};
// 'meadow:clover' → { id, page, item, icon, name }
export const KEEPSAKES = {};
for (const p of ALBUM.pages) for (const [item, icon, name] of p.items) KEEPSAKES[`${p.id}:${item}`] = { id: `${p.id}:${item}`, page: p.id, item, icon, name };

// ---------------------------------------------------------------- Prettiest Farm: 💗 charm, ribbons and gilding
// Mayor Hank's contest (from L19). Every placed decoration adds charm (derived, never stored): up to 3 of each kind
// count, a gilded copy triple. 30 finite ranks pay gems, two exclusive decorations and titles — never XP, coins
// production or materials (every reward goes through Game.grant('charm')). From L31 a premium piece (base price
// ≥ 🪙1,500) can be gilded with coins + gems or a voucher from the album: the late-game coin and gem sink.
export const CHARM = {
  level: 19, gildLevel: 31, perKind: 3, gildMult: 3, gildMin: 1500,
  // a decoration's charm: its own value (the exclusives), else 4·√price
  of: (type) => {
    const d = OBJECTS[type];
    return d?.kind === 'decor' ? (d.charm ?? Math.round(4 * Math.sqrt(d.cost || 0))) : 0;
  },
  // 💗 needed for rank r: round10(60r + 16r²) → 80, 180, 320 … 16,200
  rank: (r) => Math.round((60 * r + 16 * r * r) / 10) * 10, ranks: 30,
  // r1..r30: 124 gems in all, Blossom Oak at 5, Frosted Pine at 15, titles at 5/10/15/20/25/30, the rosette at 10
  rewards: [
    { gems: 2 }, { gems: 2 }, { gems: 2 }, { gems: 3 }, { gift: 'blossomoak', title: 'Charming Farm' },
    { gems: 3 }, { gems: 3 }, { gems: 3 }, { gems: 4 }, { gems: 5, title: 'Prize Farm', rosette: true },
    { gems: 4 }, { gems: 4 }, { gems: 4 }, { gems: 4 }, { gift: 'frostpine', title: 'Blue Ribbon Farm' },
    { gems: 4 }, { gems: 4 }, { gems: 4 }, { gems: 4 }, { gems: 6, title: 'Valley Showpiece' },
    { gems: 4 }, { gems: 4 }, { gems: 4 }, { gems: 4 }, { gems: 8, title: 'Pride of the Valley' },
    { gems: 5 }, { gems: 5 }, { gems: 5 }, { gems: 5 }, { gems: 15, title: 'Grand Champion Farm' },
  ],
  rosetteRank: 10,
  // gilding: the price of the piece it is (or recolours), e.g. the Mossy Fountain's is the Fountain's 🪙4,000
  gildBase: (type) => { const d = OBJECTS[type]; return d?.kind === 'decor' ? (OBJECTS[d.model]?.cost ?? d.cost ?? 0) : 0; },
  gildCost: (base) => ({ coins: 2 * base, gems: Math.ceil(Math.pow(base, 0.3)) }),
  gold: GOLD, // shared with the golden exclusives (one tint path)
};

// Levels where future content can slot in without rebalancing (keep these in mind when adding features).
// 31/35/37/39 hold album pages (31 also gilding). Planned next: seasons 32, map 33, fishing 34, kitchen 36,
// pets 38, foraging 40. Rules of thumb: one visible unlock per level, a major unlock every 2-3 levels,
// 2nd copies at unlock+8, and price new things with the formulas above.
export const FUTURE_SLOTS = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
