/**
 * PIPELINE ORCHESTRATOR
 * End-to-end automation: Ideation → Script → Voice → Face → B-Roll → Assembly
 * Runs all 6 stages sequentially with error handling.
 * Stages 4 (lip sync) and 5 (B-roll) run in parallel.
 */

import { runIdeation } from "./stage1-ideation.js";
import { runScriptGeneration, approveAllDrafts } from "./stage2-script.js";
import { runVoiceGeneration } from "./stage3-voice.js";
import { runLipSync } from "./stage4-lipsync.js";
import { runBRollGeneration } from "./stage5-broll.js";
import { runAssembly } from "./stage6-assembly.js";
import { sendSlackNotification, notifyPipelineError } from "../services/slack.js";

interface PipelineOptions {
  skipIdeation?: boolean;
  angles?: string[];
  autoApproveScripts?: boolean;
  skipBRoll?: boolean;
  aspectRatios?: string[];
}

interface PipelineResult {
  stage1: Awaited<ReturnType<typeof runIdeation>> | null;
  stage2: Awaited<ReturnType<typeof runScriptGeneration>> | null;
  stage3: Awaited<ReturnType<typeof runVoiceGeneration>> | null;
  stage4: Awaited<ReturnType<typeof runLipSync>> | null;
  stage5: Awaited<ReturnType<typeof runBRollGeneration>> | null;
  stage6: Awaited<ReturnType<typeof runAssembly>> | null;
  totalErrors: number;
  totalAdsProduced: number;
}

/**
 * Run the full pipeline from ideation to finished ads.
 */
export async function runFullPipeline(
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const startTime = Date.now();
  console.log("=".repeat(60));
  console.log("BNB SUCCESS — AI UGC VIDEO PIPELINE");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  await sendSlackNotification({
    text: "Pipeline started: AI UGC Video Pipeline running...",
  });

  const result: PipelineResult = {
    stage1: null,
    stage2: null,
    stage3: null,
    stage4: null,
    stage5: null,
    stage6: null,
    totalErrors: 0,
    totalAdsProduced: 0,
  };

  try {
    // ── STAGE 1: IDEATION ──
    if (!options.skipIdeation) {
      console.log("\n" + "─".repeat(40));
      console.log("STAGE 1: IDEATION & COMPETITOR RESEARCH");
      console.log("─".repeat(40));
      result.stage1 = await runIdeation();
    }

    // ── STAGE 2: SCRIPT GENERATION ──
    console.log("\n" + "─".repeat(40));
    console.log("STAGE 2: SCRIPT GENERATION");
    console.log("─".repeat(40));
    result.stage2 = await runScriptGeneration({
      angles: options.angles,
      autoApprove: options.autoApproveScripts,
    });

    // Auto-approve scripts if flag is set; otherwise they stay as drafts
    // and the pipeline will only process previously approved scripts
    if (options.autoApproveScripts) {
      console.log("[Pipeline] Auto-approving all draft scripts...");
      await approveAllDrafts();
    } else {
      console.log(
        "[Pipeline] Scripts generated as drafts. Approve via Slack or run with --auto-approve"
      );
    }

    // ── STAGE 3: VOICE GENERATION ──
    console.log("\n" + "─".repeat(40));
    console.log("STAGE 3: VOICE GENERATION (Fish Audio S2 Pro)");
    console.log("─".repeat(40));
    result.stage3 = await runVoiceGeneration();
    if (result.stage3.errors.length > 0) {
      result.totalErrors += result.stage3.errors.length;
    }

    // ── STAGES 4 & 5: LIP SYNC + B-ROLL (PARALLEL) ──
    console.log("\n" + "─".repeat(40));
    console.log("STAGES 4+5: LIP SYNC + B-ROLL (PARALLEL)");
    console.log("─".repeat(40));

    const [lipSyncResult, brollResult] = await Promise.all([
      runLipSync(),
      options.skipBRoll
        ? Promise.resolve({
            brollAssetsGenerated: 0,
            brollAssetIds: [],
            errors: [],
          })
        : runBRollGeneration(),
    ]);

    result.stage4 = lipSyncResult;
    result.stage5 = brollResult;
    result.totalErrors +=
      lipSyncResult.errors.length + brollResult.errors.length;

    // ── STAGE 6: ASSEMBLY ──
    console.log("\n" + "─".repeat(40));
    console.log("STAGE 6: AUTOMATED ASSEMBLY & EDITING");
    console.log("─".repeat(40));
    result.stage6 = await runAssembly();
    result.totalAdsProduced = result.stage6.finishedAds;
    result.totalErrors += result.stage6.errors.length;
  } catch (err) {
    console.error(`\n[Pipeline] Fatal error: ${err}`);
    await notifyPipelineError("Pipeline", String(err));
    result.totalErrors++;
  }

  // ── SUMMARY ──
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log("PIPELINE COMPLETE");
  console.log(`Duration: ${elapsed} minutes`);
  console.log(`Ads produced: ${result.totalAdsProduced}`);
  console.log(`Total errors: ${result.totalErrors}`);
  console.log("=".repeat(60));

  await sendSlackNotification({
    text: `Pipeline complete: ${result.totalAdsProduced} ads produced in ${elapsed} minutes (${result.totalErrors} errors)`,
  });

  return result;
}

// Run standalone
if (
  process.argv[1]?.endsWith("orchestrator.ts")
) {
  const args = process.argv.slice(2);
  const options: PipelineOptions = {
    skipIdeation: args.includes("--skip-ideation"),
    autoApproveScripts: args.includes("--auto-approve"),
    skipBRoll: args.includes("--skip-broll"),
  };

  // Parse --angles flag
  const anglesIdx = args.indexOf("--angles");
  if (anglesIdx !== -1 && args[anglesIdx + 1]) {
    options.angles = args[anglesIdx + 1].split(",");
  }

  runFullPipeline(options)
    .then((r) => {
      console.log("\nFinal result:", JSON.stringify(r, null, 2));
      process.exit(r.totalErrors > 0 ? 1 : 0);
    })
    .catch((e) => {
      console.error("Pipeline crashed:", e);
      process.exit(1);
    });
}
