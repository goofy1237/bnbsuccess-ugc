/**
 * STAGE 5: B-ROLL & VISUAL GENERATION
 * Supporting footage: property shots, dashboards, lifestyle.
 * Runs in parallel with Stage 4 (lip sync).
 */

import { generateBRoll, generateBRollSet } from "../services/seedance.js";
import {
  insertRow,
  fetchRows,
  uploadFile,
} from "../services/supabase.js";
import { notifyPipelineError } from "../services/slack.js";
import { readFile } from "fs/promises";

type BRollType =
  | "property_interior"
  | "booking_dashboard"
  | "income_screenshot"
  | "lifestyle"
  | "before_after"
  | "app_demo";

interface BRollGenResult {
  brollAssetsGenerated: number;
  brollAssetIds: string[];
  errors: string[];
}

/**
 * Default B-roll set for a standard testimonial ad.
 */
const DEFAULT_BROLL_SET: Array<{
  type: BRollType;
  prompt: string;
  durationSecs: number;
}> = [
  {
    type: "property_interior",
    prompt:
      "Beautiful modern Airbnb apartment interior, bright natural light, stylish furniture, welcoming guest space",
    durationSecs: 5,
  },
  {
    type: "lifestyle",
    prompt:
      "Young Australian woman checking her phone at a cafe, smiling at a notification, passive income lifestyle",
    durationSecs: 5,
  },
];

/**
 * Generate B-roll for scripts that are being processed (voice_generated or face_generated).
 */
export async function runBRollGeneration(): Promise<BRollGenResult> {
  console.log("[Stage 5] Starting B-roll generation...");

  // Find scripts in pipeline that need B-roll
  const scriptsNeedingBroll: Array<{
    id: string;
    angle: string;
    script_plain: string;
  }> = [];

  for (const status of ["voice_generated", "face_generated"]) {
    const scripts = await fetchRows<{
      id: string;
      angle: string;
      script_plain: string;
    }>("scripts", { status });
    scriptsNeedingBroll.push(...scripts);
  }

  if (scriptsNeedingBroll.length === 0) {
    console.log("[Stage 5] No scripts need B-roll");
    return { brollAssetsGenerated: 0, brollAssetIds: [], errors: [] };
  }

  // Check which already have B-roll
  const brollAssetIds: string[] = [];
  const errors: string[] = [];

  for (const script of scriptsNeedingBroll) {
    const existingBroll = await fetchRows("broll_assets", {
      script_id: script.id,
    });
    if (existingBroll.length > 0) {
      console.log(
        `[Stage 5] Script ${script.id} already has ${existingBroll.length} B-roll clips`
      );
      continue;
    }

    console.log(
      `[Stage 5] Generating B-roll for script ${script.id}: "${script.angle}"`
    );

    // Determine B-roll needs based on script content
    const brollRequests = determineBRollNeeds(script.script_plain);

    try {
      const results = await generateBRollSet(brollRequests);

      for (let idx = 0; idx < results.length; idx++) {
        const result = results[idx];
        const videoBuffer = await readFile(result.filePath);
        const storagePath = `broll/${script.id}_${result.provider}_${Date.now()}.mp4`;
        const fileUrl = await uploadFile(
          "ugc-assets",
          storagePath,
          videoBuffer,
          "video/mp4"
        );

        const brollType = brollRequests[idx]?.type || "lifestyle";
        const brollPrompt = brollRequests[idx]?.prompt || "";

        const asset = await insertRow("broll_assets", {
          script_id: script.id,
          broll_type: brollType,
          prompt: brollPrompt,
          provider: result.provider,
          file_url: fileUrl,
          file_path: result.filePath,
          duration_secs: result.durationSecs,
          status: "complete",
        });

        brollAssetIds.push(asset.id);
      }

      console.log(
        `[Stage 5] Generated ${results.length} B-roll clips for script ${script.id}`
      );
    } catch (err) {
      const errMsg = `Script ${script.id}: ${err}`;
      console.error(`[Stage 5] ${errMsg}`);
      errors.push(errMsg);
      await notifyPipelineError("B-Roll Generation", errMsg, script.id);
    }
  }

  console.log(
    `[Stage 5] Complete: ${brollAssetIds.length} B-roll clips, ${errors.length} errors`
  );

  return {
    brollAssetsGenerated: brollAssetIds.length,
    brollAssetIds,
    errors,
  };
}

/**
 * Analyse script text to determine which B-roll clips to generate.
 */
function determineBRollNeeds(
  scriptText: string
): Array<{ type: BRollType; prompt: string; durationSecs: number }> {
  const needs: Array<{
    type: BRollType;
    prompt: string;
    durationSecs: number;
  }> = [];
  const text = scriptText.toLowerCase();

  if (
    text.includes("listing") ||
    text.includes("property") ||
    text.includes("airbnb")
  ) {
    needs.push({
      type: "property_interior",
      prompt:
        "Stunning Airbnb listing interior walkthrough, modern Australian apartment",
      durationSecs: 5,
    });
  }

  if (
    text.includes("booking") ||
    text.includes("booked") ||
    text.includes("calendar")
  ) {
    needs.push({
      type: "booking_dashboard",
      prompt:
        "Airbnb host dashboard showing fully booked calendar, high occupancy rate",
      durationSecs: 4,
    });
  }

  if (
    text.includes("$") ||
    text.includes("income") ||
    text.includes("revenue") ||
    text.includes("month")
  ) {
    needs.push({
      type: "income_screenshot",
      prompt:
        "Phone screen showing impressive bank deposit notification, passive income from Airbnb",
      durationSecs: 3,
    });
  }

  if (
    text.includes("freedom") ||
    text.includes("lifestyle") ||
    text.includes("passive")
  ) {
    needs.push({
      type: "lifestyle",
      prompt:
        "Young Australian enjoying freedom lifestyle, working from laptop at beach cafe",
      durationSecs: 5,
    });
  }

  // Always include at least the default set if nothing matched
  if (needs.length === 0) {
    return DEFAULT_BROLL_SET;
  }

  return needs;
}

// Run standalone
if (process.argv[1]?.endsWith("stage5-broll.ts")) {
  runBRollGeneration()
    .then((r) => console.log("[Stage 5] Result:", r))
    .catch((e) => console.error("[Stage 5] Error:", e));
}
