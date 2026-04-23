import { supabase } from "../services/supabase.js";

const BUCKET = "ugc-assets";
const TEST_PATH = `_verify/${Date.now()}.bin`;

async function main() {
  const payload = Buffer.from("0123456789"); // 10 bytes

  console.log(`Uploading to ${BUCKET}/${TEST_PATH}...`);
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(TEST_PATH, payload, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  console.log("Downloading...");
  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(TEST_PATH);
  if (dlErr) throw new Error(`download: ${dlErr.message}`);
  const roundtrip = Buffer.from(await blob.arrayBuffer());
  if (roundtrip.length !== payload.length || !roundtrip.equals(payload)) {
    throw new Error(`roundtrip mismatch: got ${roundtrip.length} bytes`);
  }
  console.log(`Roundtrip OK (${roundtrip.length} bytes)`);

  console.log("Deleting...");
  const { error: rmErr } = await supabase.storage
    .from(BUCKET)
    .remove([TEST_PATH]);
  if (rmErr) throw new Error(`delete: ${rmErr.message}`);

  console.log("✓ verify-bucket passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
