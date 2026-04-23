import { mkdir, writeFile, copyFile, readFile } from "fs/promises";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import { fal } from "@fal-ai/client";
import { config } from "../config/env.js";
import { generateSpeech, stripEmotionTags } from "../services/fish-audio.js";
import { runLipSync } from "../services/kling-lipsync.js";

fal.config({ credentials: config.falKey });

const FACE_SOURCE = "C:\\Users\\gsidh\\Downloads\\wthisubndy_trimmed.mp4";
const ANGLE = "Rental arbitrage explained — what it is, why it works without owning property.";
const HOOK_TYPES = ["skeptic", "curiosity", "result_first", "challenge"] as const;
type HookType = (typeof HOOK_TYPES)[number];

const HOOK_DESCRIPTIONS: Record<HookType, string> = {
  skeptic: `"I thought this was a scam until..." — start from doubt, then flip to belief with proof.`,
  curiosity: `"Want to know how people make money from property they don't own?" — open loop, promise a secret.`,
  result_first: `"I made $X from a property I don't own. Here's how." — lead with the outcome, reverse-engineer.`,
  challenge: `"Everyone says you need $500k to get into property. Here's why they're wrong." — attack a belief.`,
};

const EXAMPLE_1 = `[excited] Three years ago I would've told you short-term rentals were a scam. [laugh] [pause] Genuinely.

[serious] I was 24. [pause] Stuck in a sales job. No property, no deposit. [pause]

[warm] Then a mate showed me rental arbitrage. You lease the property. [pause] List it on Airbnb. [pause] Keep the difference.

[confident] Eighteen months later — twelve properties. [pause] Forty grand a month. Take-home.

[casual] Link's in the bio if you want the playbook. [pause] Free training. No catch.`;

const EXAMPLE_2 = `[confident] I made eight grand last month. [pause] From a property I don't own. [excited] Not own. [pause] Rent.

[serious] It's called rental arbitrage. [pause] Long-term lease from the landlord. [pause] List on Airbnb. Pocket the difference.

[warm] Most people think you need hundreds of thousands to get into property. [laugh] [pause] You don't. Two grand and the right conversation.

[casual] Free training in my bio. [pause] Walks you through exactly how.`;

const SYSTEM_PROMPT = `You are a UGC ad scriptwriter for BNB Success, an Australian short-term rental mentorship business. You write in Jordan's voice.

VOICE CONSTRAINTS
- First-person, conversational Australian English.
- Use contractions (I'm, you're, don't, it's).
- Specific numbers over vague claims.
- Fragments over subordinate clauses.
- Proactively handle objections inside the script.
- Light self-deprecation; never arrogant.

FISH AUDIO EMOTION TAGS
Insert inline, lowercase, in square brackets, before the clause they modify. Available: [excited], [serious], [warm], [confident], [casual], [whisper], [laugh], [sigh]. Use [pause] for breath beats.

PACING
- Base rate: 140 wpm. Each [pause] adds ~0.3s.
- 30s ad target: 55-65 words, 5-8 pauses. Acceptable duration 27-33s.

STRUCTURE (for each script)
- Hook (0-3s)
- Problem (3-8s)
- Pivot (8-12s)
- Proof (12-22s)
- CTA (22-30s)

OUTPUT FORMAT
Return ONLY a JSON array of 4 objects, one per requested hook type, in the order given. Each object has exactly:
{
  "hook_type": string,
  "script_tagged": string,
  "script_plain": string,
  "word_count": number,
  "est_duration_secs": number
}
No prose before or after the JSON.

<example>
${EXAMPLE_1}
</example>

<example>
${EXAMPLE_2}
</example>`;

interface ScriptOut {
  hook_type: HookType;
  script_tagged: string;
  script_plain: string;
  word_count: number;
  est_duration_secs: number;
}

function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  return s.trim();
}

async function generateFourScripts(): Promise<ScriptOut[]> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const hookList = HOOK_TYPES.map((h) => `- ${h}: ${HOOK_DESCRIPTIONS[h]}`).join("\n");
  const userPrompt = `Angle: ${ANGLE}

Generate 4 distinct 30-second scripts for this angle, one per hook style below. Return them in this exact order:
${hookList}

All 4 scripts pitch the same angle (rental arbitrage) but open with the specified hook style. Each: 55-65 words, 5-8 pauses, Fish Audio emotion tags inline, ends with a CTA to free training in the bio.

Return a JSON array of 4 script objects.`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No text block in Claude response");
  const parsed = JSON.parse(stripJsonFences(textBlock.text));
  if (!Array.isArray(parsed) || parsed.length !== 4) {
    throw new Error(`Expected 4 scripts, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}`);
  }
  return parsed as ScriptOut[];
}

interface RowResult {
  hook_type: HookType;
  words: number;
  audioPath: string;
  videoPath: string;
  status: string;
}

