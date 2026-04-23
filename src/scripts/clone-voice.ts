import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { basename, extname, dirname, join } from "path";
import { createVoiceClone } from "../services/fish-audio.js";

const LIBRARY_PATH = join(process.cwd(), "assets", "voice-library.json");

interface VoiceLibraryEntry {
  id: string;
  title: string;
  source: string;
  created_at: string;
}

interface VoiceLibrary {
  voices: VoiceLibraryEntry[];
}

async function appendToLibrary(entry: VoiceLibraryEntry): Promise<void> {
  await mkdir(dirname(LIBRARY_PATH), { recursive: true });
  let library: VoiceLibrary = { voices: [] };
  if (existsSync(LIBRARY_PATH)) {
    const existing = await readFile(LIBRARY_PATH, "utf-8");
    library = JSON.parse(existing) as VoiceLibrary;
    if (!Array.isArray(library.voices)) library.voices = [];
  }
  library.voices.push(entry);
  await writeFile(LIBRARY_PATH, JSON.stringify(library, null, 2) + "\n");
}

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

  await appendToLibrary({
    id: voiceId,
    title,
    source: audioPath,
    created_at: new Date().toISOString(),
  });

  console.log(voiceId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
