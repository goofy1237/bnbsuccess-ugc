import { fal } from "@fal-ai/client";
import { config } from "../config/env.js";
import { writeFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Configure fal.ai client
fal.config({ credentials: config.falKey });

interface LipSyncOptions {
  videoUrl: string; // Face reference video URL
  audioUrl: string; // Fish Audio TTS output URL
}

interface LipSyncResult {
  videoUrl: string;
  filePath: string;
  requestId: string;
  durationSecs: number;
}

/**
 * Run Kling lip-sync: animate Ava's face to match Fish Audio output.
 * Preserves original audio — only animates mouth/face movements.
 */
export async function runLipSync(
  options: LipSyncOptions
): Promise<LipSyncResult> {
  const { videoUrl, audioUrl } = options;

  console.log("[LipSync] Submitting to Kling via fal.ai...");

  const result = await fal.subscribe("fal-ai/kling-video/lipsync/audio-to-video", {
    input: {
      video_url: videoUrl,
      audio_url: audioUrl,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS" && update.logs) {
        for (const log of update.logs) {
          console.log(`[LipSync] ${log.message}`);
        }
      }
    },
  });

  const data = result.data as unknown as Record<string, unknown>;
  const videoObj = data?.video as Record<string, string> | undefined;
  const outputVideoUrl = videoObj?.url || (data as Record<string, string>).url;

  if (!outputVideoUrl) {
    throw new Error("[LipSync] No video URL in response");
  }

  // Download the result
  const videoResponse = await fetch(outputVideoUrl);
  if (!videoResponse.ok) {
    throw new Error(`[LipSync] Failed to download result video`);
  }

  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
  const filename = `lipsync_${Date.now()}.mp4`;
  const filePath = join(process.cwd(), "assets", "video", filename);
  await writeFile(filePath, videoBuffer);

  // Get actual duration from the downloaded video via ffprobe
  let durationSecs = 30;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath,
    ]);
    durationSecs = Math.round(parseFloat(stdout.trim()));
  } catch {
    console.warn("[LipSync] Could not determine video duration via ffprobe, using estimate");
  }

  console.log(`[LipSync] Complete: ${filePath}`);

  return {
    videoUrl: outputVideoUrl,
    filePath,
    requestId: result.requestId,
    durationSecs,
  };
}

/**
 * Fallback: LipDub AI lip-sync
 */
export async function runLipDubFallback(
  videoUrl: string,
  audioUrl: string
): Promise<LipSyncResult> {
  // LipDub API integration — placeholder until API key is available
  console.warn("[LipSync] LipDub fallback not yet configured");
  throw new Error(
    "LipDub AI fallback requires API key. Configure LIPDUB_API_KEY."
  );
}

/**
 * Fallback: Sync.so lip-sync
 */
export async function runSyncFallback(
  videoUrl: string,
  audioUrl: string
): Promise<LipSyncResult> {
  console.warn("[LipSync] Sync.so fallback not yet configured");
  throw new Error(
    "Sync.so fallback requires API key. Configure SYNC_API_KEY."
  );
}

/**
 * Run lip-sync with automatic fallback chain: Kling → LipDub → Sync.so
 */
export async function runLipSyncWithFallback(
  options: LipSyncOptions
): Promise<LipSyncResult> {
  try {
    return await runLipSync(options);
  } catch (err) {
    console.error(`[LipSync] Kling failed: ${err}. Trying LipDub...`);
    try {
      return await runLipDubFallback(options.videoUrl, options.audioUrl);
    } catch {
      console.error(`[LipSync] LipDub failed. Trying Sync.so...`);
      return await runSyncFallback(options.videoUrl, options.audioUrl);
    }
  }
}
