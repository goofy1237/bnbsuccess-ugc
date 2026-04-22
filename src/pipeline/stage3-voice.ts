/**
 * STAGE 3: VOICE GENERATION
 * Fish Audio S2 Pro with cloned voice + emotion tags.
 * Audio output is FINAL — preserved unchanged through lip sync.
 */

import { generateSpeech, estimateDuration } from "../services/fish-audio.js";
import {
  insertRow,
  updateRow,
  fetchRows,
  uploadFile,
} from "../services/supabase.js";
import { notifyPipelineError } from "../services/slack.js";
import { readFile } from "fs/promises";
import { config } from "../config/env.js";

interface VoiceGenResult {
  voiceAssetsGenerated: number;
  voiceAssetIds: string[];
  errors: string[];
}

/**
 * Generate voice audio for all approved scripts.
 */
export async function runVoiceGeneration(): Promise<VoiceGenResult> {
  console.log("[Stage 3] Starting voice generation...");

  const approvedScripts = await fetchRows<{
    id: string;
    script_tagged: string;
    angle: string;
  }>("scripts", { status: "approved" });

  if (approvedScripts.length === 0) {
    console.log("[Stage 3] No approved scripts found");
    return { voiceAssetsGenerated: 0, voiceAssetIds: [], errors: [] };
  }

  console.log(
    `[Stage 3] Processing ${approvedScripts.length} approved scripts`
  );

  const voiceAssetIds: string[] = [];
  const errors: string[] = [];

  for (const script of approvedScripts) {
    console.log(
      `[Stage 3] Generating voice for script ${script.id}: "${script.angle}"`
    );

    let attempts = 0;
    const maxRetries = 3;

    while (attempts < maxRetries) {
      try {
        attempts++;

        const result = await generateSpeech({
          text: script.script_tagged,
          voiceId: config.fishAudioVoiceId,
        });

        // Upload to Supabase Storage
        const audioBuffer = await readFile(result.filePath);
        const storagePath = `voice/${script.id}_${Date.now()}.${result.format}`;
        const fileUrl = await uploadFile(
          "ugc-assets",
          storagePath,
          audioBuffer,
          `audio/${result.format}`
        );

        // Create voice asset record
        const asset = await insertRow("voice_assets", {
          script_id: script.id,
          voice_id: config.fishAudioVoiceId,
          file_url: fileUrl,
          file_path: result.filePath,
          duration_secs: result.durationEstimate,
          sample_rate: 44100,
          format: result.format,
          status: "complete",
        });

        // Update script status
        await updateRow("scripts", script.id, {
          status: "voice_generated",
        });

        voiceAssetIds.push(asset.id);
        console.log(
          `[Stage 3] Voice asset created: ${asset.id} (~${result.durationEstimate}s)`
        );
        break; // Success, exit retry loop
      } catch (err) {
        const errMsg = `Script ${script.id}, attempt ${attempts}: ${err}`;
        console.error(`[Stage 3] ${errMsg}`);

        if (attempts >= maxRetries) {
          errors.push(errMsg);
          await notifyPipelineError(
            "Voice Generation",
            errMsg,
            script.id
          );
        } else {
          // Exponential backoff
          const delay = Math.pow(2, attempts) * 1000;
          console.log(
            `[Stage 3] Retrying in ${delay / 1000}s...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  console.log(
    `[Stage 3] Complete: ${voiceAssetIds.length} voice assets generated, ${errors.length} errors`
  );

  return {
    voiceAssetsGenerated: voiceAssetIds.length,
    voiceAssetIds,
    errors,
  };
}

// Run standalone
if (process.argv[1]?.endsWith("stage3-voice.ts")) {
  runVoiceGeneration()
    .then((r) => console.log("[Stage 3] Result:", r))
    .catch((e) => console.error("[Stage 3] Error:", e));
}
