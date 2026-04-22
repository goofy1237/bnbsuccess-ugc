/**
 * STAGE 6: AUTOMATED ASSEMBLY & EDITING
 * ffmpeg stitching: talking head + B-roll + captions + music.
 * Generates 9:16, 1:1, and 16:9 variants.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { transcribeAudio } from "../services/whisper.js";
import { getVideoDuration, getVideoResolution } from "../services/whisper.js";
import {
  insertRow,
  updateRow,
  fetchRows,
  uploadFile,
} from "../services/supabase.js";
import { notifyAdComplete, notifyPipelineError } from "../services/slack.js";
import {
  TEMPLATES,
  ASPECT_CONFIGS,
  buildAssemblyCommand,
  buildQACommands,
  type AspectRatio,
  type FFmpegTemplate,
} from "../templates/ffmpeg-templates.js";

const execAsync = promisify(exec);

interface AssemblyResult {
  finishedAds: number;
  finishedAdIds: string[];
  errors: string[];
}

// Default ambient music — place a royalty-free lo-fi track here
const DEFAULT_MUSIC_PATH = join(
  process.cwd(),
  "assets",
  "audio",
  "ambient_lofi.mp3"
);

/**
 * Assemble finished ads from all completed pipeline assets.
 */
export async function runAssembly(): Promise<AssemblyResult> {
  console.log("[Stage 6] Starting assembly...");

  // Find scripts that have both face and B-roll ready
  const scripts = await fetchRows<{
    id: string;
    angle: string;
    hook_type: string;
    est_duration: number;
  }>("scripts", { status: "face_generated" });

  if (scripts.length === 0) {
    console.log("[Stage 6] No scripts ready for assembly");
    return { finishedAds: 0, finishedAdIds: [], errors: [] };
  }

  const finishedAdIds: string[] = [];
  const errors: string[] = [];

  for (const script of scripts) {
    console.log(
      `[Stage 6] Assembling ad for script ${script.id}: "${script.angle}"`
    );

    // Get video asset (lip-synced talking head)
    const videoAssets = await fetchRows<{
      id: string;
      file_path: string;
      file_url: string;
    }>("video_assets", { script_id: script.id, status: "complete" });

    if (videoAssets.length === 0) {
      console.warn(
        `[Stage 6] No video asset for script ${script.id}`
      );
      continue;
    }

    // Get voice asset (for transcription)
    const voiceAssets = await fetchRows<{
      id: string;
      file_path: string;
    }>("voice_assets", { script_id: script.id, status: "complete" });

    // Get B-roll assets
    const brollAssets = await fetchRows<{
      id: string;
      file_path: string;
      broll_type: string;
    }>("broll_assets", { script_id: script.id, status: "complete" });

    const videoAsset = videoAssets[0];

    // Step 1: Transcribe audio for captions
    let srtPath: string | undefined;
    if (voiceAssets.length > 0 && existsSync(voiceAssets[0].file_path)) {
      try {
        const transcription = await transcribeAudio(
          voiceAssets[0].file_path
        );
        srtPath = transcription.srtPath;
        console.log(
          `[Stage 6] Captions generated: ${transcription.segments.length} segments`
        );
      } catch (err) {
        console.warn(`[Stage 6] Transcription failed: ${err}`);
      }
    }

    // Step 2: Select template based on hook type and duration
    const template = selectTemplate(script.hook_type, script.est_duration);

    // Step 3: Generate each aspect ratio variant
    const aspectRatios: AspectRatio[] = ["9:16", "1:1", "16:9"];

    for (const aspectRatio of aspectRatios) {
      try {
        const outputFilename = `ad_${script.id}_${aspectRatio.replace(":", "x")}_${Date.now()}.mp4`;
        const outputPath = join(
          process.cwd(),
          "assets",
          "exports",
          outputFilename
        );

        const brollPaths = brollAssets
          .map((b) => b.file_path)
          .filter((p) => existsSync(p));

        // Check if we have a music file
        const musicPath = existsSync(DEFAULT_MUSIC_PATH)
          ? DEFAULT_MUSIC_PATH
          : undefined;

        if (!existsSync(videoAsset.file_path)) {
          throw new Error(
            `Talking head video not found: ${videoAsset.file_path}`
          );
        }

        // Build and run ffmpeg command
        if (musicPath && srtPath && brollPaths.length > 0) {
          const cmd = buildAssemblyCommand({
            talkingHeadPath: videoAsset.file_path,
            brollPaths,
            musicPath,
            captionSrtPath: srtPath,
            outputPath,
            template,
            aspectRatio,
          });

          console.log(
            `[Stage 6] Running ffmpeg for ${aspectRatio}...`
          );
          await execAsync(cmd, { timeout: 120000 });
        } else {
          // Simplified assembly without B-roll/music/captions
          const aspect = ASPECT_CONFIGS[aspectRatio];
          const simpleCmd = `ffmpeg -y -i "${videoAsset.file_path}" -vf "scale=${aspect.width}:${aspect.height}:force_original_aspect_ratio=decrease,pad=${aspect.width}:${aspect.height}:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "${outputPath}"`;
          console.log(
            `[Stage 6] Running simplified ffmpeg for ${aspectRatio}...`
          );
          await execAsync(simpleCmd, { timeout: 120000 });
        }

        // Step 4: QA check
        const qaResults = await runQAChecks(outputPath, template);

        // Upload to storage
        const videoBuffer = await readFile(outputPath);
        const storagePath = `exports/${outputFilename}`;
        const fileUrl = await uploadFile(
          "ugc-assets",
          storagePath,
          videoBuffer,
          "video/mp4"
        );

        // Save finished ad record
        const ad = await insertRow("finished_ads", {
          script_id: script.id,
          video_asset_id: videoAsset.id,
          template: template.name,
          aspect_ratio: aspectRatio,
          file_url: fileUrl,
          file_path: outputPath,
          duration_secs: qaResults.duration,
          resolution: `${ASPECT_CONFIGS[aspectRatio].width}x${ASPECT_CONFIGS[aspectRatio].height}`,
          caption_srt_url: srtPath || null,
          status: qaResults.passed ? "qa_passed" : "qa_failed",
          qa_results: qaResults,
        });

        finishedAdIds.push(ad.id);

        // Notify
        await notifyAdComplete(ad.id, fileUrl, {
          angle: script.angle,
          duration: qaResults.duration,
          aspectRatio,
        });

        console.log(
          `[Stage 6] Ad created: ${ad.id} (${aspectRatio}, QA: ${qaResults.passed ? "PASS" : "FAIL"})`
        );
      } catch (err) {
        const errMsg = `Script ${script.id}, ${aspectRatio}: ${err}`;
        console.error(`[Stage 6] ${errMsg}`);
        errors.push(errMsg);
      }
    }

    // Update script status
    await updateRow("scripts", script.id, { status: "complete" });
  }

  console.log(
    `[Stage 6] Complete: ${finishedAdIds.length} finished ads, ${errors.length} errors`
  );

  return {
    finishedAds: finishedAdIds.length,
    finishedAdIds,
    errors,
  };
}

