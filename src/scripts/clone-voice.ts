import { readFile } from "fs/promises";
import { basename, extname } from "path";
import { createVoiceClone } from "../services/fish-audio.js";

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error("Usage: tsx src/scripts/clone-voice.ts <audio-file>");
    process.exit(1);
  }

  const audioBuffer = await readFile(audioPath);
  const title = basename(audioPath, extname(audioPath));
  const voiceId = await createVoiceClone(
    audioBuffer,
    title,
    `Voice clone from ${basename(audioPath)}`
  );
  console.log(voiceId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
