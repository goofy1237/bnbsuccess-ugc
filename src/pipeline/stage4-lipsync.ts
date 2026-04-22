/**
 * STAGE 4: LIP SYNC & FACE ANIMATION
 * Kling AI lip-sync via fal.ai — animates Ava's face to match audio.
 * Original Fish Audio output is preserved unchanged.
 */

import { runLipSyncWithFallback } from "../services/kling-lipsync.js";
import {
  insertRow,
  updateRow,
  fetchRows,
  uploadFile,
} from "../services/supabase.js";
import { notifyPipelineError } from "../services/slack.js";
import { readFile } from "fs/promises";
import { config } from "../config/env.js";

interface LipSyncResult {
  videoAssetsGenerated: number;
  videoAssetIds: string[];
  errors: string[];
}

/**
 * Run lip-sync for all scripts with generated voice assets.
 */
export async function runLipSync(): Promise<LipSyncResult> {
  console.log("[Stage 4] Starting lip-sync generation...");

  // Find scripts with voice but no face yet
  const scripts = await fetchRows<{
    id: string;
    angle: string;
  }>("scripts", { status: "voice_generated" });

  if (scripts.length === 0) {
    console.log("[Stage 4] No scripts ready for lip-sync");
    return { videoAssetsGenerated: 0, videoAssetIds: [], errors: [] };
  }

  console.log(
    `[Stage 4] Processing ${scripts.length} scripts for lip-sync`
  );

  const videoAssetIds: string[] = [];
  const errors: string[] = [];

  for (const script of scripts) {
    // Get the voice asset for this script
    const voiceAssets = await fetchRows<{
      id: string;
      file_url: string;
      duration_secs: number;
    }>("voice_assets", { script_id: script.id, status: "complete" });

    if (voiceAssets.length === 0) {
      console.warn(
        `[Stage 4] No voice asset found for script ${script.id}`
      );
      continue;
    }

    const voiceAsset = voiceAssets[0];

    console.log(
      `[Stage 4] Running lip-sync for script ${script.id}: "${script.angle}"`
    );

    try {
      const result = await runLipSyncWithFallback({
        videoUrl: config.faceReferenceUrl,
        audioUrl: voiceAsset.file_url,
      });

      // Upload to Supabase Storage
      const videoBuffer = await readFile(result.filePath);
      const storagePath = `video/${script.id}_lipsync_${Date.now()}.mp4`;
      const fileUrl = await uploadFile(
        "ugc-assets",
        storagePath,
        videoBuffer,
        "video/mp4"
      );

      // Create video asset record
      const asset = await insertRow("video_assets", {
        script_id: script.id,
        voice_asset_id: voiceAsset.id,
        face_reference_url: config.faceReferenceUrl,
        file_url: fileUrl,
        file_path: result.filePath,
        duration_secs: result.durationSecs,
        resolution: "1080p",
        provider: "kling",
        status: "complete",
        fal_request_id: result.requestId,
      });

      // Update script status
      await updateRow("scripts", script.id, {
        status: "face_generated",
      });

      videoAssetIds.push(asset.id);
      console.log(
        `[Stage 4] Video asset created: ${asset.id}`
      );
    } catch (err) {
      const errMsg = `Script ${script.id}: ${err}`;
      console.error(`[Stage 4] ${errMsg}`);
      errors.push(errMsg);
      await notifyPipelineError("Lip Sync", errMsg, script.id);
    }
  }

  console.log(
    `[Stage 4] Complete: ${videoAssetIds.length} video assets, ${errors.length} errors`
  );

  return {
    videoAssetsGenerated: videoAssetIds.length,
    videoAssetIds,
    errors,
  };
}

// Run standalone
if (process.argv[1]?.endsWith("stage4-lipsync.ts")) {
  runLipSync()
    .then((r) => console.log("[Stage 4] Result:", r))
    .catch((e) => console.error("[Stage 4] Error:", e));
}
