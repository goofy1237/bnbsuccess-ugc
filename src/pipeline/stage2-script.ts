/**
 * STAGE 2: SCRIPT GENERATION
 * AI-authored scripts trained on best performers.
 * Output includes Fish Audio emotion tags.
 */

import { generateScripts } from "../services/claude-scripts.js";
import { insertRow, fetchRows } from "../services/supabase.js";
import { notifyScriptsReady } from "../services/slack.js";
import { estimateDuration, stripEmotionTags } from "../services/fish-audio.js";

interface ScriptGenOptions {
  angles?: string[];
  hookStyles?: string[];
  variationsPerAngle?: number;
  targetDuration?: number;
  autoApprove?: boolean;
}

interface ScriptGenResult {
  scriptsGenerated: number;
  scriptIds: string[];
}

/**
 * Generate scripts for given angles (or from latest creative brief).
 */
export async function runScriptGeneration(
  options: ScriptGenOptions = {}
): Promise<ScriptGenResult> {
  console.log("[Stage 2] Starting script generation...");

  const {
    variationsPerAngle = 3,
    targetDuration = 30,
    autoApprove = false,
  } = options;

  // Get angles from options or latest creative brief
  let angles = options.angles;
  if (!angles || angles.length === 0) {
    const briefs = await fetchRows<{
      id: string;
      angles: string[];
      status: string;
    }>("creative_briefs", { status: "active" }, { limit: 1, orderBy: "created_at" });

    if (briefs.length > 0 && briefs[0].angles) {
      angles = briefs[0].angles;
    } else {
      angles = [
        "financial freedom through Airbnb without owning property",
        "side income that pays more than your 9-to-5",
        "how a complete beginner made $8K in their first month",
      ];
    }
  }

  const hookStyles = options.hookStyles || [
    "skeptic",
    "curiosity",
    "result_first",
    "challenge",
  ];

  const scriptIds: string[] = [];

  for (const angle of angles) {
    const hookStyle =
      hookStyles[Math.floor(Math.random() * hookStyles.length)];

    console.log(
      `[Stage 2] Generating ${variationsPerAngle} scripts for: "${angle}" (${hookStyle})`
    );

    try {
      const scripts = await generateScripts({
        angle,
        hookStyle,
        targetDuration,
        variations: variationsPerAngle,
      });

      for (const script of scripts) {
        const wordCount =
          script.word_count ||
          stripEmotionTags(script.script_tagged).split(/\s+/).length;
        const estDuration =
          script.est_duration || estimateDuration(script.script_tagged);

        const row = await insertRow("scripts", {
          angle,
          hook_type: script.hook_type,
          script_plain: script.script_plain,
          script_tagged: script.script_tagged,
          word_count: wordCount,
          est_duration: estDuration,
          status: autoApprove ? "approved" : "draft",
          source_angles: [],
        });

        scriptIds.push(row.id);
        console.log(
          `[Stage 2] Script saved: ${row.id} (${script.hook_type}, ${wordCount} words, ~${estDuration}s)`
        );
      }
    } catch (err) {
      console.error(
        `[Stage 2] Failed to generate scripts for "${angle}": ${err}`
      );
    }
  }

  // Notify Slack for approval
  if (!autoApprove && scriptIds.length > 0) {
    const savedScripts = await Promise.all(
      scriptIds.map(async (id) => {
        const rows = await fetchRows<{
          id: string;
          angle: string;
          hook_type: string;
        }>("scripts", { id });
        return rows[0];
      })
    );
    await notifyScriptsReady(savedScripts.filter(Boolean));
    console.log(
      `[Stage 2] Slack notification sent for ${scriptIds.length} scripts`
    );
  }

  console.log(
    `[Stage 2] Complete: ${scriptIds.length} scripts generated`
  );

  return {
    scriptsGenerated: scriptIds.length,
    scriptIds,
  };
}

/**
 * Approve a script and trigger voice generation.
 */
export async function approveScript(scriptId: string): Promise<void> {
  const { updateRow } = await import("../services/supabase.js");
  await updateRow("scripts", scriptId, { status: "approved" });
  console.log(`[Stage 2] Script ${scriptId} approved`);
}

/**
 * Approve all draft scripts.
 */
export async function approveAllDrafts(): Promise<string[]> {
  const drafts = await fetchRows<{ id: string }>("scripts", {
    status: "draft",
  });
  const { updateRow } = await import("../services/supabase.js");
  for (const draft of drafts) {
    await updateRow("scripts", draft.id, { status: "approved" });
  }
  console.log(`[Stage 2] Approved ${drafts.length} draft scripts`);
  return drafts.map((d) => d.id);
}

// Run standalone
if (process.argv[1]?.endsWith("stage2-script.ts")) {
  runScriptGeneration()
    .then((r) => console.log("[Stage 2] Result:", r))
    .catch((e) => console.error("[Stage 2] Error:", e));
}
