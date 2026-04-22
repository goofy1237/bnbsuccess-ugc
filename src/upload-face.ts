import { fal } from "@fal-ai/client";
import { config } from "./config/env.js";
import { readFile } from "fs/promises";
import { basename, extname } from "path";

fal.config({ credentials: config.falKey });

const inputPath = process.argv[2] ?? "C:\\Users\\gsidh\\Downloads\\face_ref.mp4";

const buf = await readFile(inputPath);
const name = basename(inputPath);
const ext = extname(inputPath).toLowerCase();
const contentType =
  ext === ".mp4" ? "video/mp4" :
  ext === ".mov" ? "video/quicktime" :
  ext === ".png" ? "image/png" :
  ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
  "application/octet-stream";

const file = new File([buf], name, { type: contentType });
const url = await fal.storage.upload(file);
console.log("FACE_REFERENCE_URL=" + url);
