/**
 * STAGE 1: IDEATION & COMPETITOR RESEARCH
 * Scrape TikTok Creative Center + Meta Ad Library for winning ads.
 * Analyse patterns and generate angle recommendations.
 */

import { insertRow, fetchRows } from "../services/supabase.js";
import { generateCreativeBrief } from "../services/claude-scripts.js";

interface CompetitorAd {
  source: "tiktok_cc" | "meta_adlib";
  advertiser: string;
  hook_text: string;
  structure: string;
  duration_secs: number;
  cta_type: string;
  engagement: {
    views: number;
    likes: number;
    shares: number;
    comments: number;
  };
  emotional_tone: string;
  actor_demo: string;
  transcript: string;
  tags: string[];
}

interface IdeationResult {
  adsScraped: number;
  briefGenerated: boolean;
  briefId?: string;
}

/**
 * Run the full ideation stage:
 * 1. Scrape competitor ads (via Playwright — requires OpenClaw)
 * 2. Store in Supabase
 * 3. Analyse patterns with Claude
 * 4. Generate creative brief
 */
export async function runIdeation(): Promise<IdeationResult> {
  console.log("[Stage 1] Starting ideation & competitor research...");

  // Step 1: Scrape competitor ads
  // NOTE: Playwright scraping runs via OpenClaw MCP server.
  // For now, we check for existing scraped data or accept manual input.
  const existingAds = await fetchRows<CompetitorAd & { id: string }>(
    "competitor_ads",
    undefined,
    { limit: 50, orderBy: "scraped_at", ascending: false }
  );

  console.log(
    `[Stage 1] Found ${existingAds.length} competitor ads in database`
  );

  // Step 2: Analyse patterns and generate brief
  if (existingAds.length === 0) {
    console.log(
      "[Stage 1] No competitor ads found. Seed the competitor_ads table via Playwright scraping or manual entry."
    );
    return { adsScraped: 0, briefGenerated: false };
  }

  // Prepare insights summary for Claude analysis
  const insights = summariseCompetitorData(existingAds);

  // Step 3: Generate creative brief
  console.log("[Stage 1] Generating creative brief with Claude...");
  const briefText = await generateCreativeBrief(insights);

  // Extract angles and hooks from the brief
  const brief = await insertRow("creative_briefs", {
    brief_text: briefText,
    angles: extractAngles(briefText),
    hooks: extractHooks(briefText),
    recommended_tones: extractTones(briefText),
    week_of: getNextMonday(),
    status: "active",
  });

  console.log(`[Stage 1] Creative brief generated: ${brief.id}`);

  return {
    adsScraped: existingAds.length,
    briefGenerated: true,
    briefId: brief.id,
  };
}

/**
 * Summarise competitor ad data for Claude analysis.
 */
function summariseCompetitorData(
  ads: Array<CompetitorAd & { id: string }>
): string {
  const byStructure: Record<string, number> = {};
  const byTone: Record<string, number> = {};
  const topHooks: string[] = [];

  for (const ad of ads) {
    byStructure[ad.structure] = (byStructure[ad.structure] || 0) + 1;
    byTone[ad.emotional_tone] = (byTone[ad.emotional_tone] || 0) + 1;
    if (ad.engagement.views > 10000) {
      topHooks.push(ad.hook_text);
    }
  }

  return `
Competitor Analysis Summary (${ads.length} ads analysed):

Structure Distribution:
${Object.entries(byStructure)
  .map(([k, v]) => `- ${k}: ${v} ads`)
  .join("\n")}

Emotional Tone Distribution:
${Object.entries(byTone)
  .map(([k, v]) => `- ${k}: ${v} ads`)
  .join("\n")}

Top Hooks (>10K views):
${topHooks.map((h) => `- "${h}"`).join("\n")}

Raw Data Sample (top 10 by views):
${JSON.stringify(
  ads
    .sort((a, b) => b.engagement.views - a.engagement.views)
    .slice(0, 10)
    .map((a) => ({
      hook: a.hook_text,
      structure: a.structure,
      tone: a.emotional_tone,
      views: a.engagement.views,
      cta: a.cta_type,
    })),
  null,
  2
)}
  `.trim();
}

function extractAngles(briefText: string): string[] {
  const angles: string[] = [];
  const lines = briefText.split("\n");
  for (const line of lines) {
    if (
      line.match(/angle|approach|direction/i) &&
      line.match(/^\s*[-*\d]/)
    ) {
      angles.push(line.replace(/^\s*[-*\d.]+\s*/, "").trim());
    }
  }
  return angles.length > 0
    ? angles
    : ["financial freedom through Airbnb", "side income without property ownership", "mentorship success story"];
}

function extractHooks(briefText: string): string[] {
  const hooks: string[] = [];
  const lines = briefText.split("\n");
  for (const line of lines) {
    if (line.match(/hook/i) && line.match(/^\s*[-*\d]/)) {
      hooks.push(line.replace(/^\s*[-*\d.]+\s*/, "").trim());
    }
  }
  return hooks.length > 0
    ? hooks
    : ["skeptic-turned-believer", "result-first reveal", "curiosity gap"];
}

function extractTones(briefText: string): string[] {
  const tones = ["excited", "serious", "warm", "confident", "casual"];
  const mentioned = tones.filter((t) =>
    briefText.toLowerCase().includes(t)
  );
  return mentioned.length > 0 ? mentioned : ["excited", "warm", "confident"];
}

function getNextMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const nextMon = new Date(now);
  nextMon.setDate(now.getDate() + diff);
  return nextMon.toISOString().split("T")[0];
}

// Run standalone
if (process.argv[1]?.endsWith("stage1-ideation.ts")) {
  runIdeation()
    .then((r) => console.log("[Stage 1] Result:", r))
    .catch((e) => console.error("[Stage 1] Error:", e));
}
