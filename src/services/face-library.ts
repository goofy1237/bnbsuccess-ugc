import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

export interface FaceReference {
  id: string;
  url: string;
  tags: string[];
  duration_secs: number;
  source: string;
  notes: string;
}

interface FaceLibrary {
  references: FaceReference[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIBRARY_PATH = resolve(__dirname, "../../assets/face-reference/library.json");

async function loadLibrary(): Promise<FaceLibrary> {
  const raw = await readFile(LIBRARY_PATH, "utf8");
  const parsed = JSON.parse(raw) as FaceLibrary;
  if (!parsed.references || parsed.references.length === 0) {
    throw new Error("Face reference library is empty");
  }
  return parsed;
}

export async function getRandomFaceReference(): Promise<FaceReference> {
  const { references } = await loadLibrary();
  return references[Math.floor(Math.random() * references.length)];
}

export async function getFaceReferenceByTag(tag: string): Promise<FaceReference> {
  const { references } = await loadLibrary();
  const matches = references.filter((r) => r.tags.includes(tag));
  if (matches.length === 0) {
    throw new Error(`No face reference found with tag: ${tag}`);
  }
  return matches[Math.floor(Math.random() * matches.length)];
}
