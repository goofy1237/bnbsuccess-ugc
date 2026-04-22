# Training Corpus

A curated folder of Ava's own reels that we consider "training-quality" — used as few-shot examples when prompting Claude to generate future scripts.

## What goes here

- `.mp4` files of reels Ava has already posted (or recorded and approved)
- Only content where Ava is the on-camera talent
- Ideally, reels where we have some signal on how they performed

The MP4s themselves are **not committed** — they live locally. Only `README.md` and `metadata.csv` are tracked in git.

## Inclusion criteria

A reel belongs in this corpus only if all of the following are true:

1. **Clear angle.** You can name the angle in a short phrase (e.g. "skeptic-turned-believer", "financial-freedom", "day-in-the-life"). If you can't, skip it.
2. **Performance data known (or strongly suspected).** Top performers are most valuable, but mid and bottom tiers are useful as contrast. Reels with no data at all are lower priority.
3. **Ava's own content.** No stitches, duets, or reposts. The voice and face on camera must be hers.
4. **Clean audio.** No third-party voices, no trending-audio music bed drowning out speech. The spoken script must be clearly the dominant audio.

When in doubt, leave it out — a small high-signal corpus beats a large noisy one.

## metadata.csv format

One row per MP4 in this folder. Columns:

| column | required | description |
|---|---|---|
| `filename` | yes | Exact filename including `.mp4` extension |
| `angle` | yes | Short phrase describing the angle (e.g. `skeptic-turned-believer`) |
| `hook_type` | yes | One of: `skeptic`, `curiosity`, `result_first`, `challenge`, `storytime` |
| `rough_cpm` | no | Approximate CPM if known; leave blank otherwise |
| `rough_ctr` | no | Approximate CTR (as a decimal, e.g. `0.024`); leave blank otherwise |
| `rough_roas` | no | Approximate ROAS if known; leave blank otherwise |
| `performance_tier` | yes | One of: `top`, `mid`, `bottom`, `unknown` |
| `notes` | no | Freeform — anything a future prompt-writer should know |

Rough numeric fields are intentionally "rough" — exact values aren't needed. The tier is what drives few-shot selection; the numbers are context.

## How this will be consumed

A future corpus ingestion script (not yet written) will:

1. Read `metadata.csv` and iterate over each row.
2. Transcribe the referenced `.mp4` (likely via Whisper or an equivalent) into a script.
3. Tag the transcript with its `angle`, `hook_type`, and `performance_tier`.
4. Persist transcripts + metadata into a structured store for later retrieval.
5. At script-generation time, pull a few exemplars — biased toward `top` tier, matching the requested angle/hook — and pass them to Claude as few-shot examples.

Keeping metadata in a plain CSV (rather than embedding it in filenames or a DB) means Ava can edit it directly in a spreadsheet while the corpus is still small.