async function processOne(
  idx: number,
  script: ScriptOut,
  faceUrl: string,
  audioDir: string,
  videoDir: string
): Promise<RowResult> {
  const tag = `${idx + 1}_${script.hook_type}`;
  const row: RowResult = {
    hook_type: script.hook_type,
    words: script.word_count,
    audioPath: "—",
    videoPath: "—",
    status: "PENDING",
  };

  try {
    console.log(`\n[${tag}] Fish Audio TTS...`);
    const tts = await generateSpeech({ text: script.script_tagged });
    const audioPath = join(audioDir, `script_${tag}.mp3`);
    await writeFile(audioPath, tts.audioBuffer);
    row.audioPath = audioPath;
    console.log(`[${tag}] audio → ${audioPath}`);

    console.log(`[${tag}] uploading audio to fal...`);
    const blob = new Blob([new Uint8Array(tts.audioBuffer)], { type: "audio/mpeg" });
    const file = new File([blob], `script_${tag}.mp3`, { type: "audio/mpeg" });
    const audioUrl = await fal.storage.upload(file);

    console.log(`[${tag}] Kling lip-sync...`);
    const lip = await runLipSync({ videoUrl: faceUrl, audioUrl });
    const videoPath = join(videoDir, `script_${tag}.mp4`);
    await copyFile(lip.filePath, videoPath);
    row.videoPath = videoPath;
    row.status = "✓";
    console.log(`[${tag}] video → ${videoPath} (${lip.durationSecs}s)  ✓`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    row.status = `FAILED: ${msg.slice(0, 80)}`;
    console.error(`[${tag}] FAILED: ${msg}`);
  }
  return row;
}

function renderTable(rows: RowResult[]): string {
  const header = "Hook type    | Words | Audio path                                    | Video path                                    | Status";
  const sep =    "-------------+-------+-----------------------------------------------+-----------------------------------------------+----------------------------------------";
  const lines = [header, sep];
  for (const r of rows) {
    lines.push(
      `${r.hook_type.padEnd(12)} | ${String(r.words).padEnd(5)} | ${r.audioPath.padEnd(45).slice(0, 45)} | ${r.videoPath.padEnd(45).slice(0, 45)} | ${r.status}`
    );
  }
  return lines.join("\n");
}

async function main() {
  // Pre-flight (lightweight — user already confirmed balances)
  for (const k of ["anthropicApiKey", "falKey", "fishAudioApiKey", "fishAudioVoiceId"] as const) {
    if (!config[k]) throw new Error(`Missing config: ${k}`);
  }

  const audioDir = join(process.cwd(), "assets", "audio", "ab-test-01");
  const videoDir = join(process.cwd(), "assets", "video", "ab-test-01");
  await mkdir(audioDir, { recursive: true });
  await mkdir(videoDir, { recursive: true });

  console.log(`[face] uploading ${FACE_SOURCE} to fal storage as-is (ffprobe check skipped per user)...`);
  const faceBuf = await readFile(FACE_SOURCE);
  const faceBlob = new Blob([new Uint8Array(faceBuf)], { type: "video/mp4" });
  const faceFile = new File([faceBlob], "wthisubndy_trimmed.mp4", { type: "video/mp4" });
  const faceUrl = await fal.storage.upload(faceFile);
  console.log(`[face] uploaded → ${faceUrl}`);

  console.log(`\n[scripts] requesting 4 variants from Claude Opus...`);
  const scripts = await generateFourScripts();
  for (const s of scripts) {
    console.log(`  - ${s.hook_type}: ${s.word_count} words, ~${s.est_duration_secs}s`);
  }

  const scriptsJsonPath = join(videoDir, "scripts.json");
  await writeFile(
    scriptsJsonPath,
    JSON.stringify(
      {
        angle: ANGLE,
        face_source: FACE_SOURCE,
        face_url: faceUrl,
        generated_at: new Date().toISOString(),
        scripts: scripts.map((s) => ({
          ...s,
          script_plain: s.script_plain || stripEmotionTags(s.script_tagged),
        })),
      },
      null,
      2
    )
  );
  console.log(`[scripts] saved → ${scriptsJsonPath}`);

  const startMs = Date.now();
  const rows: RowResult[] = [];
  for (let i = 0; i < scripts.length; i++) {
    const row = await processOne(i, scripts[i], faceUrl, audioDir, videoDir);
    rows.push(row);
    const soFar = ((Date.now() - startMs) / 60000).toFixed(1);
    console.log(`[progress] ${i + 1}/4 done, ${soFar} min elapsed`);
  }

  const minutes = ((Date.now() - startMs) / 60000).toFixed(1);
  const ok = rows.filter((r) => r.status === "✓").length;

  console.log("\n" + "=".repeat(80));
  console.log(renderTable(rows));
  console.log("=".repeat(80));
  console.log(`A/B run complete: ${ok}/4 succeeded in ${minutes} min.`);
  console.log(`Face URL used: ${faceUrl}`);
}

main().catch((err) => {
  console.error("Aborted:", err);
  process.exit(1);
});
