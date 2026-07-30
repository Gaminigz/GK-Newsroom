/**
 * Garment/textile trade-press directory for Yai (Texlink) PR outreach.
 *
 * Sourced from a research pass over the media-partner list published by the
 * Cambodia Int'l Textile & Garment Industry Exhibition (ctg.chanchao.com.tw).
 * Tier reflects how usable the outlet is for pitching Yai, not quality of
 * the publication itself:
 *   1 = real, live outreach channel (submit-article / press page / direct
 *       editor email) and genuinely covers garment/footwear/textile mfg.
 *   2 = real outlet, tangential fit (raw materials, technical textiles,
 *       marketplace/directory rather than editorial).
 *   3 = not a fit — wrong sector, dormant, or the site is dead.
 */

export type GarmentOutlet = {
  slug: string;
  name: string;
  iso: string; // HQ country, for the flag
  url: string;
  tier: 1 | 2 | 3;
  what: string;
  audience: string;
  outreach: string; // concrete contact route found
  verdict: string;
  /** Keyword phrase for the topical news query — most small trade sites
   * are barely indexed by Google News under `site:`, so we ALSO search
   * their actual beat (e.g. "Bangladesh RMG garment factory") to surface
   * real industry news, not just their own back-issue archive pages. */
  topic: string;
};

