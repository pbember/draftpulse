import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import { SCORE_MAX, WEIGHTS } from "./weights.js";

export type Category =
  | "hot_take"
  | "how_to"
  | "story"
  | "question"
  | "announcement"
  | "humor"
  | "other";

export type DimensionScores = {
  hook: number;
  specificity: number;
  reply_magnet: number;
  shareability: number;
  dwell_structure: number;
  anti_slop: number;
};

export type SuggestionType =
  | "hook"
  | "reply"
  | "structure"
  | "specificity"
  | "slop_fix";

export type SuggestionAction = "replace_hook" | "append" | "replace_all";

export type WritingSuggestion = {
  id: string;
  type: SuggestionType;
  title: string;
  explanation: string;
  suggestedText: string;
  action: SuggestionAction;
  actionLabel: string;
};

export type AnalyzeResult = {
  mode: "live" | "mock";
  category: Category;
  categoryConfidence: number;
  dimensions: DimensionScores;
  composite: number;
  tips: string[];
  suggestions: WritingSuggestion[];
  model?: string;
};

const QUESTIONS = {
  category: choice("Which X/Twitter post category best fits `draft.text`?", {
    hot_take: {
      what: "Strong opinion, contrarian claim, or stance",
      not_for: "Neutral how-to, personal story, or pure question",
    },
    how_to: {
      what: "Playbook, checklist, steps, or tactical advice",
      not_for: "Opinion without actionable steps",
    },
    story: {
      what: "Personal narrative, anecdote, or lived experience",
      not_for: "Generic advice with no personal specifics",
    },
    question: {
      what: "Primary goal is to solicit replies or discussion",
      not_for: "Rhetorical question buried in a take",
    },
    announcement: {
      what: "Launch, shipping update, hire, or product news",
      not_for: "Commentary on someone else's news",
    },
    humor: {
      what: "Joke, meme energy, or playful bit",
      not_for: "Serious advice framed lightly",
    },
    other: {
      what: "Does not fit the other categories",
      not_for: "Clear match to another label",
    },
  }),
  hook: score(
    "How strong is the opening hook of `draft.text` for stopping a scroll?",
    [
      "No hook; starts vague or buried",
      "Weak opener; reader can skip safely",
      "Decent opener; some curiosity",
      "Strong hook; clear tension or promise",
      "Excellent hook; hard to scroll past",
    ],
  ),
  specificity: score(
    "How specific and concrete is `draft.text` (numbers, names, scenes) vs vague claims?",
    [
      "Entirely vague or generic",
      "Mostly generic with a thin detail",
      "Some concrete details",
      "Mostly specific and grounded",
      "Highly specific; hard to confuse with AI filler",
    ],
  ),
  reply_magnet: score(
    "How likely is `draft.text` to earn replies (stance, question, incomplete thought others finish)?",
    [
      "No reply incentive",
      "Mild invitation",
      "Moderate reply pull",
      "Strong reply magnet",
      "Extremely reply-baiting in a good way",
    ],
  ),
  shareability: score(
    "How worth sharing via DM or repost is `draft.text` (useful, quotable, save-worthy)?",
    [
      "Not share-worthy",
      "Slightly useful to someone",
      "Moderately shareable",
      "Clearly worth sending to a friend",
      "Highly shareable artifact",
    ],
  ),
  dwell_structure: score(
    "How well is `draft.text` structured for dwell (line breaks, payoff, readable pacing)?",
    [
      "Wall of text or empty one-liner",
      "Weak structure",
      "Readable enough",
      "Good pacing and payoff",
      "Excellent structure for holding attention",
    ],
  ),
  slop_risk: noul(
    "Does `draft.text` read like AI slop, engagement bait, or spam that would earn mute/not-interested?",
    {
      true: {
        what: "Generic AI tells, bait, or spammy patterns",
        examples: ["As an AI…", "Comment YES if…", "Unbelievable trick…"],
      },
      false: {
        what: "Sounds human, specific, and non-spammy",
        examples: ["Concrete shipping note", "Personal failure with a lesson"],
      },
    },
  ),
};

