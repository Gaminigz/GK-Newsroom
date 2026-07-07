/**
 * The major Ai players tracked by the Yai Ai feed — who they are, where
 * they originate, and the brand key the classifier tags stories with.
 * Clicking a player card on /ai-feed filters the feed to their stories.
 */

export type AiPlayer = {
  brand: string; // must match the classifier's BRANDS vocabulary
  name: string;
  flag: string;
  country: string;
  hq: string;
  blurb: string;
  /** Official channels — only URLs we're confident are canonical.
      TikTok/Facebook get added once verified; a wrong guess = dead link. */
  links?: {
    site?: string;
    pricing?: string;
    x?: string;
    facebook?: string;
    tiktok?: string;
    youtube?: string;
  };
};

export const AI_PLAYERS: AiPlayer[] = [
  {
    brand: "OpenAI",
    name: "OpenAI",
    flag: "🇺🇸",
    country: "USA",
    hq: "San Francisco",
    blurb: "Maker of ChatGPT and the GPT model family.",
    links: { site: "https://openai.com", pricing: "https://openai.com/api/pricing/", x: "https://x.com/OpenAI" },
  },
  {
    brand: "Anthropic",
    name: "Anthropic",
    flag: "🇺🇸",
    country: "USA",
    hq: "San Francisco",
    blurb: "Safety-focused lab behind the Claude models.",
    links: { site: "https://www.anthropic.com", pricing: "https://www.anthropic.com/pricing", x: "https://x.com/AnthropicAI" },
  },
  {
    brand: "Google",
    name: "Google · DeepMind",
    flag: "🇺🇸",
    country: "USA / UK",
    hq: "Mountain View · London",
    blurb: "Gemini models, DeepMind research, Vertex AI cloud.",
    links: { site: "https://deepmind.google", pricing: "https://ai.google.dev/pricing", x: "https://x.com/GoogleDeepMind" },
  },
  {
    brand: "Meta",
    name: "Meta AI",
    flag: "🇺🇸",
    country: "USA",
    hq: "Menlo Park",
    blurb: "Open-weight Llama models and consumer Ai.",
    links: { site: "https://ai.meta.com", x: "https://x.com/AIatMeta" },
  },
  {
    brand: "Microsoft",
    name: "Microsoft",
    flag: "🇺🇸",
    country: "USA",
    hq: "Redmond",
    blurb: "Copilot everywhere; OpenAI's biggest backer.",
    links: { site: "https://www.microsoft.com/ai", x: "https://x.com/Microsoft" },
  },
  {
    brand: "xAI",
    name: "xAI",
    flag: "🇺🇸",
    country: "USA",
    hq: "San Francisco",
    blurb: "Elon Musk's lab behind the Grok models.",
    links: { site: "https://x.ai", pricing: "https://x.ai/api", x: "https://x.com/xai" },
  },
  {
    brand: "Mistral",
    name: "Mistral AI",
    flag: "🇫🇷",
    country: "France",
    hq: "Paris",
    blurb: "Europe's open-model champion.",
    links: { site: "https://mistral.ai", pricing: "https://mistral.ai/pricing", x: "https://x.com/MistralAI" },
  },
  {
    brand: "Alibaba",
    name: "Alibaba · Qwen",
    flag: "🇨🇳",
    country: "China",
    hq: "Hangzhou",
    blurb: "Qwen open models and Alibaba Cloud Ai.",
    links: { site: "https://www.alibabacloud.com/en/solutions/generative-ai", x: "https://x.com/Alibaba_Qwen" },
  },
  {
    brand: "DeepSeek",
    name: "DeepSeek",
    flag: "🇨🇳",
    country: "China",
    hq: "Hangzhou",
    blurb: "Efficient frontier models at disruptive cost.",
    links: { site: "https://www.deepseek.com", pricing: "https://api-docs.deepseek.com/quick_start/pricing", x: "https://x.com/deepseek_ai" },
  },
  {
    brand: "ByteDance",
    name: "ByteDance",
    flag: "🇨🇳",
    country: "China",
    hq: "Beijing",
    blurb: "Doubao models and Ai-powered consumer apps.",
    links: { site: "https://www.bytedance.com" },
  },
  {
    brand: "Nvidia",
    name: "Nvidia",
    flag: "🇺🇸",
    country: "USA",
    hq: "Santa Clara",
    blurb: "The GPUs the whole Ai industry runs on.",
    links: { site: "https://www.nvidia.com/en-us/ai/", x: "https://x.com/nvidia", facebook: "https://www.facebook.com/NVIDIA" },
  },
];