/**
 * Select the best template based on hook type and duration.
 */
function selectTemplate(
  hookType: string,
  estDuration: number
): FFmpegTemplate {
  if (estDuration <= 18) return TEMPLATES.result_first_15s;
  if (estDuration >= 40) return TEMPLATES.storytime_45s;
  if (hookType === "challenge") return TEMPLATES.listicle_30s;
  return TEMPLATES.testimonial_30s;
}

/**
 * Run QA checks on a finished video.
 */
async function runQAChecks(
  videoPath: string,
  template: FFmpegTemplate
): Promise<{
  passed: boolean;
  duration: number;
  resolution: { width: number; height: number };
  issues: string[];
}> {
  const issues: string[] = [];

  // Check duration
  let duration = 0;
  try {
    duration = await getVideoDuration(videoPath);
    if (Math.abs(duration - template.targetDuration) > 2) {
      issues.push(
        `Duration ${duration.toFixed(1)}s outside ±2s of target ${template.targetDuration}s`
      );
    }
  } catch {
    issues.push("Could not determine video duration");
  }

  // Check resolution
  let resolution = { width: 0, height: 0 };
  try {
    resolution = await getVideoResolution(videoPath);
  } catch {
    issues.push("Could not determine video resolution");
  }

  return {
    passed: issues.length === 0,
    duration: Math.round(duration),
    resolution,
    issues,
  };
}

// Run standalone
if (process.argv[1]?.endsWith("stage6-assembly.ts")) {
  runAssembly()
    .then((r) => console.log("[Stage 6] Result:", r))
    .catch((e) => console.error("[Stage 6] Error:", e));
}
