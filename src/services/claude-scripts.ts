import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/env.js";
import { fetchRows } from "./supabase.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT = `You are a UGC ad scriptwriter for BNB Success, an Australian short-term rental mentorship business.

Write scripts in first-person, conversational Australian English.

Include Fish Audio emotion tags inline. Available tags:
- [excited] — Energetic, upbeat delivery (hooks, results reveals)
- [serious] — Grounded, authoritative tone (problem statements, credibility)
- [warm] — Friendly, approachable (solution introduction, CTA)
- [whisper] — Intimate, conspiratorial (secrets, insider tips)
- [laugh] — Natural laughter inserted (relatability, casual feel)
- [confident] — Assertive, assured (proof, testimonials)
- [casual] — Relaxed, conversational (CTAs, sign-offs)
- [sigh] — Thoughtful pause (before/after contrasts)

Script Structure:
- Hook (0-3 seconds): Pattern interrupt, stop the scroll
- Problem (3-8 seconds): Relatable pain point the audience feels
- Pivot (8-12 seconds): Introduce the solution naturally
- Proof (12-22 seconds): Specific, tangible results
- CTA (22-30 seconds): Clear, direct ask

Target: 120-150 words per minute for natural delivery.
Keep scripts 80-120 words for 30-second ads, 40-60 words for 15-second ads.

Output each script as JSON with fields:
- hook_type: "skeptic" | "curiosity" | "result_first" | "challenge" | "storytime"
- script_tagged: Full script with emotion tags
- script_plain: Clean script without tags
- word_count: Number of words (without tags)
- est_duration: Estimated seconds at 140 wpm`;

interface ScriptVariation {
  hook_type: string;
  script_tagged: string;
  script_plain: string;
  word_count: number;
  est_duration: number;
}

interface GenerateScriptsOptions {
  angle: string;
  hookStyle?: string;
  targetDuration?: number; // seconds
  variations?: number;
  fewShotExamples?: string[];
}

/**
 * Generate ad script variations using Claude Opus.
 * Trained on historical winners via few-shot prompting.
 */
export async function generateScripts(
  options: GenerateScriptsOptions
): Promise<ScriptVariation[]> {
  const {
    angle,
    hookStyle = "mixed",
    targetDuration = 30,
    variations = 3,
    fewShotExamples,
  } = options;

  // Fetch top-performing scripts as few-shot examples if not provided
  let examples = fewShotExamples;
  if (!examples || examples.length === 0) {
    try {
      const topScripts = await fetchRows<{
        script_tagged: string;
        performance: { roas?: number };
      }>("prompt_library", { is_active: true }, { limit: 5, orderBy: "performance_score", ascending: false });

      examples = topScripts.map((s) => s.script_tagged);
    } catch {
      examples = [];
    }
  }

  const fewShotSection =
    examples.length > 0
      ? `\n\nReference these top-performing scripts for tone and structure:\n${examples.map((s, i) => `--- Example ${i + 1} ---\n${s}`).join("\n\n")}`
      : "";

  const userPrompt = `Generate ${variations} script variations for angle: "${angle}".
Hook style: ${hookStyle}.
Target: ${targetDuration} seconds.
${fewShotSection}

Return a JSON array of ${variations} script objects.`;

  const response = await client.messages.create({
    model: "claude-opus-4-6-20250219",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textContent = response.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Claude");
  }

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = textContent.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else {
    // Try to find raw JSON array
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }
  }

  let scripts: ScriptVariation[];
  try {
    scripts = JSON.parse(jsonStr);
  } catch (parseErr) {
    throw new Error(
      `Failed to parse Claude script output as JSON: ${parseErr}. Raw output: ${textContent.text.substring(0, 300)}`
    );
  }
  return scripts;
}

/**
 * Analyse competitor ads and generate weekly creative brief.
 */
export async function generateCreativeBrief(
  competitorInsights: string
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-opus-4-6-20250219",
    max_tokens: 3000,
    system: `You are a creative strategist for BNB Success, an Australian short-term rental mentorship business. Analyse competitor ad performance data and generate a weekly creative brief with:
1. Top 3-5 winning angles to test
2. Recommended hook styles for each angle
3. Emotional tones that performed best
4. CTAs that drove highest conversions
5. Specific script directions for the next batch`,
    messages: [
      {
        role: "user",
        content: `Here's this week's competitor intelligence and performance data:\n\n${competitorInsights}\n\nGenerate a creative brief for next week's ad production.`,
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Claude");
  }
  return textContent.text;
}

/**
 * Analyse top-performing scripts and extract patterns.
 */
export async function analyseWinners(
  scripts: Array<{
    script_tagged: string;
    performance: Record<string, unknown>;
  }>
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-opus-4-6-20250219",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `Analyse these top-performing ad scripts and extract common patterns (hooks, angles, CTAs, tones, structures):\n\n${JSON.stringify(scripts, null, 2)}`,
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Claude");
  }
  return textContent.text;
}