function tipFrom(dimensions: DimensionScores, category: Category): string[] {
  const tips: string[] = [];
  const ranked = (
    Object.entries(dimensions) as [keyof DimensionScores, number][]
  )
    .filter(([k]) => k !== "anti_slop")
    .sort((a, b) => a[1] - b[1]);

  const weakest = ranked[0]?.[0];
  if (weakest === "hook" && dimensions.hook < 0.55) {
    tips.push("Lead with tension, a concrete claim, or an unexpected number.");
  }
  if (weakest === "specificity" && dimensions.specificity < 0.55) {
    tips.push("Swap abstractions for one named detail, number, or scene.");
  }
  if (weakest === "reply_magnet" && dimensions.reply_magnet < 0.55) {
    tips.push("End with a real question or a stance people will argue with.");
  }
  if (weakest === "shareability" && dimensions.shareability < 0.55) {
    tips.push("Make it sendable: a checklist, ratio, or playbook someone DMs.");
  }
  if (weakest === "dwell_structure" && dimensions.dwell_structure < 0.55) {
    tips.push("Break lines. Hook → tension → payoff. Kill the wall of text.");
  }
  if (dimensions.anti_slop < 0.5) {
    tips.push("Cut bait phrases and generic AI filler — negative ranking signals hurt.");
  }
  if (category === "announcement") {
    tips.push("Announcements need a human why, not only a ship log.");
  }
  if (tips.length === 0) {
    tips.push("Solid draft. Tighten the first line, then ship.");
  }
  return tips.slice(0, 3);
}

