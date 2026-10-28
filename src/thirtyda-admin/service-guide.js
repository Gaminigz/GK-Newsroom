// Provider capabilities describe possible extensions. Current status and usage come only from the Hub response.
export const SERVICE_GUIDES = Object.freeze({
  tiktok: {
    purpose: 'Let people sign in to 30+DA with their TikTok account.',
    maker: 'TikTok',
    more: 'Display API can show an authorized account’s profile and videos. Content Posting API can upload drafts or publish content with the required approval and permissions.',
    docs: [['TikTok products', 'https://developers.tiktok.com/']],
  },
  'telegram-bot': {
    purpose: 'Verify a phone number when its owner shares their own contact with GKVerify, for 30+DA or the separately authenticated IEWS integration.',
    maker: 'Telegram',
    more: 'The Bot API also supports messages, media, commands, polls, notifications and Mini Apps. Our bot currently handles phone verification.',
    docs: [['Telegram Bot features', 'https://core.telegram.org/bots/features']],
  },
  'telegram-gateway': {
    purpose: 'Send a six-digit phone-verification code through Telegram as an optional paid alternative.',
    maker: 'Telegram Gateway',
    more: 'Gateway can check whether a verification message can be sent, send it, report delivery status and check a submitted code.',
    docs: [['Telegram Gateway API', 'https://core.telegram.org/gateway/api']],
  },
  facebook: {
    purpose: 'Let people sign in to 30+DA with their Facebook account.',
    maker: 'Meta / Facebook',
    more: 'Facebook Login can request permitted profile information with the person’s consent. Additional data permissions require their own integration and may require Meta review.',
    docs: [['Facebook Login documentation', 'https://developers.facebook.com/docs/facebook-login/']],
  },
  google: {
    purpose: 'Let people sign in to 30+DA with their Google account.',
    maker: 'Google Identity',
    more: 'Google Identity also offers One Tap, personalized sign-in buttons and automatic sign-in. Those flows would need to be added to our app.',
    docs: [['Google Identity features', 'https://developers.google.com/identity/gsi/web/guides/overview']],
  },
  whatsapp: {
    purpose: 'Deliver a 30+DA phone-verification code using an approved WhatsApp authentication template.',
    maker: 'Meta / WhatsApp',
    more: 'The Business Platform also supports customer support, service notifications, rich media, interactive messages and automated flows.',
    docs: [['WhatsApp Business Platform', 'https://business.whatsapp.com/products/business-platform']],
  },
  wechat: {
    purpose: 'Reserve a future connection for signing in with WeChat.',
    maker: 'Tencent / WeChat',
    more: 'The WeChat platform also offers sharing, Official Accounts, Mini Programs and payment products, with separate setup and eligibility requirements.',
    docs: [['Tencent’s open platform', 'https://open.tencent.com/']],
  },
  alipay: {
    purpose: 'Reserve a future connection for Alipay payments in our apps.',
    maker: 'Alipay',
    more: 'Alipay payment products can support online and in-store payments, transaction queries and refunds after merchant onboarding.',
    docs: [['Alipay developer help', 'https://global.alipay.com/developer/helpcenter']],
  },
  youtube: {
    purpose: 'Reserve a future YouTube account connection for our apps.',
    maker: 'Google / YouTube',
    more: 'YouTube Data API can search videos and channels, upload videos and manage playlists. Account authorization uses Google OAuth and the appropriate scopes.',
    docs: [['YouTube Data API', 'https://developers.google.com/youtube/data']],
  },
  apple: {
    purpose: 'Support 30+DA iPhone sign-in and revoke its Apple connection when an account is deleted.',
    maker: 'Apple',
    more: 'Sign in with Apple also supports web sign-in and a private email relay. A web integration would need its own configuration.',
    docs: [['Sign in with Apple', 'https://developer.apple.com/documentation/signinwithapple']],
  },
  wan: {
    purpose: 'Turn a picture and prompt from Yai Media Director into a short video on the M5.',
    maker: 'Wan / Alibaba',
    more: 'The Wan model family includes text-to-video and image-to-video models. More models, larger outputs and different workflows need compatible hardware and a worker integration.',
    docs: [['Wan’s original model project', 'https://github.com/Wan-Video/Wan2.2']],
  },
  places: {
    purpose: 'Find cafés, restaurants and other meeting locations for 30+DA Level 3 “Meet”.',
    maker: 'OpenStreetMap / Google Maps',
    more: 'Overpass can query other regions and categories of map objects. Google Places also offers autocomplete, nearby search, place details and photos through its separate APIs.',
    docs: [['OpenStreetMap Overpass', 'https://wiki.openstreetmap.org/wiki/Overpass_API'], ['Google Places features', 'https://developers.google.com/maps/documentation/places/web-service/overview']],
  },
  translate: {
    purpose: 'Translate private 30+DA chats and written answers between English, Khmer, Chinese, Korean and Japanese, using the M1 first.',
    maker: 'Tencent Hy-MT / Google Gemini',
    more: 'Hy-MT supports more languages than the five exposed in our app. Gemini API offers broader content generation, but this tower uses it only as an optional paid translation backup.',
    docs: [['Tencent’s Hy-MT model', 'https://huggingface.co/tencent/Hy-MT2-1.8B'], ['Gemini API capabilities', 'https://ai.google.dev/gemini-api/docs']],
  },
  desk: {
    purpose: 'Queue text, image and Google Maps jobs for the M1 worker, for our own content and other apps.',
    maker: 'GK worker using Google services',
    more: 'Google also provides Gemini APIs for content generation and analysis, and Places APIs for place details. This tower exposes the text, image and Maps jobs implemented by our worker.',
    docs: [['Gemini API capabilities', 'https://ai.google.dev/gemini-api/docs'], ['Google Places features', 'https://developers.google.com/maps/documentation/places/web-service/overview']],
  },
  ai: {
    purpose: 'Give each app its own Local AI token, allowed services, daily limits and usage counts for the M1 gateway.',
    maker: 'GK gateway / Qwen / Tencent / Google / Anthropic',
    more: 'The original model providers offer additional coding, reasoning and content tools. Our gateway exposes only its configured routes; adding a provider feature needs a compatible model or API integration.',
    docs: [['Qwen models', 'https://github.com/QwenLM/Qwen3'], ['Tencent Hy-MT', 'https://huggingface.co/tencent/Hy-MT2-1.8B'], ['Claude API capabilities', 'https://platform.claude.com/docs/en/overview']],
  },
});

