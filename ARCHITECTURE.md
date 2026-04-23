# Architecture

A developer reference for the pipeline repo. Reflects state as of mid-Phase-1.

## 1. Pipeline at a glance

```
 ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
 │  1. Ideation  │ → │   2. Script   │ → │   3. Voice    │
 │  (stubbed)    │   │   (working)   │   │   (working,   │
 │               │   │               │   │  not DB-wired)│
 └───────────────┘   └───────────────┘   └───────┬───────┘
                                                 │
                                                 ▼
 ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
 │  6. Assembly  │ ← │   5. B-Roll   │ ← │ 4. Lip Sync   │
 │  (stubbed —   │   │   (stubbed —  │   │  (working,    │
 │  no ffmpeg)   │   │  Seedance ok) │   │ not DB-wired) │
 └───────────────┘   └───────────────┘   └───────────────┘

         Feedback loop (Phase 4, not started)
```

Stages 4 and 5 are designed to run in parallel; stages 1, 5, 6 and the feedback loop are scaffolded but not exercised end to end.

## 2. Designed vs current

| Aspect | Designed | Current |
| --- | --- | --- |
| Stages | All 6 stages wired to DB; n8n orchestrates | Stages 2–4 runnable standalone; stages 1/5/6 are code stubs; no orchestration |
| Persistence | Every artifact written to Supabase | Assets hit local `assets/` folders; DB connectivity verified but not used by runtime |
| Face reference | From library keyed by tag | `FACE_REFERENCE_URL` env var; `library.json` exists but stages don't read it yet |
| Feedback | Meta + Hyros pull, Claude analysis, prompt library update | Not started |
| Orchestration | n8n workflow JSON | `n8n/ugc-pipeline-workflow.json` present but not deployed |

## 3. Directory tree

```
src/
  config/           # env loading + validation
  services/         # external API wrappers
    claude-scripts.ts   # Anthropic script + brief generation
    fish-audio.ts       # Fish Audio TTS (generateSpeech OK, createVoiceClone broken)
    kling-lipsync.ts    # fal.ai Kling lip sync + stubbed LipDub/Sync.so fallbacks
    seedance.ts         # fal.ai Seedance (+ Sora fallback) B-roll
    whisper.ts          # OpenAI Whisper + ffprobe duration/resolution helpers
    supabase.ts         # DB + storage client, generic CRUD helpers
    slack.ts            # Webhook notifications
    face-library.ts     # Reads assets/face-reference/library.json
  pipeline/         # stage runners + orchestrator + feedback loop
    orchestrator.ts     stage1-ideation.ts  stage2-script.ts
    stage3-voice.ts     stage4-lipsync.ts   stage5-broll.ts
    stage6-assembly.ts  feedback-loop.ts
  scripts/          # CLI entry points
    batch-generate.ts  test-script-gen.ts  db-smoke.ts
    clone-voice.ts     verify-bucket.ts
  dashboard/        # Hono local web UI (server.ts, index.html, env-writer, script-gen)
  templates/        # ffmpeg-templates.ts (imported by stage6, not yet populated)
  gate-test.ts      # single end-to-end voice + lip sync
  upload-face.ts    # CLI: upload face ref to fal storage
  index.ts          # entry placeholder
supabase/
  migrations/       # 001 initial, 002 hook_type fix, 003 creative library, 004 storage bucket
assets/
  audio/            # generated TTS (gitignored)
  video/            # generated lip-sync output (gitignored)
  face-reference/   # library.json + the active Jordan face MP4
  broll/            # planned — not populated
  exports/          # planned — final assembled ads
  voice-library.json # appended to by clone-voice.ts (broken in practice)
training-corpus/    # scaffolded; metadata.csv + README
n8n/                # ugc-pipeline-workflow.json (not yet deployed)
docs/
  schema-reconciliation.md  # design doc for resolving 001 vs 003 overlap
```

## 4. Service layer

**`claude-scripts.ts`** — Anthropic SDK wrapper. `generateScripts()` fetches top scripts from `prompt_library` for few-shot priming, calls Claude, parses JSON (handles both fenced and raw output). `generateCreativeBrief()` and `analyseWinners()` are implemented but unused. Note the model ID is `claude-opus-4-6-20250219`; `test-script-gen.ts` instead hits `claude-opus-4-7`.

**`fish-audio.ts`** — Fish Audio REST. `generateSpeech()` calls `/v1/tts` with model `s2-pro`, writes the MP3 to `assets/audio/`, returns a duration estimate based on WPM. `createVoiceClone()` calls `https://api.fish.audio/model` with multipart form — **this endpoint is not live and returns 404**. Clone voices in the web UI. `stripEmotionTags()` / `estimateDuration()` are helpers used across the pipeline.

**`kling-lipsync.ts`** — fal.ai client. `runLipSync()` submits to `fal-ai/kling-video/lipsync/audio-to-video`, downloads the result, uses ffprobe to measure real duration. `runLipDubFallback()` and `runSyncFallback()` throw immediately (placeholders). `runLipSyncWithFallback()` chains them.

**`seedance.ts`** — fal.ai Seedance 2.0. `generateBRoll()` with prompt templates per B-roll type (property interior, booking dashboard, income screenshot, lifestyle, before/after, app demo). Sora fallback via OpenAI `responses.create({ model: "sora" })` is written but untested.

**`whisper.ts`** — Whisper captions + `ffprobe` helpers (`getAudioDuration`, `getVideoDuration`, `getVideoResolution`). Only the ffprobe helpers are exercised today.