export function generateWritingSuggestions(
  text: string,
  dimensions: DimensionScores,
  category: Category,
): WritingSuggestion[] {
  const suggestions: WritingSuggestion[] = [];
  const t = text.trim();
  if (!t) return suggestions;

  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const firstLine = lines[0] || t;
  const cleanFirst = firstLine
    .replace(/^([#*\->\s\d.]+|stop|unpopular opinion:?|hot take:?)+/i, "")
    .replace(/[:.!?]+$/, "")
    .trim();

  // 1. Hook suggestions
  if (cleanFirst.length > 3) {
    const topic = cleanFirst.length > 50 ? cleanFirst.slice(0, 48) + "…" : cleanFirst;

    let contrarianHook = `Most people get ${topic.toLowerCase()} completely wrong.\n\nHere is the real breakdown:`;
    if (/^how to/i.test(cleanFirst)) {
      contrarianHook = `Stop trying to ${cleanFirst.replace(/^how to\s+/i, "").toLowerCase()} the hard way.\n\nHere is the actual playbook:`;
    } else if (/^(i|we)\s+/i.test(cleanFirst)) {
      contrarianHook = `90% of people fail at this. Here is what we discovered:`;
    }

    suggestions.push({
      id: "hook-contrarian",
      type: "hook",
      title: "Contrarian tension hook",
      explanation: "Subverts expectations in the first 2 seconds to immediately halt scrolling.",
      suggestedText: contrarianHook,
      action: "replace_hook",
      actionLabel: "⚡ Apply Contrarian Hook",
    });

    suggestions.push({
      id: "hook-curiosity",
      type: "hook",
      title: "Curiosity & stakes hook",
      explanation: "Creates an open loop and gives readers a compelling reason to read on.",
      suggestedText: `If you only remember one rule about ${topic.toLowerCase()}, make it this:`,
      action: "replace_hook",
      actionLabel: "⚡ Apply Curiosity Hook",
    });
  }

  // 2. Reply magnet suggestion (if reply pull is weak or draft lacks a question)
  const hasQuestion = /\?/.test(t);
  if (dimensions.reply_magnet < 0.75 || !hasQuestion) {
    let questionText = "What would you add to this? Drop your thoughts below 👇";
    if (category === "hot_take") {
      questionText = "Agree or disagree? How do you see this playing out?";
    } else if (category === "how_to") {
      questionText = "What's the #1 step or pitfall you'd add to this checklist?";
    } else if (category === "story") {
      questionText = "Have you experienced something similar? How did you handle it?";
    } else if (category === "announcement") {
      questionText = "What feature or detail would you love to see next?";
    }

    suggestions.push({
      id: "reply-question",
      type: "reply",
      title: "Closing discussion prompt",
      explanation: "Direct questions invite immediate replies, boosting algorithmic distribution.",
      suggestedText: questionText,
      action: "append",
      actionLabel: "➕ Add Closing Question",
    });
  }

  // 3. Structure & Dwell (if text is a dense single block or wall of text)
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (lines.length <= 2 && wordCount >= 18) {
    const sentences = t.match(/[^.!?]+[.!?]+(\s+|$)/g)?.map((s) => s.trim()) || [];
    if (sentences.length >= 3) {
      const formatted = [
        sentences[0],
        "",
        ...sentences.slice(1, -1).map((s) => `• ${s}`),
        "",
        sentences[sentences.length - 1],
      ].join("\n");

      suggestions.push({
        id: "structure-spaced",
        type: "structure",
        title: "Punchy spaced list",
        explanation: "Breaking walls of text into scannable lines increases dwell time and readability.",
        suggestedText: formatted,
        action: "replace_all",
        actionLabel: "✨ Format as Spaced List",
      });
    }
  }

  // 4. Concrete Proof / Specificity
  const hasNumbers = /\d/.test(t);
  if (dimensions.specificity < 0.65 || !hasNumbers) {
    suggestions.push({
      id: "spec-proof",
      type: "specificity",
      title: "Anchor with real metrics & proof",
      explanation: "Adding specific numbers or metrics makes claims 3x more credible and shareable.",
      suggestedText: "The exact numbers:\n• Before: [Metric]\n• After: [Metric]\n• Timeline: [Timeframe]",
      action: "append",
      actionLabel: "➕ Append Metric Framework",
    });
  }

  // 5. Anti-slop polish (if slop words found)
  const slopRegex = /\b(unbelievable|game changer|you won't believe|comment yes|as an ai|unlock the secret|thread 🧵)\b/gi;
  if (slopRegex.test(t)) {
    const cleaned = t.replace(slopRegex, (match) => {
      const lower = match.toLowerCase();
      if (lower.includes("game changer")) return "practical improvement";
      if (lower.includes("unbelievable")) return "notable";
      if (lower.includes("you won't believe")) return "take a look at";
      if (lower.includes("comment yes")) return "let me know";
      if (lower.includes("thread")) return "";
      return "";
    }).replace(/\s{2,}/g, " ");

    suggestions.push({
      id: "slop-clean",
      type: "slop_fix",
      title: "Remove engagement bait & AI filler",
      explanation: "Replacing buzzwords with direct human language avoids mute and not-interested penalties.",
      suggestedText: cleaned,
      action: "replace_all",
      actionLabel: "✨ Polish Hype Words",
    });
  }

  return suggestions.slice(0, 4);
}

export function compose(
  dims: DimensionScores,
  category: Category,
  categoryConfidence: number,
  draftText?: string,
): Pick<AnalyzeResult, "composite" | "tips" | "suggestions"> {
  const composite =
    WEIGHTS.hook * dims.hook +
    WEIGHTS.specificity * dims.specificity +
    WEIGHTS.reply_magnet * dims.reply_magnet +
    WEIGHTS.shareability * dims.shareability +
    WEIGHTS.dwell_structure * dims.dwell_structure +
    WEIGHTS.anti_slop * dims.anti_slop;

  return {
    composite: Math.round(composite * 1000) / 1000,
    tips: tipFrom(dims, category),
    suggestions: draftText ? generateWritingSuggestions(draftText, dims, category) : [],
  };
}

function normalizeScore(raw: number): number {
  return Math.min(1, Math.max(0, raw / SCORE_MAX));
}

export async function analyzeLive(
  text: string,
  signal?: AbortSignal,
): Promise<AnalyzeResult> {
  const client = new TypeSafeClient();
  const response = await client.systemOne(
    {
      state: {
        draft: {
          text,
          platform: "x",
          char_count: text.length,
        },
        ranking_notes: {
          prefer: ["replies", "shares", "dwell", "profile_clicks"],
          avoid: ["not_interested", "mute", "report", "ai_slop"],
        },
      },
      questions: QUESTIONS,
    },
    { signal },
  );

  const a = response.answers;
  const dimensions: DimensionScores = {
    hook: normalizeScore(a.hook.score),
    specificity: normalizeScore(a.specificity.score),
    reply_magnet: normalizeScore(a.reply_magnet.score),
    shareability: normalizeScore(a.shareability.score),
    dwell_structure: normalizeScore(a.dwell_structure.score),
    anti_slop: 1 - a.slop_risk.noul,
  };
  const category = a.category.choice as Category;
  const { composite, tips, suggestions } = compose(
    dimensions,
    category,
    a.category.confidence,
    text,
  );

  return {
    mode: "live",
    category,
    categoryConfidence: a.category.confidence,
    dimensions,
    composite,
    tips,
    suggestions,
    model: response.model,
  };
}

/** Deterministic heuristic when no API key — keeps the UX loop working. */
export function analyzeMock(text: string): AnalyzeResult {
  const t = text.trim();
  const lower = t.toLowerCase();
  const lines = t.split(/\n/).filter(Boolean);
  const hasNumber = /\d/.test(t);
  const hasQuestion = /\?/.test(t);
  const wordCount = t.split(/\s+/).filter(Boolean).length;

  const slopHits = [
    "unbelievable",
    "comment yes",
    "as an ai",
    "game changer",
    "you won't believe",
    "thread 🧵",
  ].filter((p) => lower.includes(p)).length;

  const dimensions: DimensionScores = {
    hook: clamp01(
      (t.length > 0 ? 0.35 : 0) +
        (lines[0] && lines[0].length < 90 ? 0.2 : 0) +
        (hasNumber ? 0.15 : 0) +
        (wordCount > 8 ? 0.1 : 0),
    ),
    specificity: clamp01(
      (hasNumber ? 0.35 : 0.1) +
        (/\b(i|we|my)\b/i.test(t) ? 0.2 : 0) +
        (wordCount > 20 ? 0.15 : 0) -
        slopHits * 0.15,
    ),
    reply_magnet: clamp01(
      (hasQuestion ? 0.45 : 0.15) +
        (/\b(wrong|disagree|unpopular|hot take)\b/i.test(t) ? 0.25 : 0) +
        (wordCount > 12 ? 0.1 : 0),
    ),
    shareability: clamp01(
      (/\b(checklist|playbook|template|steps|framework)\b/i.test(t)
        ? 0.4
        : 0.15) +
        (hasNumber ? 0.2 : 0) +
        (lines.length >= 3 ? 0.15 : 0),
    ),
    dwell_structure: clamp01(
      (lines.length >= 3 ? 0.4 : 0.15) +
        (wordCount > 25 && wordCount < 220 ? 0.25 : 0.05) +
        (lines.length >= 5 ? 0.15 : 0),
    ),
    anti_slop: clamp01(1 - slopHits * 0.28 - (wordCount < 4 ? 0.2 : 0)),
  };

  let category: Category = "other";
  if (/\b(shipped|launch|released|hiring)\b/i.test(t)) category = "announcement";
  else if (hasQuestion && wordCount < 40) category = "question";
  else if (/\b(how to|step|checklist|playbook)\b/i.test(t)) category = "how_to";
  else if (/\b(lol|lmao|joke)\b/i.test(t)) category = "humor";
  else if (/\b(i |my |we )\b/i.test(t) && wordCount > 30) category = "story";
  else if (/\b(wrong|unpopular|hot take|stop)\b/i.test(t)) category = "hot_take";

  const { composite, tips, suggestions } = compose(dimensions, category, 0.55, text);
  return {
    mode: "mock",
    category,
    categoryConfidence: 0.55,
    dimensions,
    composite,
    tips,
    suggestions,
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Math.round(n * 1000) / 1000));
}

export function hasApiKey(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}