const number = (n) => (Number.isFinite(n) ? n : 0).toLocaleString('en-GB');
const at = (value) => {
  const d = new Date(value);
  return value && Number.isFinite(d.getTime()) ? ' on ' + d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};
function evidence(event, action) {
  return event ? 'Last recorded ' + action + (event.ok ? ' passed' : ' failed') + at(event.at) + '.' : 'No recorded ' + action + ' result yet.';
}
function workerEvidence(block, label) {
  if (!block?.worker) return label + ' has not reported a heartbeat to this Hub.';
  return 'Last ' + label + ' heartbeat' + at(block.worker.seenAt) + '. A heartbeat confirms contact; completed jobs are listed below.';
}

const SERVICE_PURPOSES = {
  chat: 'Chat, agent responses and summaries.', translate: 'Local language translation.',
  places: 'Place lookups.', desk_khmer: 'Khmer work on our own content.',
  desk_maps: 'Google Maps place details.', desk_images: 'Create or edit images.',
  embeddings: 'Text vectors for semantic search.', yai_routes: 'Yai PA and Big Brain routing.',
  claude: 'Paid reasoning where the app’s rules allow it.',
};

/** Pure view model. A token means configured access, never proof of traffic. */
export function serviceGuide(key, byId = {}, data = {}) {
  const info = SERVICE_GUIDES[key] || {
    purpose: 'This service’s purpose has not been documented yet.', maker: 'Not recorded',
    more: 'Provider capabilities have not been documented yet.', docs: [],
  };
  const result = { ...info, evidence: 'Current status is shown in the badge above.', usage: 'No usage evidence is available.', services: [] };
  if (['tiktok', 'facebook', 'google'].includes(key)) {
    const c = byId[key];
    result.evidence = !c?.set ? 'No credentials saved.' : !c.readable ? 'Saved credentials cannot be read; save them again.'
      : evidence(c.lastSend, c.lastSend?.kind === 'try' ? 'sign-in test' : 'sign-in');
    result.usage = '30+DA sign-in. ' + (c?.live ? 'The sign-in button is enabled. Provider approval or public app mode still applies.' : 'Production sign-in is not ready.')
      + ' This tower does not report sign-in traffic totals.';
  } else if (key === 'telegram-bot') {
    const bot = byId.telegram?.bot;
    result.evidence = evidence(bot?.lastTry, 'bot test');
    result.usage = bot?.offered ? 'Enabled for 30+DA phone verification. No phone-verification traffic count is shown here.'
      : 'Intended for 30+DA phone verification; the app is not currently offering this bot.';
    if (data.verification) result.usage += data.verification.ready
      ? ' IEWS has a server key and return page configured; completed user verification is not implied.'
      : ' IEWS shared verification still needs setup in this tower.';
  } else if (key === 'telegram-gateway' || key === 'whatsapp') {
    const c = byId[key === 'whatsapp' ? key : 'telegram'];
    result.evidence = !c?.set ? 'No credentials saved.' : !c.readable ? 'Saved credentials cannot be read.'
      : evidence(c.lastSend, c.lastSend?.kind === 'try' ? 'test-code delivery' : 'code delivery');
    result.usage = key === 'telegram-gateway' && byId.telegram?.bot?.offered
      ? '30+DA spare verification route. The free Telegram Bot is preferred while it works.'
      : c?.offered ? 'Enabled for 30+DA phone verification.' : 'Intended for 30+DA phone verification; not currently offered in the app.';
  } else if (['wechat', 'alipay', 'youtube'].includes(key)) {
    result.evidence = 'Placeholder only; no service connection has been implemented in this tower.';
    result.usage = 'No connected apps or recorded usage.';
  } else if (key === 'apple') {
    const c = byId.apple;
    result.evidence = evidence(c?.lastSend, 'Apple key check');
    result.usage = c?.signinWorks ? '30+DA iOS sign-in is wired. ' : '30+DA iOS sign-in is planned. ';
    result.usage += c?.live ? 'The revocation key passed its recorded check.'
      : c?.keyOk ? 'A revocation key is saved; successful verification is not confirmed.' : 'The revocation key still needs setup.';
  } else if (key === 'wan') {
    const w = data.wan;
    result.evidence = workerEvidence(w, 'M5');
    result.usage = (w?.tokens?.client?.set ? 'Yai Media Director has a client token. ' : 'Intended for Yai Media Director; no client token is set. ')
      + number(w?.queue?.pending) + ' queued, ' + number(w?.queue?.running) + ' rendering, ' + number(w?.queue?.clips) + ' clips currently kept.';
  } else if (key === 'places') {
    const p = data.places;
    result.evidence = number(p?.count) + ' places in the list' + at(p?.at) + '. ' + (p?.google?.set ? 'Google Places key saved; its own status is below.' : 'Google Places is not configured.');
    result.usage = '30+DA Level 3 “Meet” searches this list and OpenStreetMap. ' + (p?.google?.options?.enabled ? 'Google Places is also enabled.' : 'Google Places is off.');
  } else if (key === 'translate') {
    const t = data.translate;
    const backup = Boolean(t?.gemini?.set && t.gemini.options?.enabled);
    const local = Boolean(t?.host && t.options?.enabled);
    const last = [t?.stats?.lastOk ? { ok: true, at: t.stats.lastOk.at } : null,
      t?.stats?.lastError ? { ok: false, at: t.stats.lastError.at } : null, t?.lastTry]
      .filter(Boolean).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))[0];
    result.evidence = local ? evidence(last, 'M1 translation')
      : 'M1 translation is not configured or is off.';
    result.usage = '30+DA chats and written answers. ' + (local || backup ? 'A translation provider is enabled. ' : 'People currently see the original text. ')
      + number(t?.stats?.ok) + ' local translations succeeded since restart. Paid Gemini backup is ' + (backup ? 'enabled.' : 'not enabled.');
  } else if (key === 'desk') {
    const desk = data.desk;
    result.evidence = workerEvidence(desk, 'M1 Agent Desk');
    const configured = Object.values(desk?.tokens?.apps || {}).filter(app => app.set).map(app => app.name);
    result.usage = (configured.length ? 'Client tokens configured for ' + configured.join(', ') + '. ' : 'No client tokens configured. Intended for Yai Media Director, M1 apps and M2 apps. ')
      + number(desk?.queue?.pending) + ' queued, ' + number(desk?.queue?.running) + ' working. Private 30+DA user data is excluded.';
  } else if (key === 'ai') {
    const a = data.ai;
    result.evidence = a?.gateway ? 'Last M1 gateway heartbeat' + at(a.gateway.seenAt) + '.' : 'The M1 gateway has not reported a heartbeat to this Hub.';
    const configured = (a?.apps || []).filter(app => a.tokens?.apps?.[app.id]?.set).map(app => app.name);
    const active = (a?.apps || []).filter(app => app.today?.calls > 0).map(app => app.name + ' (' + number(app.today.calls) + ')');
    const weekCalls = (a?.apps || []).reduce((sum, app) => sum + (app.week?.calls || 0), 0);
    result.usage = (configured.length ? 'Client tokens configured: ' + configured.join(', ') + '. ' : 'No app client tokens are configured. ')
      + (active.length ? 'Recorded calls today: ' + active.join(', ') + '. ' : 'No recorded calls today. ')
      + number(weekCalls) + ' calls recorded in 7 days. Older direct connections are not measured here.';
    result.services = (a?.services || []).map(service => ({
      name: service.name, purpose: SERVICE_PURPOSES[service.id] || service.note || 'Purpose not recorded.',
      permitted: (a.apps || []).filter(app => app.enabled && app.allowed?.includes(service.id)).map(app => app.name),
      calls: number(service.today?.calls), enabled: service.enabled,
    }));
  }
  return result;
}
