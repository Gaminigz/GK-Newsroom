import { LANKA_SPICES_FLAT_ENTRIES } from './src/data/lanka-spices.mjs';
import { LANKA_DISHES_FLAT_ENTRIES } from './src/data/lanka-dishes-150.mjs';
import { LANKA_BAKERY_FLAT_ENTRIES } from './src/data/lanka-bakery.mjs';

const all = [
  ...LANKA_SPICES_FLAT_ENTRIES,
  ...LANKA_DISHES_FLAT_ENTRIES,
  ...LANKA_BAKERY_FLAT_ENTRIES
];

console.log(all[237]);
