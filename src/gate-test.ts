import { generateSpeech } from "./services/fish-audio.js";
import { runLipSync } from "./services/kling-lipsync.js";
import { config } from "./config/env.js";
import { readFile } from "fs/promises";

const SCRIPT = `[excited] Okay so I was literally skeptical about Airbnb until I saw my first month's numbers. [serious] I had no idea how to price my listing, get bookings, or even where to start. [warm] Then I found this mentorship program that showed me exactly what to do, step by step. [confident] Within sixty days I had my listing fully booked at two hundred and eighty dollars a night — that's eight thousand four hundred a month. [casual] Link's in the bio if you want the same playbook.`;

console.log("FACE_REFERENCE_URL:", JSON.stringify(config.faceReferenceUrl));

async function main() {
    console.log("→ Generating speech via Fish Audio...");
    const tts = await generateSpeech({ text: SCRIPT });
    console.log(`  Audio: ${tts.filePath} (~${tts.durationEstimate}s)`);

    const { fal } = await import("@fal-ai/client");
    fal.config({ credentials: config.falKey });
    const audioFile = new File(
        [await readFile(tts.filePath)],
        "audio.mp3",
        { type: "audio/mpeg" }
    );
    const audioUrl = await fal.storage.upload(audioFile);
    console.log(`  Audio URL: ${audioUrl}`);

    console.log("→ Running Kling lip-sync...");
    const result = await runLipSync({
        videoUrl: config.faceReferenceUrl,
        audioUrl,
    });
    console.log(`✓ Gate test output: ${result.filePath}`);
}

main().catch((e) => {
    console.error("Gate test failed:", e.message);
    if (e.body?.detail) {
        console.error("Validation details:", JSON.stringify(e.body.detail, null, 2));
    } else if (e.body) {
        console.error("Body:", JSON.stringify(e.body, null, 2));
    }
    process.exit(1);
});