# BNB UGC Pipeline

BNB Success is an Australian short-term-rental mentorship business that runs on paid UGC video ads. This repo is the in-progress pipeline that turns a written angle into a finished talking-head ad: Claude writes the script, Fish Audio renders a cloned voice, Kling lip-syncs it to a face reference, and (eventually) ffmpeg stitches captions and B-roll. We are mid-Phase-1 — the gate path (voice + lip sync) works end to end, but B-roll, assembly, and ad-platform feedback are not yet wired.

## Who this is for

- **Operators (Ava)** — skip to [Quick start](#quick-start) and the dashboard. You don't need the other docs.
- **Developers** — read [SETUP.md](SETUP.md) for env/keys, then [ARCHITECTURE.md](ARCHITECTURE.md) for the code layout.
- **Stakeholders** — the rest of this file covers what works, what doesn't, and what a run costs.

## Status snapshot

| Component | Status |
| --- | --- |
| Phase 1 gate (voice + lip sync) | ✓ Working |
| Script generation (Claude + pause tags) | ✓ Working |
| Batch generation | ✓ Working |
| Local dashboard UI | ✓ Working |
| Face reference library | ✓ Working |
| Supabase DB connectivity | ✓ Verified |
| Pipeline ↔ DB wiring | ⚠ Partial |
| CapCut editing | ✗ Manual (by design in Phase 1) |
| Meta Ads integration | ✗ Not started (Phase 4) |

## Quick start

1. Install **Node 18+** (20 LTS recommended) and **ffmpeg** on your PATH.
2. `git clone` this repo, then `npm install`.
3. `cp .env.example .env` and fill in at least `ANTHROPIC_API_KEY`, `FISH_AUDIO_API_KEY`, `FISH_AUDIO_VOICE_ID`, `FAL_KEY`, and `FACE_REFERENCE_URL`. See [SETUP.md](SETUP.md) for where to find each one.
4. `npm run dashboard`.
5. Open <http://localhost:3000>.

First working generation should take about 5–10 minutes of setup.

## What a full pipeline run looks like

A script goes in; Fish Audio generates TTS from the cloned voice; the audio and a face-reference MP4 are sent to Kling via fal.ai for lip sync; an MP4 comes back to `assets/video/`. Expect **3–5 minutes** per clip and **about $3** in API spend (Fish Audio pennies + Kling $0.42/s for roughly 30s + a few cents to Anthropic). Don't click Generate casually.

## Known issues

- `createVoiceClone()` in `src/services/fish-audio.ts` 404s against the current Fish Audio API. Clone voices in the Fish Audio web UI instead and copy the voice ID into `.env`.
- Face references uploaded through the dashboard get `duration_secs: 0` recorded in `library.json`. Cosmetic; doesn't affect generation.
- Kling output length is `min(audio_length, face_video_length)` and is not configurable beyond that — if a 30s script comes back as a 7s clip, your face reference is too short.
- Pipeline stages (`src/pipeline/stage*.ts`) are scaffolded but not wired to Supabase rows yet. For now, use `gate-test.ts` / `batch-generate.ts` / the dashboard.
- Migrations 001 and 003 define overlapping tables; see `docs/schema-reconciliation.md`. Pick one model before wiring stages to DB.
- The current active face reference is **horizontal (1920×1080)**. TikTok/Reels want vertical — the dashboard flags this but doesn't crop.
- Every generation spends real money. Test in dev with short scripts first.

## Deeper docs

- [SETUP.md](SETUP.md) — prerequisites, accounts, env vars, commands, troubleshooting, costs.
- [ARCHITECTURE.md](ARCHITECTURE.md) — directory layout, services, stages, schema, deferred work.
