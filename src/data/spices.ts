/**
 * 3una5aha — the Sri Lankan spice library.
 *
 * Short posts about the spices behind Sri Lankan cooking, one card each
 * on the /food channel. Categories group the filter chips. Growing set —
 * the island uses ~100; add more entries here and git push, the page
 * picks them up on deploy.
 *
 * Brand spelling reminder: "Ai" — and the channel name is "3una5aha"
 * (pronounced "thuna paha", the classic Sinhala five-spice curry blend).
 */

export type Spice = {
  id: string;
  name: string;
  sinhala: string;
  category: string;
  emoji: string;
  /** Wikimedia Commons search term the page uses to find a photo. */
  imgQuery: string;
  post: string;
  /** Sinhala language explanation of the item. */
  postSi?: string;
  /**
   * Ingredients for a 5-person portion (only for dishes/sweets — omit for raw spices).
   * nameSi is the Sinhala name of the ingredient.
   */
  ingredients?: Array<{ name: string; nameSi: string; qty5: string }>;
};

export const SPICES: Spice[] = [
  {
    id: "thuna-paha",
    imgQuery: "intitle:curry intitle:powder Sri Lanka",
    name: "Thuna Paha",
    sinhala: "තුන පහ",
    category: "Blend",
    emoji: "\u{1F35B}",
    post: "The blend this channel is named after — 'three-five', the classic Sinhala curry powder of coriander, cumin, fennel, cinnamon and curry leaves. Every Sri Lankan kitchen roasts its own, and no two houses taste the same.",
  },
  {
    id: "roasted-curry-powder",
    imgQuery: "intitle:curry intitle:powder roasted",
    name: "Roasted Curry Powder",
    sinhala: "බැදපු තුන පහ",
    category: "Blend",
    emoji: "\u{1F372}",
    post: "Thuna paha's darker sibling: the same spices dry-roasted until deep brown. It powers black curries — jaffna crab, black pork curry — with a smoky depth raw powder can't reach.",
  },
  {
    id: "cinnamon",
    imgQuery: "intitle:cinnamon quills bark",
    name: "Ceylon Cinnamon",
    sinhala: "කුරුඳු",
    category: "Bark & Root",
    emoji: "\u{1FAB5}",
    post: "Sri Lanka's gift to the world — true cinnamon, softer and sweeter than cassia, peeled by hand into feather-thin quills. The island still grows most of the world's supply, just like it did when spice ships fought over it.",
  },
  {
    id: "turmeric",
    imgQuery: "intitle:turmeric powder",
    name: "Turmeric",
    sinhala: "කහ",
    category: "Bark & Root",
    emoji: "\u{1F49B}",
    post: "The golden root that colours almost every Sri Lankan curry. A pinch goes into the pot first with onions and curry leaves — for colour, earthiness, and its famous anti-inflammatory punch.",
  },
  {
    id: "ginger",
    imgQuery: "intitle:ginger root fresh",
    name: "Ginger",
    sinhala: "ඉඟුරු",
    category: "Bark & Root",
    emoji: "\u{1FADA}",
    post: "Crushed with garlic into the base of most meat curries, brewed into plain tea for colds, and candied for sweets. Island ginger is small, fibrous and twice as sharp as the supermarket kind.",
  },
  {
    id: "cardamom",
    imgQuery: "intitle:cardamom pods green",
    name: "Cardamom",
    sinhala: "එනසාල්",
    category: "Fruit & Pod",
    emoji: "\u{1F33F}",
    post: "The 'queen of spices' — green pods crushed into rice, milk toffee and curries alike. Sri Lankan cardamom grows in the misty hills of Kandy and gives watalappan its floral note.",
  },
  {
    id: "cloves",
    imgQuery: "intitle:cloves dried spice",
    name: "Cloves",
    sinhala: "කරාබු නැටි",
    category: "Fruit & Pod",
    emoji: "\u{1F334}",
    post: "Dried flower buds that look like tiny nails and taste like warm perfume. Two or three go into a pot of yellow rice; chewing one is the island's oldest breath freshener.",
  },
  {
    id: "nutmeg",
    imgQuery: "intitle:nutmeg seed",
    name: "Nutmeg",
    sinhala: "සාදික්කා",
    category: "Fruit & Pod",
    emoji: "\u{1F330}",
    post: "One tree, two spices: the seed is nutmeg, its red lace covering is mace. Grated fresh over milk rice and love cake — a little makes dessert sing, a lot makes you sleepy.",
  },
  {
    id: "mace",
    imgQuery: "intitle:mace nutmeg spice",
    name: "Mace",
    sinhala: "වසාවාසි",
    category: "Fruit & Pod",
    emoji: "\u{1F9E1}",
    post: "The crimson web wrapped around the nutmeg seed, milder and more floral than its twin. Prized in rich meat curries and the secret warmth in many Ceylon spice blends.",
  },
  {
    id: "black-pepper",
    imgQuery: "intitle:peppercorns black",
    name: "Black Pepper",
    sinhala: "ගම්මිරිස්",
    category: "Seed",
    emoji: "\u{26AB}",
    post: "Before chili ever reached the island, this was the heat. Sri Lankan black pepper is oily, bold and high in piperine — 'gammiris' still means serious spice in any village kitchen.",
  },
  {
    id: "chili",
    imgQuery: "intitle:chili dried red pepper",
    name: "Dried Chili",
    sinhala: "මිරිස්",
    category: "Fruit & Pod",
    emoji: "\u{1F336}",
    post: "The Portuguese brought it; Sri Lanka never looked back. Sun-dried, flaked or ground — it's the fire in pol sambol and the red in every 'devilled' dish on the island.",
  },
  {
    id: "coriander",
    imgQuery: "intitle:coriander seeds",
    name: "Coriander Seed",
    sinhala: "කොත්තමල්ලි",
    category: "Seed",
    emoji: "\u{1F7E4}",
    post: "The biggest share of any curry powder — citrusy, nutty, gentle. Boiled whole it becomes kottamalli tea, the island's first medicine for every cold and fever.",
  },
  {
    id: "cumin",
    imgQuery: "intitle:cumin seeds",
    name: "Cumin",
    sinhala: "සූදුරු",
    category: "Seed",
    emoji: "\u{1F33E}",
    post: "Earthy seeds that anchor thuna paha and rice pilafs. Roasted and ground with coriander and fennel, it's the backbone note your tongue reads as 'curry'.",
  },
  {
    id: "fennel",
    imgQuery: "intitle:fennel seeds",
    name: "Fennel Seed",
    sinhala: "මාදුරු",
    category: "Seed",
    emoji: "\u{1F331}",
    post: "Sweet, liquorice-scented seeds that round off the curry-powder trio. Chewed after meals as a digestive, and the quiet sweetness inside Sri Lankan fish curries.",
  },
  {
    id: "fenugreek",
    imgQuery: "intitle:fenugreek seeds",
    name: "Fenugreek",
    sinhala: "උළුහාල්",
    category: "Seed",
    emoji: "\u{1F7E8}",
    post: "Tiny bitter cubes that turn magical in coconut milk — they thicken and mellow white curries like kiri hodi. Soaked overnight, they're also a village remedy for the stomach.",
  },
  {
    id: "mustard-seed",
    imgQuery: "intitle:mustard seeds yellow",
    name: "Mustard Seed",
    sinhala: "අබ",
    category: "Seed",
    emoji: "\u{1F7E1}",
    post: "Popped in hot oil until they crackle — the opening beat of countless island dishes. Ground into a paste they sharpen pickles like malay achcharu.",
  },
  {
    id: "curry-leaves",
    imgQuery: "intitle:curry intitle:leaves plant",
    name: "Curry Leaves",
    sinhala: "කරපිංචා",
    category: "Leaf & Herb",
    emoji: "\u{1F343}",
    post: "Not 'curry flavour' — a tree of its own, and the single most Sri Lankan smell there is. A sprig sizzling in coconut oil with onions is how a thousand curries begin.",
  },
  {
    id: "pandan",
    imgQuery: "intitle:pandan leaves",
    name: "Pandan (Rampe)",
    sinhala: "රම්පෙ",
    category: "Leaf & Herb",
    emoji: "\u{1F33F}",
    post: "The long green leaf knotted into every pot of rice and curry, lending a nutty, jasmine-like aroma. Sri Lankans call rice cooked without it 'naked'.",
  },
  {
    id: "lemongrass",
    imgQuery: "intitle:lemongrass stalks",
    name: "Lemongrass (Sera)",
    sinhala: "සේර",
    category: "Leaf & Herb",
    emoji: "\u{1F33E}",
    post: "A bruised stalk in the curry pot brings citrus without the fruit. Paired with rampe and curry leaves, it forms the island's aromatic holy trinity.",
  },
  {
    id: "garlic",
    imgQuery: "intitle:garlic bulbs",
    name: "Garlic",
    sinhala: "සුදු ලූනු",
    category: "Bark & Root",
    emoji: "\u{1F9C4}",
    post: "Whole cloves melt into dhal curry; crushed, it partners ginger at the base of nearly everything savoury. Garlic curry itself — sudu lunu curry — is a beloved dish, not just a seasoning.",
  },
  {
    id: "tamarind",
    imgQuery: "intitle:tamarind pods",
    name: "Tamarind",
    sinhala: "සියඹලා",
    category: "Fruit & Pod",
    emoji: "\u{1F36B}",
    post: "The sour soul of southern cooking. A lime-sized ball soaked in water gives fish ambul thiyal its dark tang and keeps it good for days without a fridge.",
  },
  {
    id: "goraka",
    imgQuery: "intitle:Garcinia dried fruit",
    name: "Goraka",
    sinhala: "ගොරකා",
    category: "Fruit & Pod",
    emoji: "\u{1F358}",
    post: "A smoked, dried garcinia fruit — blacker and smokier than tamarind. It's what makes true ambul thiyal 'sour fish curry' and not just fish curry.",
  },
  {
    id: "curry-powder-unroasted",
    imgQuery: "intitle:curry intitle:powder yellow",
    name: "White Curry Powder",
    sinhala: "සුදු කරි කුඩු",
    category: "Blend",
    emoji: "\u{1F35A}",
    post: "The gentle blend for vegetable and coconut-milk curries — raw-ground coriander, cumin and fennel. White curries are the island's comfort food: mild, milky, everyday.",
  },
  {
    id: "sweet-cumin",
    imgQuery: "intitle:caraway seeds",
    name: "Caraway (Sweet Cumin)",
    sinhala: "සූදුරු මාදුරු",
    category: "Seed",
    emoji: "🫘",
    post: "Often confused with fennel in island markets, this warmer seed slips into biryani masalas and festive rice, a legacy of Malay and Moor kitchens on the coast.",
  },
  {
    id: 'surul-kavum',
    imgQuery: 'File:Surul kavum',
    name: 'Surul Kavum',
    sinhala: 'සුරුල් කැවුම්',
    category: 'Sri Lankan Cakes & Sweets',
    emoji: '🌀',
    post: 'A festive Sri Lankan deep-fried sweet made from a batter of rice flour, treacle, and coconut milk, rolled into a scroll shape before frying. A staple of Sinhala and Tamil New Year tables alongside kokis and kevum, it has a lightly crisp exterior and a dense, chewy, mildly sweet interior.',
    postSi: 'සුරුල් කැවුම් යනු හාල් පිටි, කිතුල් හකුරු සහ පොල් කිරි යොදා සාදා රෝල් කරන ලද හැඩයෙන් රත් තෙලේ බදා ගන්නා සාම්ප්‍රදායික ශ්‍රී ලාංකික රසකැවිල්ලකි.',
    ingredients: [
      { name: 'Rice flour', nameSi: 'හාල් පිටි', qty5: '300 g' },
      { name: 'Kithul treacle', nameSi: 'කිතුල් හකුරු', qty5: '150 ml' },
      { name: 'Coconut milk (thick)', nameSi: 'පොල් කිරි', qty5: '200 ml' },
      { name: 'Coconut oil (for frying)', nameSi: 'පොල් තෙල්', qty5: '500 ml' },
      { name: 'Salt', nameSi: 'ලුණු', qty5: '1/4 tsp' },
      { name: 'Sesame seeds (optional)', nameSi: 'තල ඇට', qty5: '1 tbsp' },
    ],
  },
  {
    id: "undu-wel",
    imgQuery: "undu wel sri lanka sweet",
    name: "Undu Wel",
    sinhala: "උළුඳු වැල්",
    category: "Sri Lankan Cakes & Sweets",
    emoji: "🍯",
    post: "A traditional Sinhala and Tamil New Year sweet made from a thick batter of urad dal (black gram) and rice flour. It is piped into hot oil in coiled, spiral shapes, deep-fried until golden, and immediately plunged into warm, dark kithul treacle. The result is a delightfully crunchy exterior with a juicy, syrup-filled center.",
    postSi: "උළුඳු වැල් යනු සිංහල සහ දෙමළ අලුත් අවුරුදු සමයේ සාම්ප්‍රදායික රසකැවිලි වර්ගයකි. උළුඳු පිටි සහ හාල් පිටි ඝන ලෙස ගළපා, රත් තෙලේ ඇලෙළි හැඩයෙන් ඉවෙකා ගෙන කිතුල් හකුරු පැණි වල ගිල්වා ගනී. පිටත කිළිටු-දෙකා ස්වභාවයකින් ද ඇතුළත රස පැණිය සෙවිලෙන් ද යුක්ත රසකැවිලි වර්ගයකි.",
    ingredients: [
      { name: "Urad dal (black gram), soaked", nameSi: "උළුඳු", qty5: "250 g" },
      { name: "Rice flour", nameSi: "හාල් පිටි", qty5: "100 g" },
      { name: "Kithul treacle", nameSi: "කිතුල් පැණි", qty5: "200 ml" },
      { name: "Coconut oil (for frying)", nameSi: "පොල් තෙල්", qty5: "500 ml" },
      { name: "Salt", nameSi: "ලුණු", qty5: "¼ tsp" },
      { name: "Water (to adjust batter)", nameSi: "වතුර", qty5: "as needed" },
    ],
  },
];
