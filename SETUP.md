# Setup

Zero-to-first-generation for operators and developers. Plan for 30–45 minutes the first time, plus however long Fish Audio takes to train your voice clone.

## 1. Prerequisites

Install these **before** touching the repo.

| Tool | Install | Verify |
| --- | --- | --- |
| Node 18+ (20 LTS recommended) | [nodejs.org](https://nodejs.org) | `node --version` |
| ffmpeg (with ffprobe) | Windows: `winget install ffmpeg` then restart terminal. macOS: `brew install ffmpeg`. Linux: `sudo apt install ffmpeg`. | `ffmpeg -version` and `ffprobe -version` |
| Git | [git-scm.com](https://git-scm.com) | `git --version` |
| A browser | — | — |

## 2. Required accounts and keys

| Service | Signup | Where to find the key | Cost | Without it |
| --- | --- | --- | --- | --- |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | Settings → API Keys | Pay-as-you-go; $5 covers hundreds of script generations | Script generator breaks |
| Fish Audio | [fish.audio](https://fish.audio) | Profile → API Keys. Voice ID is on the cloned voice's page. | **Plus plan ($11/mo) minimum for commercial use.** TTS is cheap past that. | No voice rendering — gate test fails |
| fal.ai | [fal.ai/dashboard](https://fal.ai/dashboard) | Keys section | Pay-as-you-go. Kling lipsync is the dominant cost (~$0.42/s of output). | No lip sync and no face-reference hosting |
| Supabase | [supabase.com](https://supabase.com) | Project Settings → API | Free tier is fine for now | DB smoke test and (future) stage persistence fail; dashboard still works |
| OpenAI | [platform.openai.com](https://platform.openai.com) | API Keys | Pay-as-you-go; optional | Whisper captions and Sora B-roll fallback don't work. Everything else is unaffected. |
| Slack / Telegram / Meta / Hyros | — | — | — | Deferred. Leave blank. |

## 3. Environment file

```bash
cp .env.example .env
```

Then fill in values. Every variable:

| Variable | Required for | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Script generation | Claude script writer |
| `FISH_AUDIO_API_KEY` | Voice rendering | Fish Audio REST auth |
| `FISH_AUDIO_VOICE_ID` | Voice rendering | `reference_id` for the cloned voice |
| `FAL_KEY` | Lip sync + face hosting | fal.ai client credential |
| `FACE_REFERENCE_URL` | Gate test + batch | Public MP4 URL of the face video Kling animates |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | DB smoke + wired stages | Database + storage |
| `OPENAI_API_KEY` | Whisper captions, Sora fallback | Optional |
| `DEFAULT_VOICE_SPEED`, `DEFAULT_VOICE_TEMP`, `TARGET_WPM` | Tuning | Fish Audio defaults; current values are fine |
| `SLACK_*`, `TELEGRAM_*`, `META_*`, `HYROS_*` | Phase 3–4 | Leave placeholder |

Minimum set per workflow:

- **Script generation only** → `ANTHROPIC_API_KEY`.
- **Gate test (voice + lip sync)** → add `FISH_AUDIO_API_KEY`, `FISH_AUDIO_VOICE_ID`, `FAL_KEY`, `FACE_REFERENCE_URL`.
- **Full dashboard** → everything above plus Supabase keys if you want DB features working.

## 4. One-time setup tasks

### Clone your voice on Fish Audio

`createVoiceClone()` in the codebase is broken (wrong endpoint — 404s). Do it in the web UI:

1. Sign into fish.audio, open **Voice Library → Create Voice**.
2. Upload a **1–3 minute expressive sample** (Fish docs' recommendation — varied intonation, no background music, 44.1kHz+).
3. Wait for training. Copy the voice ID from the voice's page.
4. Paste into `.env` as `FISH_AUDIO_VOICE_ID`.

### Upload a face reference

Kling has constraints: **2–60s duration, under 100MB, MP4 or MOV, 720–1920px on each side**. Vertical is recommended for TikTok/Reels (the current active reference is horizontal 1920×1080; Kling accepts it, but the platforms don't love it).

```bash
npx tsx src/upload-face.ts /path/to/your-face.mp4
```

The script prints `FACE_REFERENCE_URL=https://...` — paste that into `.env`. (To also register it in `assets/face-reference/library.json`, use the dashboard's upload tile.)

## 5. Common commands

```bash
npm run dashboard                         # Local UI at http://localhost:3000
npx tsx src/gate-test.ts                  # Single end-to-end voice + lip sync
npx tsx src/scripts/batch-generate.ts     # 3 hardcoded scripts, full batch
npx tsx src/scripts/test-script-gen.ts    # Script generation only — no audio, no spend on Fish/fal
npx tsx src/scripts/db-smoke.ts           # Verify Supabase connectivity
npx tsx src/upload-face.ts <path>         # Upload face ref to fal storage
npx tsx src/scripts/clone-voice.ts <audio> # BROKEN — use Fish Audio web UI instead
```

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `402 Insufficient Balance` | Fish Audio or fal.ai wallet empty | Top up. Budget $20–30 for a week of testing. |
| `404` on voice clone | `createVoiceClone()` endpoint is wrong | Use Fish Audio web UI, paste ID into `.env`. |
| Kling `422 video_url empty` | `FACE_REFERENCE_URL` missing or placeholder | Run `src/upload-face.ts`, copy URL into `.env`. |
| Kling output is 7s when audio is 30s | Face reference is shorter than the audio | Trim or regenerate the face ref so it's at least as long as your longest script. |
| `ffmpeg` / `ffprobe` not recognized | Not on PATH | Install, then restart your terminal. On Windows, close and reopen — PATH updates don't apply to existing shells. |
| Dashboard `Cannot GET /` | Wrong port or process not running | `npm run dashboard`; check nothing else is on port 3000. |
| `ANTHROPIC_API_KEY is not set` | `.env` placeholder not replaced | Paste the real key. |
| `batch-generate` aborts with "STOP: FACE_REFERENCE_URL points to the AI portrait" | Safety guard | Swap to a real face-ref URL before spending money on batch. |

## 7. Cost awareness

- Single generation (30s script) ≈ **$3** — roughly $0.15 Fish Audio + $2.50 Kling (~$0.42/s × ~30s) + pennies Anthropic.
- Batch of 3 ≈ **$9**.
- Budget **$20–30** on each of Fish Audio and fal.ai for a week of testing.
- Anthropic: $5 covers hundreds of script-only runs (`test-script-gen.ts`).
- Costs are real money on real cards. Test with `test-script-gen.ts` (no media spend) first; graduate to `gate-test.ts` (one clip) before running `batch-generate`.
