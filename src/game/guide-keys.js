// The data-guide keys a guide may point at (pure: shared by the HUD, the planner and the tests).
// Every element the guide can target carries data-guide="<key>"; world targets (tiles, objects,
// ghost plots) are not keys. Names are checked against config, so a typo'd key fails the tests.
import { OBJECTS, ANIMALS, CROPS, RECIPES, ITEMS, STORAGE, PROJECTS } from './config.js';

const alt = (list) => list.map((s) => s.replace(/[^a-z0-9_-]/gi, '')).join('|');
const objTypes = alt(Object.keys(OBJECTS));
const animals = alt(Object.keys(ANIMALS));
const crops = alt(Object.keys(CROPS));
const recipes = alt(Object.keys(RECIPES));
const items = alt(Object.keys(ITEMS));
const stores = alt(Object.keys(STORAGE));
const projects = alt(Object.keys(PROJECTS));

export const GUIDE_KEY_PATTERNS = [
  // guide card and quest card
  /^guide:(next|alt|skip)$/,
  /^quest:(card|claim|meanwhile)$/,
  // top bar
  /^level:box$/,
  /^pill:(coins|gems)$/,
  /^btn:(today|trophy|settings)$/,
  // toolbar
  /^tool:(hand|plow|seed|remove)$/,
  /^btn:(shop|barn|orders)$/,
  // panels
  /^panel:close$/,
  // shop
  /^shop:tab:(buildings|animals|trees|decor|land)$/,
  new RegExp(`^shop:buy:(${objTypes})$`),
  new RegExp(`^shop:animal:(${animals})$`),
  new RegExp(`^shop:gift:(${objTypes})$`),
  /^shop:land:expand$/,
  // placement
  /^place:(ok|cancel|rotate)$/,
  // seeds
  new RegExp(`^seed:(${crops}|more)$`),
  new RegExp(`^seedbar:(${crops})$`),
  // orders (the Market Wagon tab appears from its level)
  /^order:deliver:\d+$/,
  /^orders:tab:(orders|wagon)$/,
  // factory
  new RegExp(`^factory:make:(${recipes})$`),
  /^factory:(finish|collect)$/,
  // pen
  /^pen:(buy|tend)$/,
  // storage
  new RegExp(`^storage:tab:(${stores}|toolshed)$`),
  new RegExp(`^storage:(sellExtras|upgrade):(${stores})$`),
  // today
  /^today:(gift|chore:\d+)$/,
  // farmhouse panel tabs
  /^farmhouse:tab:(progress|village|achievements|farm)$/,
  // visitor
  /^visitor:sell$/,
  // modals
  /^modal:(levelup:ok|daily:claim|chest:open)$/,
  // speech bubbles: a<animalId>, o<objectId>, v<visitorId>, plus the wagon and village projects
  /^bubble:[aov]\d+$/,
  new RegExp(`^bubble:(wagon|p(${projects}))$`),
  // other
  new RegExp(`^missing:(${items})$`),
  /^chip:replant$/,
];

export function isGuideKey(key) {
  return typeof key === 'string' && GUIDE_KEY_PATTERNS.some((re) => re.test(key));
}
