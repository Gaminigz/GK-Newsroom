/**
 * Timeline entries for the major Ai model families. Each row becomes a
 * feed item (via scripts/seed-history-and-timelines.mjs) that summarises
 * one milestone release plus its best-fit use case.
 *
 * Dates are approximate to the month; if a specific version dropped later,
 * the summary should still hold for what that generation was optimised
 * for. Rewritten Yai-voice articles get an "ai-timeline:<brand>" series
 * tag.
 */

export type ModelRelease = {
  version: string;
  released: string; // "YYYY-MM"
  headline: string;
  bestFor: string;
};

export type ModelTimeline = {
  brand: string; // must match the classifier vocab in lib/ai-feed-rewrite.ts
  displayName: string;
  origin: string;
  releases: ModelRelease[];
};

export const MODEL_TIMELINES: ModelTimeline[] = [
  {
    brand: "OpenAI",
    displayName: "OpenAI — the GPT family",
    origin: "USA",
    releases: [
      { version: "GPT-1",   released: "2018-06", headline: "Unsupervised pre-training + task-specific fine-tuning proves out on NLP tasks.",
        bestFor: "Research foundation — not for production; showed transformers scale." },
      { version: "GPT-2",   released: "2019-02", headline: "1.5B parameters, coherent long-form text; OpenAI briefly withheld the weights.",
        bestFor: "Long-form generation demos and the first serious 'is this dangerous?' debates." },
      { version: "GPT-3",   released: "2020-06", headline: "175B parameters; few-shot learning shocks the field.",
        bestFor: "Prompt-engineering-driven products; the era of 'just ask nicely'." },
      { version: "GPT-3.5", released: "2022-11", headline: "Powers the original ChatGPT free tier — fast, cheap, conversational.",
        bestFor: "Chat assistants, drafts, summaries where cost matters more than depth." },
      { version: "GPT-4",   released: "2023-03", headline: "First reliably 'smart' GPT — better reasoning, longer context, plus vision.",
        bestFor: "Serious knowledge work: analysis, coding, structured extraction." },
      { version: "GPT-4o",  released: "2024-05", headline: "Native multimodal (text, vision, audio) with real-time voice.",
        bestFor: "Voice interfaces, live translation, mixed-media assistants." },
      { version: "o1 (reasoning)", released: "2024-09", headline: "Chain-of-thought at the model level; trades latency for correctness.",
        bestFor: "Math, hard coding, formal reasoning — anywhere you can wait for the answer." },
      { version: "GPT-5",   released: "2025-08", headline: "OpenAI's frontier tier; higher reliability plus stronger tool use.",
        bestFor: "Agentic workflows, long tool chains, high-stakes decision support." },
    ],
  },
  {
    brand: "Anthropic",
    displayName: "Anthropic — the Claude family",
    origin: "USA",
    releases: [
      { version: "Claude 1",   released: "2023-03", headline: "Anthropic's first public model — long context, strong helpfulness training.",
        bestFor: "Long-document summarisation and safe assistants." },
      { version: "Claude 2",   released: "2023-07", headline: "100K-token context and stronger coding; the enterprise breakout.",
        bestFor: "Legal, research, and analyst workflows with long documents." },
      { version: "Claude 2.1", released: "2023-11", headline: "200K-token context; the first model that ate whole codebases in one shot.",
        bestFor: "Whole-repo code review, long-document Q&A." },
      { version: "Claude 3 (Haiku · Sonnet · Opus)", released: "2024-03",
        headline: "Three tiers: Haiku fast/cheap, Sonnet balanced, Opus for hardest tasks.",
        bestFor: "Pick your point on the cost/quality curve." },
      { version: "Claude 3.5 Sonnet", released: "2024-06",
        headline: "Beat Claude 3 Opus on coding at Sonnet cost; the workhorse era.",
        bestFor: "Production coding assistants and agent backbones." },
      { version: "Claude 3.7 Sonnet", released: "2025-02",
        headline: "Extended thinking mode; toggleable deliberation for hard problems.",
        bestFor: "Adaptive workloads — quick for easy tasks, deep for hard ones." },
      { version: "Claude 4 (Opus 4 · Sonnet 4)", released: "2025-05",
        headline: "Major coding jump, longer autonomous tool use, better agent behaviour.",
        bestFor: "Multi-hour agent runs, complex codebases." },
      { version: "Claude 4.5 (Sonnet · Haiku)", released: "2025-09",
        headline: "Sonnet 4.5 refines coding; Haiku 4.5 gets close to Sonnet 4 quality.",
        bestFor: "High-volume production where you want Sonnet-4 smarts at Haiku cost." },
      { version: "Claude Opus 4.7", released: "2026-04",
        headline: "Sharper reasoning and steering; strong default for hard analytical work.",
        bestFor: "Deep research, code architecture, high-quality writing." },
      { version: "Claude Opus 4.8", released: "2026-06",
        headline: "Latest Opus tier; further improvements to reliability and tool use.",
        bestFor: "Frontier reasoning, long agentic runs, judgement-heavy tasks." },
      { version: "Claude 5 (Fable · Sonnet)", released: "2026-06",
        headline: "New family alongside Opus 4.7/4.8; Fable optimised for narrative and voice.",
        bestFor: "Creative writing, dialogue, and this podcast." },
    ],
  },
  {
    brand: "Google",
    displayName: "Google · DeepMind — Gemini",
    origin: "USA / UK",
    releases: [
      { version: "Bard", released: "2023-02", headline: "Google's first ChatGPT response, initially built on LaMDA/PaLM.",
        bestFor: "History books — quickly superseded by Gemini." },
      { version: "Gemini 1.0", released: "2023-12", headline: "Google's native multimodal frontier; Ultra, Pro, Nano tiers.",
        bestFor: "Multimodal reasoning inside the Google ecosystem." },
      { version: "Gemini 1.5 Pro", released: "2024-02", headline: "1M-token context — the long-context breakthrough.",
        bestFor: "Feeding entire books, video hours, or codebases in one prompt." },
      { version: "Gemini 1.5 Flash", released: "2024-05", headline: "Cheap, fast tier of the 1.5 family for high-volume workloads.",
        bestFor: "Real-time apps, feed rewrites, batch classification." },
      { version: "Gemini 2.0", released: "2024-12", headline: "Native agentic tool use and stronger multi-step reasoning.",
        bestFor: "Agentic browser tasks and Workspace copilots." },
      { version: "Gemini 2.5 (Flash · Pro)", released: "2025-06",
        headline: "Thinking modes and improved coding; strong price/performance.",
        bestFor: "Production LLM backends, translation, batch content pipelines." },
    ],
  },
  {
    brand: "Meta",
    displayName: "Meta — Llama (open weights)",
    origin: "USA",
    releases: [
      { version: "LLaMA 1", released: "2023-02", headline: "Meta's first Llama — 'leaked' onto the open internet, changed everything.",
        bestFor: "Kicked off the open-weights ecosystem." },
      { version: "Llama 2", released: "2023-07", headline: "First openly licensed model competitive with GPT-3.5.",
        bestFor: "Self-hosted assistants and privacy-sensitive deployments." },
      { version: "Llama 3", released: "2024-04", headline: "8B and 70B tiers; approaches GPT-4 quality at self-hosted cost.",
        bestFor: "On-prem enterprise LLMs and fine-tuning bases." },
      { version: "Llama 3.1 (405B)", released: "2024-07", headline: "First truly frontier-class open-weights model.",
        bestFor: "Serious open-weight research and regulated industries." },
      { version: "Llama 4", released: "2025-04", headline: "Native multimodal and long context, still open weights.",
        bestFor: "Multimodal apps you must own end-to-end." },
    ],
  },
  {
    brand: "xAI",
    displayName: "xAI — Grok",
    origin: "USA",
    releases: [
      { version: "Grok 1",   released: "2023-11", headline: "Elon Musk's first release; snarky persona, integrated with X.",
        bestFor: "X-native content and personality-driven chat." },
      { version: "Grok 2",   released: "2024-08", headline: "Bigger jump in reasoning; image generation via Flux.",
        bestFor: "Multimodal X integrations." },
      { version: "Grok 3",   released: "2025-02", headline: "Trained on the Colossus cluster; competitive on reasoning benchmarks.",
        bestFor: "Reasoning tasks; still tightly tied to the X ecosystem." },
      { version: "Grok 4",   released: "2025-08", headline: "Latest tier; positioned as a general-purpose frontier competitor.",
        bestFor: "Grok API workloads and X-embedded products." },
    ],
  },
  {
    brand: "Mistral",
    displayName: "Mistral AI — Europe's open champion",
    origin: "France",
    releases: [
      { version: "Mistral 7B", released: "2023-09", headline: "Open-weights 7B model that punched above its size.",
        bestFor: "Edge, laptop, and cost-constrained inference." },
      { version: "Mixtral 8x7B", released: "2023-12", headline: "Mixture-of-experts open weights; strong quality for the price.",
        bestFor: "Self-hosted assistants that need GPT-3.5-class quality." },
      { version: "Mistral Large", released: "2024-02", headline: "Closed frontier tier; European sovereignty pitch.",
        bestFor: "EU-based enterprises with data-residency needs." },
      { version: "Codestral", released: "2024-05", headline: "Code-specialised model for autocomplete and refactor.",
        bestFor: "IDE assistants and self-hosted coding copilots." },
      { version: "Mistral Large 2 / Nemo", released: "2024-07",
        headline: "Updated frontier tier plus a compact multilingual model.",
        bestFor: "Multilingual production LLMs on European infra." },
    ],
  },
  {
    brand: "DeepSeek",
    displayName: "DeepSeek — efficient frontier from China",
    origin: "China",
    releases: [
      { version: "DeepSeek-V2", released: "2024-05", headline: "MoE architecture with striking cost efficiency.",
        bestFor: "High-volume inference where cost dominates." },
      { version: "DeepSeek-V3", released: "2024-12", headline: "Frontier-class quality trained at a fraction of Western costs.",
        bestFor: "Cost-sensitive assistants; a reference for efficient training." },
      { version: "DeepSeek-R1", released: "2025-01", headline: "Open-weights reasoning model that rattled Silicon Valley.",
        bestFor: "Math, code, and reasoning tasks with self-hosted control." },
    ],
  },
  {
    brand: "Alibaba",
    displayName: "Alibaba — Qwen family",
    origin: "China",
    releases: [
      { version: "Qwen 1", released: "2023-08", headline: "Alibaba's first open-weights Qwen models.",
        bestFor: "Chinese-language assistants and Alibaba Cloud deployments." },
      { version: "Qwen 1.5", released: "2024-02", headline: "Multi-tier lineup from 0.5B to 72B, all open weights.",
        bestFor: "Multilingual production LLMs, especially APAC." },
      { version: "Qwen 2", released: "2024-06", headline: "Substantial quality jump; competitive with Llama 3 tier.",
        bestFor: "Fine-tuning bases for enterprise Chinese/English apps." },
      { version: "Qwen 2.5 (+ Coder, Math)", released: "2024-09",
        headline: "Family expansion with specialist coding and math variants.",
        bestFor: "Coding copilots, math tutors, structured extraction." },
      { version: "Qwen 3", released: "2025-04", headline: "Frontier tier with strong multilingual coverage.",
        bestFor: "Any deployment where Chinese-language quality matters." },
    ],
  },
];
