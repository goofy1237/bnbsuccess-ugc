import { fal } from "@fal-ai/client";
import { config } from "../config/env.js";
import { writeFile } from "fs/promises";
import { join } from "path";

fal.config({ credentials: config.falKey });

type BRollType =
  | "property_interior"
  | "booking_dashboard"
  | "income_screenshot"
  | "lifestyle"
  | "before_after"
  | "app_demo";

interface BRollOptions {
  prompt: string;
  type: BRollType;
  durationSecs?: number;
  imageUrl?: string; // For image-to-video
  provider?: "seedance" | "sora";
}

interface BRollResult {
  videoUrl: string;
  filePath: string;
  requestId: string;
  durationSecs: number;
  provider: string;
}

/**
 * Prompt templates for different B-roll types
 */
const BROLL_PROMPTS: Record<BRollType, string> = {
  property_interior:
    "Cinematic walkthrough of a beautifully styled modern Airbnb apartment, warm lighting, professionally decorated, 4K quality, smooth camera movement",
  booking_dashboard:
    "Close-up of a laptop screen showing an Airbnb host dashboard with a fully booked calendar, green bookings filling every day, warm desk lighting",
  income_screenshot:
    "Over-the-shoulder shot of someone looking at their phone showing a bank app with a large deposit notification, natural lighting, casual setting",
  lifestyle:
    "Young Australian woman relaxing on a balcony overlooking the ocean, checking her phone with a smile, golden hour lighting, passive income lifestyle",
  before_after:
    "Split-screen transformation: left side shows an empty unfurnished apartment, right side shows the same space beautifully furnished as an Airbnb listing",
  app_demo:
    "Close-up hands scrolling through the Airbnb app on an iPhone, viewing listing photos and booking requests, clean modern interface",
};

/**
 * Generate B-roll video using Seedance 2.0 via fal.ai
 */
export async function generateBRoll(
  options: BRollOptions
): Promise<BRollResult> {
  const {
    prompt,
    type,
    durationSecs = 5,
    imageUrl,
    provider = "seedance",
  } = options;

  const fullPrompt = `${prompt}. ${BROLL_PROMPTS[type] || ""}`.trim();

  console.log(
    `[BRoll] Generating ${type} via ${provider} (${durationSecs}s)...`
  );

  if (provider === "sora") {
    return generateBRollSora(fullPrompt, type, durationSecs);
  }

  // Seedance 2.0 via fal.ai
  const input: Record<string, unknown> = {
    prompt: fullPrompt,
    duration: durationSecs,
  };
  if (imageUrl) {
    input.image_url = imageUrl;
  }

  const result = await fal.subscribe("fal-ai/seedance", {
    input,
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS" && update.logs) {
        for (const log of update.logs) {
          console.log(`[BRoll] ${log.message}`);
        }
      }
    },
  });

  const data = result.data as Record<string, unknown>;
  const videoUrl =
    (data?.video as Record<string, string>)?.url ||
    (data as Record<string, string>).url;

  if (!videoUrl) {
    throw new Error("[BRoll] No video URL in Seedance response");
  }

  const videoResponse = await fetch(videoUrl);
  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
  const filename = `broll_${type}_${Date.now()}.mp4`;
  const filePath = join(process.cwd(), "assets", "broll", filename);
  await writeFile(filePath, videoBuffer);

  console.log(`[BRoll] Complete: ${filePath}`);

  return {
    videoUrl,
    filePath,
    requestId: result.requestId,
    durationSecs,
    provider: "seedance",
  };
}

/**
 * Fallback: Generate B-roll via OpenAI Sora 2 Pro
 */
async function generateBRollSora(
  prompt: string,
  type: BRollType,
  durationSecs: number
): Promise<BRollResult> {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  // Sora API — using responses endpoint for video generation
  const response = await openai.responses.create({
    model: "sora",
    input: prompt,
  } as never);

  const data = response as unknown as Record<string, unknown>;
  const videoUrl = (data.output as string) || "";

  if (!videoUrl) {
    throw new Error("[BRoll] No video URL in Sora response");
  }

  const videoResponse = await fetch(videoUrl);
  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
  const filename = `broll_sora_${type}_${Date.now()}.mp4`;
  const filePath = join(process.cwd(), "assets", "broll", filename);
  await writeFile(filePath, videoBuffer);

  return {
    videoUrl,
    filePath,
    requestId: "sora-" + Date.now(),
    durationSecs,
    provider: "sora",
  };
}

/**
 * Generate multiple B-roll clips for a script
 */
export async function generateBRollSet(
  scriptSections: Array<{
    type: BRollType;
    prompt: string;
    durationSecs?: number;
  }>
): Promise<BRollResult[]> {
  const results: BRollResult[] = [];
  for (const section of scriptSections) {
    try {
      const result = await generateBRoll(section);
      results.push(result);
    } catch (err) {
      console.error(
        `[BRoll] Failed to generate ${section.type}: ${err}. Skipping.`
      );
    }
  }
  return results;
}
