/**
 * The Yai Ai History series — 12 curated episodes covering the arc of Ai
 * from Turing to today. Each seed is expanded into a full Yai-voice article
 * by scripts/seed-history-and-timelines.mjs and upserted into Mongo, where
 * it rotates into /ai-feed and the daily podcast alongside live news.
 *
 * The `year` field drives publishedAt (fake timestamps spread across the
 * last 12 days so they interleave with fresh news without dominating).
 */

export type HistoryEpisode = {
  id: string;
  ep: number;
  year: string;
  title: string;
  subtitle: string;
  keyFigures: string[];
  keyEvents: string[];
  whyItMatters: string;
};

export const HISTORY_EPISODES: HistoryEpisode[] = [
  {
    id: "ai-history-01-turing",
    ep: 1,
    year: "1950",
    title: "Alan Turing asks: can a machine think?",
    subtitle: "The Imitation Game and the birth of the AI question",
    keyFigures: ["Alan Turing"],
    keyEvents: [
      "1950 paper 'Computing Machinery and Intelligence'",
      "Proposes the Imitation Game (later called the Turing Test)",
      "Argues thought is defined by behaviour, not substrate",
    ],
    whyItMatters:
      "Framed the entire field before it had a name. Every argument about whether an AI is 'really' intelligent still borrows Turing's framing.",
  },
  {
    id: "ai-history-02-dartmouth",
    ep: 2,
    year: "1956",
    title: "Dartmouth College coins the term Artificial Intelligence",
    subtitle: "A summer workshop that named a field",
    keyFigures: ["John McCarthy", "Marvin Minsky", "Claude Shannon", "Nathaniel Rochester"],
    keyEvents: [
      "8-week summer research workshop at Dartmouth",
      "McCarthy coins 'Artificial Intelligence' in the proposal",
      "Attendees confidently expect major progress in a generation",
    ],
    whyItMatters:
      "Named the discipline and set an early tone of over-optimism that fed the first AI winter twenty years later.",
  },
  {
    id: "ai-history-03-perceptron",
    ep: 3,
    year: "1958",
    title: "The Perceptron: the first learning machine",
    subtitle: "Rosenblatt's neural network and Minsky's rebuttal",
    keyFigures: ["Frank Rosenblatt", "Marvin Minsky", "Seymour Papert"],
    keyEvents: [
      "1958: Rosenblatt builds the Mark I Perceptron — a hardware neural net",
      "1969: Minsky & Papert's 'Perceptrons' shows single-layer limits",
      "Funding for neural approaches largely dries up for 15 years",
    ],
    whyItMatters:
      "Neural nets were the future — twice. This first crash is why so much of Ai's history is stop-start rather than steady.",
  },
  {
    id: "ai-history-04-expert-systems",
    ep: 4,
    year: "1970s–80s",
    title: "Expert systems: the age of hand-written rules",
    subtitle: "DENDRAL, MYCIN, and the promise of symbolic Ai",
    keyFigures: ["Edward Feigenbaum", "Ted Shortliffe"],
    keyEvents: [
      "DENDRAL (1965–) infers molecular structure from mass spec data",
      "MYCIN (1972–) diagnoses bacterial infections better than junior doctors",
      "Corporate boom in expert-system tooling in the mid-80s",
    ],
    whyItMatters:
      "Ai's first commercial wave. It worked — narrowly. The failure to generalise beyond hand-crafted rules triggered the second AI winter.",
  },
  {
    id: "ai-history-05-winter",
    ep: 5,
    year: "Late 1980s–90s",
    title: "The AI winters: when the money stopped",
    subtitle: "Two funding collapses that reshaped the field",
    keyFigures: ["DARPA", "The Alvey Programme"],
    keyEvents: [
      "First winter (mid-70s) after ALPAC report and Lighthill critique",
      "Second winter (late 80s–90s) as expert-system market collapses",
      "'Artificial intelligence' becomes a career-limiting label",
    ],
    whyItMatters:
      "Shaped how researchers frame ambition. Even today, calling a real product 'AGI' is a signal you weren't around for the winters.",
  },
  {
    id: "ai-history-06-statistical",
    ep: 6,
    year: "1990s–2000s",
    title: "The statistical turn: machine learning eats symbolic Ai",
    subtitle: "Support vector machines, ensembles, and Google's rise",
    keyFigures: ["Vladimir Vapnik", "Leo Breiman", "Judea Pearl"],
    keyEvents: [
      "SVMs, random forests and boosting dominate practical Ai",
      "1997: Deep Blue beats Kasparov — mostly search, not learning",
      "Web search and spam filtering become the field's cash cows",
    ],
    whyItMatters:
      "The pragmatic middle era. Techniques from this decade still power a huge share of production Ai — and a huge share of Kaggle podiums.",
  },
  {
    id: "ai-history-07-deep-learning",
    ep: 7,
    year: "2012",
    title: "AlexNet wins ImageNet — deep learning arrives",
    subtitle: "GPUs, big data, and the neural net revenge tour",
    keyFigures: ["Geoffrey Hinton", "Alex Krizhevsky", "Ilya Sutskever", "Fei-Fei Li"],
    keyEvents: [
      "2009: Fei-Fei Li publishes the ImageNet dataset",
      "2012: AlexNet halves the ImageNet error rate using two GPUs",
      "Google, Facebook and Baidu buy or hire the pioneers within 18 months",
    ],
    whyItMatters:
      "The single most repeated inflection point in modern Ai. Every trillion-dollar Ai valuation traces back to this weekend.",
  },
  {
    id: "ai-history-08-transformer",
    ep: 8,
    year: "2017",
    title: "'Attention Is All You Need' — the Transformer paper",
    subtitle: "Google Brain publishes the architecture behind every modern LLM",
    keyFigures: ["Ashish Vaswani", "Noam Shazeer", "Jakob Uszkoreit", "Aidan Gomez"],
    keyEvents: [
      "June 2017: Vaswani et al. publish the Transformer paper",
      "Rapidly replaces RNNs for translation, then language modelling",
      "Every frontier model from GPT-2 onward is a descendant",
    ],
    whyItMatters:
      "If you only remember one paper in Ai history, remember this one. It is the closest thing the field has to a moon-landing moment.",
  },
  {
    id: "ai-history-09-gpt-era",
    ep: 9,
    year: "2018–2020",
    title: "The GPT era begins",
    subtitle: "Scaling laws and the surprise of general capability",
    keyFigures: ["Alec Radford", "Ilya Sutskever", "Sam Altman", "Dario Amodei"],
    keyEvents: [
      "2018: GPT-1 (117M params) shows unsupervised pre-training works",
      "2019: GPT-2 (1.5B) — OpenAI briefly withholds the weights",
      "2020: GPT-3 (175B) — few-shot learning shocks the research community",
    ],
    whyItMatters:
      "Established scaling laws as the field's dominant paradigm. Every 'we made it 10x bigger and it got smarter' story starts here.",
  },
  {
    id: "ai-history-10-chatgpt",
    ep: 10,
    year: "2022",
    title: "ChatGPT: Ai's iPhone moment",
    subtitle: "One free chat interface, one hundred million users",
    keyFigures: ["OpenAI", "Sam Altman"],
    keyEvents: [
      "30 November 2022: ChatGPT launches as a 'research preview'",
      "Fastest-growing consumer product in history to 100M users",
      "Microsoft's $10B investment reshapes the industry",
    ],
    whyItMatters:
      "The moment Ai stopped being a research beat and became a boardroom line item. The Yai Ai feed exists because of this moment.",
  },
  {
    id: "ai-history-11-agents-multimodal",
    ep: 11,
    year: "2023–2025",
    title: "Multi-modal, agentic, and open — Ai gets loud",
    subtitle: "Vision, tools, and open weights arrive at once",
    keyFigures: ["Anthropic", "Google DeepMind", "Meta", "Mistral", "xAI"],
    keyEvents: [
      "GPT-4 with vision (2023) and Gemini 1.5's long context (2024)",
      "Anthropic's Claude introduces tool use, then computer use",
      "Meta's Llama, Mistral, and DeepSeek keep open weights on the frontier",
    ],
    whyItMatters:
      "The years Ai became something you deploy, not just something you chat with. Agents make the factory-floor use cases realistic.",
  },
  {
    id: "ai-history-12-frontier-today",
    ep: 12,
    year: "2026",
    title: "The frontier today: Claude 5, GPT-5, Gemini 2.5",
    subtitle: "Where the industry stands as Yai launches",
    keyFigures: ["Anthropic", "OpenAI", "Google DeepMind"],
    keyEvents: [
      "Anthropic ships the Claude 5 family (Fable, Haiku 4.5, Sonnet, Opus 4.7/4.8)",
      "OpenAI's GPT-5 tier and Gemini 2.5 land in production",
      "Ai coding assistants become a default part of engineering workflows",
    ],
    whyItMatters:
      "The state of the art you're building on today. Every model in your Ai stack has a lineage you can now name.",
  },
];