**`supabase.ts`** — exports `supabase` client (service role if available, anon otherwise), `uploadFile`/`downloadFile`, and generic `insertRow`/`updateRow`/`fetchRows`.

**`slack.ts`** — webhook client + `notifyScriptsReady`, `notifyAdComplete`, `notifyPipelineError`. No-ops silently if webhook URL is blank.

**`face-library.ts`** — reads `assets/face-reference/library.json`, exposes `getRandomFaceReference()` and `getFaceReferenceByTag()`. Not yet imported by the stage runners.

## 5. Pipeline stages

**Stage 1 — Ideation** (`stage1-ideation.ts`): designed to scrape TikTok Creative Center + Meta Ad Library, write to `competitor_ads`, and trigger `generateCreativeBrief()`. Currently a stub with types and placeholders; no scrapers.

**Stage 2 — Script** (`stage2-script.ts`): pulls latest brief or takes explicit angles, calls `generateScripts()`, writes to `scripts` table as drafts, notifies Slack. `approveAllDrafts()` helper flips them to `approved`. Works when the DB is reachable.

**Stage 3 — Voice** (`stage3-voice.ts`): reads approved scripts, calls `generateSpeech()`, uploads MP3 to Supabase storage, inserts `voice_assets`. **Code is complete but has never been run end-to-end against the live DB** — standalone gate tests use `generateSpeech()` directly.

**Stage 4 — Lip Sync** (`stage4-lipsync.ts`): finds scripts with voice but no face, runs Kling with fallback, inserts `video_assets`. Same status as stage 3 — works in isolation via `gate-test.ts`, not exercised from DB rows.

**Stage 5 — B-Roll** (`stage5-broll.ts`): runs Seedance for each approved script, inserts `broll_assets`. Not exercised; B-roll prompt plan lives in the stage file.

**Stage 6 — Assembly** (`stage6-assembly.ts`): imports `ffmpeg-templates.ts` and builds stitch commands for 9:16/1:1/16:9. **Templates file is scaffolded but the command builders haven't been verified against real media.** Whisper caption pass is wired but unused.

All stages currently assume `FACE_REFERENCE_URL` is set in `.env` rather than reading from `face-library.ts`. Migrating them to the library is noted work.

## 6. Database schema

Migrations in `supabase/migrations/`:

- **001 — initial pipeline tables.** `competitor_ads`, `scripts`, `voice_assets`, `video_assets`, `broll_assets`, `finished_ads`, `ad_performance`, `prompt_library`, `creative_briefs`. Stage-output-oriented.
- **002 — constraint fix.** Adds `storytime` to the `scripts.hook_type` CHECK constraint (Claude emits it). Also adds anon read policies.
- **003 — creative asset library.** `creative_assets`, `content_types`, `production_jobs`, `brand_config`, `asset_collections`, `drive_sync_log`. Agent/library-oriented. Seeds 5 content types: `testimonial_30s`, `result_first_15s`, `storytime_45s`, `listicle_30s`, `webinar_promo_30s`.
- **004 — storage bucket.** Creates the `ugc-assets` bucket (public read, service-role write).

**Unresolved ambiguity.** 001 and 003 model the same artifacts in different places — a generated script can live in `scripts.script_tagged`, `creative_assets.script_text`, and `production_jobs.script_tagged` all at once. See `docs/schema-reconciliation.md` for the full overlap map. Wiring stages 3–6 to the DB is blocked on picking one model (or formalising a bridge).

## 7. Dashboard internals

Hono app on port 3000 (`src/dashboard/server.ts`, ~190 LOC):

- `GET /` serves `index.html` (single-page, ~467 LOC, no framework).
- `GET/POST /api/config` — `env-writer.ts` reads/patches `.env` with redacted secrets for the UI.
- `GET /api/face-library`, `POST /api/upload-face` — list and upload face references, writing to both fal storage and `library.json`.
- `POST /api/generate-script` — wraps `dashboard/script-gen.ts` (separate from `services/claude-scripts.ts`, targets `claude-opus-4-7` with the pause-tag prompt).
- Long pipeline runs stream progress via SSE (`streamSSE` from Hono).

Known cut items from the dashboard build: the aspect-ratio indicator on uploaded face refs is informational only (no transcoding), and `duration_secs` on uploads is hardcoded to 0.

## 8. Deferred work (prioritised)

1. **Fix `createVoiceClone()`** — wrong endpoint / 404. Either point at the correct Fish Audio clone API or retire the function and document the web-UI flow as canonical.
2. **Schema reconciliation decision** — pick 001, 003, or a documented bridge. Blocks all DB wiring.
3. **Wire stages 3–4 to DB rows** — `generateSpeech` → `voice_assets`, `runLipSync` → `video_assets`, using whichever schema wins in (2).
4. **Whisper caption automation** — stage 6 imports it but doesn't burn captions in yet.
5. **Seedance B-roll generation** — stage 5 is scaffolded; needs a real run and tuned prompts per script section.
6. **ffmpeg assembly templates** — `src/templates/ffmpeg-templates.ts` imported by stage 6; commands need to be written and tested against a real talking-head + B-roll.
7. **Meta Ads + Hyros integration (Phase 4)** — `feedback-loop.ts` has the shape; needs real credentials and a cron.
8. **Playwright competitor scrapers (stage 1)** — no scraping code exists yet.
