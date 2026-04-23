import { config } from "../config/env.js";
import { writeFile } from "fs/promises";
import { join } from "path";

const BASE_URL = "https://api.fish.audio/v1";

interface TTSOptions {
  text: string;
  voiceId?: string;
  temperature?: number;
  topP?: number;
  speed?: number;
  format?: "mp3" | "wav";
  sampleRate?: number;
  mp3Bitrate?: number;
}

interface TTSResult {
  audioBuffer: Buffer;
  filePath: string;
  format: string;
  durationEstimate: number;
}

/**
 * Generate speech from text using Fish Audio S2 Pro with cloned voice.
 * Scripts should include inline emotion tags: [excited], [serious], [warm], etc.
 */
export async function generateSpeech(options: TTSOptions): Promise<TTSResult> {
  const {
    text,
    voiceId = config.fishAudioVoiceId,
    temperature = config.defaultVoiceTemp,
    topP = 0.7,
    speed = config.defaultVoiceSpeed,
    format = "mp3",
    sampleRate = 44100,
    mp3Bitrate = 128,
  } = options;

  if (!voiceId) {
    throw new Error(
      "FISH_AUDIO_VOICE_ID not set. Clone your voice first at fish.audio"
    );
  }

  const body = {
    text,
    reference_id: voiceId,
    temperature,
    top_p: topP,
    prosody: { speed, volume: 0, normalize_loudness: true },
    format,
    sample_rate: sampleRate,
    mp3_bitrate: mp3Bitrate,
    latency: "normal",
  };

  const response = await fetch(`${BASE_URL}/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.fishAudioApiKey}`,
      "Content-Type": "application/json",
      model: "s2-pro",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Fish Audio TTS failed (${response.status}): ${errText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  // Estimate duration: ~140 words per minute, strip emotion tags for count
  const plainText = text.replace(/\[.*?\]/g, "").trim();
  const wordCount = plainText.split(/\s+/).length;
  const durationEstimate = Math.round((wordCount / config.targetWpm) * 60);

  const filename = `voice_${Date.now()}.${format}`;
  const filePath = join(process.cwd(), "assets", "audio", filename);
  await writeFile(filePath, audioBuffer);

  return { audioBuffer, filePath, format, durationEstimate };
}

/**
 * Create a voice clone from a reference audio file.
 * Returns the voice_id to use in future TTS calls.
 */
export async function createVoiceClone(
  audioBuffer: Buffer,
  name: string,
  description: string
): Promise<string> {
  const formData = new FormData();
  formData.append("type", "tts");
  formData.append("title", name.slice(0, 64));
  formData.append("description", description);
  formData.append("train_mode", "fast");
  formData.append("visibility", "private");
  formData.append(
    "voices",
    new Blob([new Uint8Array(audioBuffer)], { type: "application/octet-stream" }),
    "reference.mp3"
  );

  const response = await fetch("https://api.fish.audio/model", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.fishAudioApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Fish Audio clone failed (${response.status}): ${errText}`
    );
  }

  const data = (await response.json()) as { _id: string };
  return data._id;
}

/**
 * Strip Fish Audio emotion tags from script text for word counting.
 */
export function stripEmotionTags(text: string): string {
  return text.replace(/\[.*?\]/g, "").trim();
}

/**
 * Estimate audio duration from tagged script text.
 */
export function estimateDuration(taggedText: string, wpm?: number): number {
  const plain = stripEmotionTags(taggedText);
  const wordCount = plain.split(/\s+/).length;
  return Math.round((wordCount / (wpm || config.targetWpm)) * 60);
}
