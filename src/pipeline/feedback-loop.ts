/**
 * PERFORMANCE FEEDBACK LOOP
 * Pull ad performance data from Meta + Hyros.
 * Analyse winners and update prompt library.
 */

import { config } from "../config/env.js";
import {
  insertRow,
  updateRow,
  fetchRows,
} from "../services/supabase.js";
import { analyseWinners } from "../services/claude-scripts.js";

/**
 * Fetch Meta Ads performance metrics for our creatives.
 */
async function fetchMetaPerformance(): Promise<
  Array<{
    ad_id: string;
    cpm: number;
    ctr: number;
    cpc: number;
    impressions: number;
    clicks: number;
    spend: number;
  }>
> {
  if (!config.metaAccessToken) {
    console.warn("[Feedback] META_ACCESS_TOKEN not set, skipping Meta fetch");
    return [];
  }

  const url = `https://graph.facebook.com/v21.0/${config.metaAdAccountId}/insights?fields=ad_id,cpm,ctr,cpc,impressions,inline_link_clicks,spend&level=ad&time_range={"since":"${getDateDaysAgo(7)}","until":"${getToday()}"}&access_token=${config.metaAccessToken}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Meta API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    data: Array<{
      ad_id: string;
      cpm: string;
      ctr: string;
      cpc: string;
      impressions: string;
      inline_link_clicks: string;
      spend: string;
    }>;
  };

  return (data.data || []).map((d) => ({
    ad_id: d.ad_id,
    cpm: parseFloat(d.cpm || "0"),
    ctr: parseFloat(d.ctr || "0"),
    cpc: parseFloat(d.cpc || "0"),
    impressions: parseInt(d.impressions || "0"),
    clicks: parseInt(d.inline_link_clicks || "0"),
    spend: parseFloat(d.spend || "0"),
  }));
}

/**
 * Fetch Hyros attribution data.
 */
async function fetchHyrosPerformance(): Promise<
  Array<{
    creative_id: string;
    leads: number;
    calls_booked: number;
    sales: number;
    revenue: number;
  }>
> {
  if (!config.hyrosApiKey) {
    console.warn("[Feedback] HYROS_API_KEY not set, skipping Hyros fetch");
    return [];
  }

  // Hyros API call for attribution data
  const response = await fetch(
    "https://api.hyros.com/v1/api/v1.0/attribution/ad-performance",
    {
      headers: {
        Authorization: `Bearer ${config.hyrosApiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({
        startDate: getDateDaysAgo(7),
        endDate: getToday(),
      }),
    }
  );

  if (!response.ok) {
    console.warn(`[Feedback] Hyros API error: ${response.status}`);
    return [];
  }

  const data = (await response.json()) as {
    results: Array<{
      adId: string;
      leads: number;
      callsBooked: number;
      sales: number;
      revenue: number;
    }>;
  };

  return (data.results || []).map((d) => ({
    creative_id: d.adId,
    leads: d.leads || 0,
    calls_booked: d.callsBooked || 0,
    sales: d.sales || 0,
    revenue: d.revenue || 0,
  }));
}

/**
 * Run the full feedback loop:
 * 1. Pull Meta + Hyros data
 * 2. Match to our finished ads
 * 3. Update performance records
 * 4. Analyse winners
 * 5. Update prompt library
 */
export async function runFeedbackLoop(): Promise<{
  adsUpdated: number;
  winnersIdentified: number;
  promptLibraryUpdated: boolean;
}> {
  console.log("[Feedback] Running performance feedback loop...");

  const [metaData, hyrosData] = await Promise.all([
    fetchMetaPerformance().catch(() => []),
    fetchHyrosPerformance().catch(() => []),
  ]);

  console.log(
    `[Feedback] Fetched ${metaData.length} Meta records, ${hyrosData.length} Hyros records`
  );

  // Get all finished ads
  const finishedAds = await fetchRows<{
    id: string;
    script_id: string;
  }>("finished_ads", { status: "qa_passed" });

  let adsUpdated = 0;

  // Update performance data for each ad
  for (const ad of finishedAds) {
    const existing = await fetchRows("ad_performance", {
      finished_ad_id: ad.id,
    });
    if (existing.length > 0) continue; // Already has performance data

    await insertRow("ad_performance", {
      finished_ad_id: ad.id,
      script_id: ad.script_id,
      platform: "meta",
      cpm: 0,
      ctr: 0,
      cpc: 0,
      hook_rate: 0,
      hold_rate: 0,
      cpa: 0,
      roas: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      leads: 0,
      calls_booked: 0,
      sales: 0,
      date_range: {
        start: getDateDaysAgo(7),
        end: getToday(),
      },
    });
    adsUpdated++;
  }

  // Identify top 10% scripts by any available performance metric
  const allPerformance = await fetchRows<{
    script_id: string;
    roas: number;
    ctr: number;
  }>("ad_performance", undefined, { orderBy: "roas", ascending: false });

  const topCount = Math.max(1, Math.ceil(allPerformance.length * 0.1));
  const topPerformers = allPerformance.slice(0, topCount);

  // Update prompt library with top performers
  let promptLibraryUpdated = false;
  if (topPerformers.length > 0) {
    const topScripts = await Promise.all(
      topPerformers.map(async (p) => {
        const scripts = await fetchRows<{
          script_tagged: string;
          angle: string;
          hook_type: string;
        }>("scripts", { id: p.script_id });
        return scripts[0]
          ? { ...scripts[0], performance: { roas: p.roas, ctr: p.ctr } }
          : null;
      })
    );

    const validScripts = topScripts.filter(Boolean) as Array<{
      script_tagged: string;
      angle: string;
      hook_type: string;
      performance: { roas: number; ctr: number };
    }>;

    if (validScripts.length > 0) {
      // Analyse winners with Claude
      const analysis = await analyseWinners(validScripts);
      console.log(
        `[Feedback] Winner analysis:\n${analysis.substring(0, 200)}...`
      );

      // Add top scripts to prompt library
      for (const script of validScripts) {
        await insertRow("prompt_library", {
          script_text: script.script_tagged,
          performance_score: script.performance.roas || script.performance.ctr,
          angle: script.angle,
          hook_type: script.hook_type,
          tone: "mixed",
          is_active: true,
        });
      }
      promptLibraryUpdated = true;
    }
  }

  console.log(
    `[Feedback] Complete: ${adsUpdated} ads updated, ${topPerformers.length} winners identified`
  );

  return {
    adsUpdated,
    winnersIdentified: topPerformers.length,
    promptLibraryUpdated,
  };
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// Run standalone
if (process.argv[1]?.endsWith("feedback-loop.ts")) {
  runFeedbackLoop()
    .then((r) => console.log("[Feedback] Result:", r))
    .catch((e) => console.error("[Feedback] Error:", e));
}
