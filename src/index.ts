/**
 * BNB SUCCESS — AI UGC VIDEO PIPELINE
 * Entry point for running the pipeline or individual stages.
 *
 * Usage:
 *   npx tsx src/index.ts                    # Run full pipeline
 *   npx tsx src/index.ts --stage 2          # Run specific stage
 *   npx tsx src/index.ts --auto-approve     # Auto-approve scripts
 *   npx tsx src/index.ts --feedback         # Run feedback loop only
 */

import { runFullPipeline } from "./pipeline/orchestrator.js";
import { runIdeation } from "./pipeline/stage1-ideation.js";
import { runScriptGeneration } from "./pipeline/stage2-script.js";
import { runVoiceGeneration } from "./pipeline/stage3-voice.js";
import { runLipSync } from "./pipeline/stage4-lipsync.js";
import { runBRollGeneration } from "./pipeline/stage5-broll.js";
import { runAssembly } from "./pipeline/stage6-assembly.js";
import { runFeedbackLoop } from "./pipeline/feedback-loop.js";
import { validateConfig } from "./config/env.js";

async function main() {
  const args = process.argv.slice(2);

  console.log("BNB Success — AI UGC Video Pipeline v1.0");
  console.log("─".repeat(40));

  // Fail fast if required env vars are missing
  validateConfig();

  // Run feedback loop only
  if (args.includes("--feedback")) {
    const result = await runFeedbackLoop();
    console.log("Feedback result:", result);
    return;
  }

  // Run specific stage
  const stageIdx = args.indexOf("--stage");
  if (stageIdx !== -1) {
    const stage = parseInt(args[stageIdx + 1]);
    switch (stage) {
      case 1:
        console.log(await runIdeation());
        break;
      case 2:
        console.log(
          await runScriptGeneration({
            autoApprove: args.includes("--auto-approve"),
          })
        );
        break;
      case 3:
        console.log(await runVoiceGeneration());
        break;
      case 4:
        console.log(await runLipSync());
        break;
      case 5:
        console.log(await runBRollGeneration());
        break;
      case 6:
        console.log(await runAssembly());
        break;
      default:
        console.error(`Unknown stage: ${stage}. Use 1-6.`);
        process.exit(1);
    }
    return;
  }

  // Run full pipeline
  const result = await runFullPipeline({
    autoApproveScripts: args.includes("--auto-approve"),
    skipIdeation: args.includes("--skip-ideation"),
    skipBRoll: args.includes("--skip-broll"),
  });

  process.exit(result.totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
