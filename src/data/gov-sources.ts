/**
 * GK SMART Accounting — the Cambodian government sources the channel
 * follows. These institutions post daily (training, events, Prakas,
 * announcements) in Khmer; the gov-fetch pipeline pulls their official
 * WEBSITE news pages, translates with Gemini, and stores in Mongo.
 *
 * Facebook pages are listed for reference only — FB blocks server-side
 * reading (Graph API needs app review), so the websites are the feed.
 * If a URL rots, fix it here and push.
 */

export type GovSource = {
  /** Short code shown in pills and used as the Mongo `agency` key. */
  abbrev: string;
  name: string;
  nameKm: string;
  /** Official website page that lists recent news/announcements. */
  newsUrl: string;
  /** Public Facebook page (reference / manual cross-check). */
  facebook: string;
  /** Wikimedia Commons search used by the page to find the official logo. */
  logoQuery: string;
  /** Tile gradient for the fallback initials badge. */
  colors: [string, string];
};

export const GOV_SOURCES: GovSource[] = [
  {
    abbrev: "GDT",
    name: "General Department of Taxation",
    nameKm: "អគ្គនាយកដ្ឋានពន្ធដារ",
    newsUrl: "https://www.tax.gov.kh/km/news",
    facebook: "https://www.facebook.com/gdtcambodia",
    logoQuery: "General Department of Taxation Cambodia logo",
    colors: ["#1e6fb8", "#0c3a66"],
  },
  {
    abbrev: "ACAR",
    name: "Accounting and Auditing Regulator",
    nameKm: "និយតករគណនេយ្យ និងសវនកម្ម",
    newsUrl: "https://www.acar.gov.kh/",
    facebook: "https://www.facebook.com/acar.gov.kh",
    logoQuery: "Accounting and Auditing Regulator Cambodia logo",
    colors: ["#7a4fb0", "#3c2360"],
  },
  {
    abbrev: "MEF",
    name: "Ministry of Economy and Finance",
    nameKm: "ក្រសួងសេដ្ឋកិច្ច និងហិរញ្ញវត្ថុ",
    newsUrl: "https://mef.gov.kh/documents-category/press-release/",
    facebook: "https://www.facebook.com/mefcambodia",
    logoQuery: "Ministry of Economy and Finance Cambodia logo",
    colors: ["#b8860b", "#5c4306"],
  },
  {
    abbrev: "MoC",
    name: "Ministry of Commerce",
    nameKm: "ក្រសួងពាណិជ្ជកម្ម",
    newsUrl: "https://www.moc.gov.kh/km/media/press-releases",
    facebook: "https://www.facebook.com/moc.gov.kh",
    logoQuery: "Ministry of Commerce Cambodia logo",
    colors: ["#c0392b", "#5e1c14"],
  },
  {
    abbrev: "GDCE",
    name: "General Department of Customs and Excise",
    nameKm: "អគ្គនាយកដ្ឋានគយ និងរដ្ឋាករ",
    newsUrl: "https://www.customs.gov.kh/news/",
    facebook: "https://www.facebook.com/customs.gov.kh",
    logoQuery: "General Department of Customs and Excise Cambodia logo",
    colors: ["#0e7c62", "#064234"],
  },
  {
    abbrev: "NA",
    name: "National Assembly of Cambodia",
    nameKm: "រដ្ឋសភា",
    newsUrl: "https://www.nac.gov.kh/",
    facebook: "https://www.facebook.com/nationalassemblycambodia",
    logoQuery: "National Assembly Cambodia seal",
    colors: ["#8c6d1f", "#4a3810"],
  },
  {
    abbrev: "MoI",
    name: "Ministry of Interior",
    nameKm: "ក្រសួងមហាផ្ទៃ",
    newsUrl: "https://www.interior.gov.kh/",
    facebook: "https://www.facebook.com/moi.gov.kh",
    logoQuery: "Ministry of Interior Cambodia logo",
    colors: ["#4a5568", "#23282f"],
  },
];