export const GARMENT_OUTLETS: GarmentOutlet[] = [
  // ---------------- Tier 1: real channel, pitch now ----------------
  {
    slug: "textile-focus",
    name: "Textile Focus",
    iso: "BD",
    url: "https://textilefocus.com",
    tier: 1,
    what: "Bangladesh's leading bi-monthly RMG (Ready-Made Garment) trade magazine — business, sustainability, technology, smart textiles.",
    audience: "Bangladesh/South Asia RMG factory owners, manufacturers, supply-chain and sustainability stakeholders.",
    outreach: "info@textilefocus.com · +88 02 48119567 · Advertisement page: textilefocus.com/advertisement/",
    verdict: "Strong — pitch a guest article or press release on AI-native factory digitalization for their Technology/Sustainability section.",
    topic: "Bangladesh RMG garment factory",
  },
  {
    slug: "textile-value-chain",
    name: "Textile Value Chain",
    iso: "IN",
    url: "https://textilevaluechain.in",
    tier: 1,
    what: "Active Indian textile/apparel/retail trade media house (since 2012) — magazine, e-magazine, newsletter, web portal.",
    audience: "India-based, global textile/apparel value-chain professionals, brands and suppliers.",
    outreach: "Dedicated /submit-article and /advertisement pages; general /contact page.",
    verdict: "Strong — genuinely on-topic and structured for outreach; pitch a bylined article on AI adoption in Cambodian garment factories.",
    topic: "India textile apparel manufacturing",
  },
  {
    slug: "fashion-value-chain",
    name: "Fashion Value Chain",
    iso: "IN",
    url: "https://fashionvaluechain.com",
    tier: 1,
    what: "Indian fashion/apparel media + sourcing platform (e-magazine + e-directory), sister title of Textile Value Chain, since 2012.",
    audience: "India-centric with international reach — designers, brands, retailers, stylists, fashion entrepreneurs.",
    outreach: "Dedicated /advertise, /submit-article, /submit-event pages; general /contact-us.",
    verdict: "Strong — good fit for a bylined guest article or an event/press-release submission tied to a trade show appearance.",
    topic: "India fashion apparel garment manufacturing",
  },
  {
    slug: "home-fashion-trends",
    name: "Home Fashion Trends",
    iso: "IN",
    url: "https://thehomefashion.in",
    tier: 1,
    what: "Mumbai-based digital trade publication on home textiles/furnishings, retail and sustainability — same publisher network as Textile Value Chain.",
    audience: "Home-textile manufacturers, retailers and fashion/textile professionals, primarily India with some global coverage.",
    outreach: "Submit Article + Submit Event links live in nav; dedicated Advertise link; Contact Us page.",
    verdict: "Strong — live submission channel; submit a guest article on AI adoption in garment/home-textile manufacturing.",
    topic: "India home textile furnishing manufacturing",
  },
  {
    slug: "manufacturing-outlook",
    name: "Manufacturing Outlook",
    iso: "GB",
    url: "https://mfg-outlook.com",
    tier: 1,
    what: "Global B2B digital manufacturing magazine (Outlook Publishing Ltd., UK), ~210,000 monthly readers, 20+ sectors incl. a dedicated Textiles & Apparel category.",
    audience: "Global boardroom/operational decision-makers across manufacturing industries.",
    outreach: "\"Work With Us\" page (mfg-outlook.com/work-with-us), Media Pack (mfg-outlook.com/media-pack), Contact Us.",
    verdict: "Strong — pitch a feature story on AI adoption in Cambodian garment factories, or a Corporate Story profile of Yai/Texlink. ⚠️ Confirm which of several similarly-named Outlook Publishing sites the show actually links to before pitching.",
    topic: "garment textile apparel manufacturing factory",
  },
  {
    slug: "tekstil-teknoloji",
    name: "Tekstil Teknoloji",
    iso: "TR",
    url: "https://tekstilteknoloji.com.tr",
    tier: 1,
    what: "Established (1996) Turkish textile-technology trade magazine/portal — fiber-yarn, weaving-knitting, digital printing, dyeing-finishing, garment production.",
    audience: "Turkey-centered but internationally scoped (DE/IT/IN/US sections); manufacturers and machinery/tech suppliers; bilingual TR/EN.",
    outreach: "info@tekstilteknoloji.com.tr · info@etextilemagazine.com · +90 212 876 75 06",
    verdict: "Good — genuinely on-topic; pitch a feature/press release on Yai as an AI-native manufacturing tech platform via direct email.",
    topic: "Turkey textile technology garment manufacturing",
  },
  {
    slug: "jsn-international",
    name: "J.S.N. International",
    iso: "JP",
    url: "https://jsn-intl.com",
    tier: 1,
    what: "English-language monthly trade journal (since 1974) covering sewing/apparel machinery, CAD/CAM, embroidery tech. Tokyo-based.",
    audience: "Global — sewing factory owners and apparel-machinery makers (readers of YKK, Brother, Shima Seiki, Tajima etc).",
    outreach: "jsn-intl@dd.iij4u.or.jp · +81 3 3867 5815 (no formal press-kit page — contact directly).",
    verdict: "Good — machinery/tech angle; pitch a feature on AI adoption in sewing-floor automation.",
    topic: "sewing machinery apparel manufacturing technology",
  },
  {
    slug: "nippon-sewing-machine-news",
    name: "The Nippon Sewing Machine News",
    iso: "JP",
    url: "https://www.nmn-news-japan.com",
    tier: 1,
    what: "65+ year old English-language monthly (aka \"The Fashion Machine News\") — apparel/textile/embroidery/knitting machinery. Japan-published, worldwide circulation.",
    audience: "Global machinery-industry professionals (manufacturers, distributors, factories).",
    outreach: "Contact form + dedicated Advertisers page (/advertisers, /contact).",
    verdict: "Solid — position Yai as the \"AI layer\" for sewing-machinery-adjacent factories; pitch via contact form for a news brief or advertiser slot.",
    topic: "apparel sewing machinery manufacturing",
  },
  {
    slug: "taiwan-footwear-news",
    name: "台灣鞋訊 (Taiwan Footwear News)",
    iso: "TW",
    url: "http://tfn.bestmotion.com",
    tier: 1,
    what: "Official magazine of TFMA (Taiwan Footwear Manufacturers Association) since 1978 — Traditional Chinese with English translations.",
    audience: "Taiwan footwear industry — business owners, decision-makers, mid-to-senior managers.",
    outreach: "Advertising: Mr. Zhang, 0912@bestmotion.com, +886 4 2359 0112 #325 · Subscriptions: Ms. Li, 0411@bestmotion.com",
    verdict: "Relevant for the footwear segment specifically — advertise or pitch a translated feature on AI QA/production tools for footwear factories.",
    topic: "Taiwan footwear shoe manufacturing industry",
  },

  // ---------------- Tier 2: tangential, lower priority ----------------
  {
    slug: "technical-textiles-today",
    name: "Technical Textiles Today",
    iso: "IN",
    url: "https://technicaltextiles.in",
    tier: 2,
    what: "Indian digital news platform on technical textiles (automotive, medical, agri, sports, industrial applications).",
    audience: "Technical-textile manufacturers and industry stakeholders, mainly India, some global reach.",
    outreach: "Contact Us page; no visible \"Write for Us\" but active news desk; ad banners suggest paid placement possible.",
    verdict: "Adjacent — technical textiles ≠ garment/footwear manufacturing per se; usable only with a technical-fabric angle.",
    topic: "India technical textiles manufacturing",
  },
  {
    slug: "yarns-and-fibers",
    name: "YNFX (Yarns and Fibers)",
    iso: "IN",
    url: "https://yarnsandfibers.com",
    tier: 2,
    what: "B2B textile market-intelligence platform (est. 1998), global fiber/yarn market coverage.",
    audience: "Yarn/fiber manufacturers, traders, buyers, supply-chain and purchasing professionals — trade, not factory-ops.",
    outreach: "General contact email on site; no dedicated advertise/submit-news page found.",
    verdict: "Tangential — good for a raw-material/sourcing-trend angle, not for Yai's software/AI story directly.",
    topic: "India yarn fiber textile market",
  },
  {
    slug: "textiledaddy",
    name: "TextileDaddy",
    iso: "IN",
    url: "https://textiledaddy.com",
    tier: 2,
    what: "Indian B2B marketplace/directory (Trovetex Ventures) for textile & garment trade — listings, requirements board, some magazine/news content.",
    audience: "India-based but globally used; textile/garment buyers, sellers, machinery suppliers, manufacturers.",
    outreach: "Office@textiledaddy.com; company/service listing pages; no clear press-release intake.",
    verdict: "Marginal — primarily a sourcing/listing marketplace; best use is a free company listing as a technology/software service provider.",
    topic: "India textile garment trade",
  },
  {
    slug: "textile-trends",
    name: "Textile Trends",
    iso: "IN",
    url: "https://textile-trends.in",
    tier: 2,
    what: "Long-running (publisher since 1958) monthly print trade journal — Indian and global textile trade, policy, exports, industry events.",
    audience: "Textile industry executives and trade decision-makers, India plus Asian/European circulation.",
    outreach: "Contact email/phone listed; no advertise/submit-article CTAs; site shows low recent-activity signals.",
    verdict: "Marginal — legitimate legacy journal but likely semi-dormant digitally; low-effort email only, don't over-invest.",
    topic: "India textile trade export policy",
  },

  // ---------------- Tier 3: skip ----------------
  {
    slug: "asia-trade-hub",
    name: "Asia Trade Hub",
    iso: "IN",
    url: "https://asiatradehub.com",
    tier: 3,
    what: "Broad multi-industry B2B marketplace/directory, not a textile-specific publication or news outlet.",
    audience: "Global buyers/suppliers across many sectors; no dedicated textile/garment category.",
    outreach: "info@asiatradehub.com; company/product listing on the marketplace, not editorial.",
    verdict: "Skip — generic listings site, not press/media. At best a company profile, not a story or partner placement.",
    topic: "",
  },
  {
    slug: "india-export-news",
    name: "India Export News",
    iso: "IN",
    url: "https://indiaexportnews.com",
    tier: 3,
    what: "Trade news portal covering Indian exports, current focus is India–Africa trade (construction, automotive, power/energy).",
    audience: "Indian exporters/manufacturers targeting African markets — no garment/textile content found.",
    outreach: "Advertise, List Your Company, List Your Exhibition, Contact pages exist.",
    verdict: "Skip — sector mismatch (industrial/African trade focus, not apparel), unless a Cambodia-Africa angle emerges later.",
    topic: "",
  },
  {
    slug: "machineryline",
    name: "Machineryline",
    iso: "BE",
    url: "https://machineryline.com",
    tier: 3,
    what: "Large e-commerce marketplace (Linemedia group) for construction, industrial and material-handling equipment — not a media outlet.",
    audience: "Global equipment buyers/sellers — construction and industrial machinery dealers, not garment/textile factories.",
    outreach: "\"Place your ad\" listing tool; contact form. No editorial/press-release channel.",
    verdict: "Skip — no textile/garment machinery category, no editorial function; Yai is software, not machinery for sale.",
    topic: "",
  },
  {
    slug: "southeast-asia-globe",
    name: "GLOBE (Southeast Asia Globe)",
    iso: "KH",
    url: "https://southeastasiaglobe.com",
    tier: 3,
    what: "English/Khmer long-form journalism outlet covering Cambodia/ASEAN politics, culture, environment, economics. Suspended regular publishing end of Sept 2023 (financial difficulties); archive stays up, occasional new pieces via spin-off \"Focus Cambodia\".",
    audience: "Educated, policy-minded readers interested in Cambodia/SE Asia development — not a trade/manufacturing audience.",
    outreach: "Footer still lists an Advertise link, but not actively producing regular content.",
    verdict: "Skip — largely inactive and not trade-focused; redirect any Cambodia-development pitch to Focus Cambodia instead.",
    topic: "",
  },
  {
    slug: "58cam",
    name: "58cam.com (柬單網)",
    iso: "KH",
    url: "https://www.58cam.com",
    tier: 3,
    what: "General Chinese-language classifieds/community portal for the Chinese diaspora in Cambodia (jobs, real estate, marketplace, forums), Phnom Penh-based, founded 2014.",
    audience: "Chinese expatriates/overseas Chinese workers in Cambodia — not factory-industry specialists.",
    outreach: "广告咨询 (advertising inquiry) section, info@58cam.com, +855 98 375 667.",
    verdict: "Skip for trade-press coverage — it's local classifieds, not textile/garment media. Only useful as paid local ads targeting Chinese-owned factory operators directly.",
    topic: "",
  },
  {
    slug: "sampoorna-media",
    name: "Sampoorna Media",
    iso: "IN",
    url: "https://sampoornamedia.in",
    tier: 3,
    what: "Domain has expired (Hostinger renewal page). Cached snippets describe it as an Indian PR/media outfit (\"Sampoorna PR Media\").",
    audience: "Unknown — cached title suggests India-focused PR services.",
    outreach: "None currently reachable.",
    verdict: "Skip — dead site, cannot verify or use until found under a different URL.",
    topic: "",
  },
];
