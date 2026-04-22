-- ============================================================================
-- BNB Success UGC Pipeline - Initial Schema Migration
-- ============================================================================
-- Creates all tables for the automated UGC ad-creation pipeline:
--   competitor intelligence, script generation, voice/video/broll assets,
--   final ad assembly, performance tracking, prompt library, and briefs.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 0. Utility: auto-update updated_at trigger function
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- --------------------------------------------------------------------------
-- 1. competitor_ads - Scraped competitor intelligence
-- --------------------------------------------------------------------------
CREATE TABLE public.competitor_ads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL CHECK (source IN ('tiktok_cc', 'meta_adlib')),
  advertiser  TEXT,
  hook_text   TEXT,
  structure   TEXT CHECK (structure IN ('problem_solution', 'testimonial', 'listicle', 'storytime')),
  duration_secs INTEGER,
  cta_type    TEXT,
  engagement  JSONB,
  emotional_tone TEXT,
  actor_demo  TEXT,
  scraped_at  TIMESTAMPTZ DEFAULT now(),
  transcript  TEXT,
  tags        TEXT[],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.competitor_ads IS
  'Scraped competitor ad creatives from TikTok Creative Center and Meta Ad Library for angle/hook inspiration.';

ALTER TABLE public.competitor_ads ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_competitor_ads_source     ON public.competitor_ads (source);
CREATE INDEX idx_competitor_ads_structure  ON public.competitor_ads (structure);
CREATE INDEX idx_competitor_ads_scraped_at ON public.competitor_ads (scraped_at);

CREATE TRIGGER trg_competitor_ads_updated_at
  BEFORE UPDATE ON public.competitor_ads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 2. scripts - Generated scripts with performance data
-- --------------------------------------------------------------------------
CREATE TABLE public.scripts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  angle         TEXT,
  hook_type     TEXT CHECK (hook_type IN ('skeptic', 'curiosity', 'result_first', 'challenge')),
  script_plain  TEXT,
  script_tagged TEXT,
  word_count    INTEGER,
  est_duration  INTEGER,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'approved', 'voice_generated', 'face_generated', 'complete', 'live')),
  performance   JSONB,
  source_angles UUID[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.scripts IS
  'AI-generated ad scripts with Fish Audio emotion tags, performance metrics, and lineage back to competitor angles.';

ALTER TABLE public.scripts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_scripts_status    ON public.scripts (status);
CREATE INDEX idx_scripts_hook_type ON public.scripts (hook_type);

CREATE TRIGGER trg_scripts_updated_at
  BEFORE UPDATE ON public.scripts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 3. voice_assets - Fish Audio MP3 outputs
-- --------------------------------------------------------------------------
CREATE TABLE public.voice_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id   UUID NOT NULL REFERENCES public.scripts (id) ON DELETE CASCADE,
  voice_id    TEXT,
  file_url    TEXT,
  file_path   TEXT,
  duration_secs NUMERIC,
  sample_rate INTEGER,
  format      TEXT,
  status      TEXT NOT NULL DEFAULT 'generating'
                CHECK (status IN ('generating', 'complete', 'failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.voice_assets IS
  'Fish Audio TTS voice-over renders linked to their source script.';

ALTER TABLE public.voice_assets ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_voice_assets_script_id ON public.voice_assets (script_id);
CREATE INDEX idx_voice_assets_status    ON public.voice_assets (status);

CREATE TRIGGER trg_voice_assets_updated_at
  BEFORE UPDATE ON public.voice_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 4. video_assets - Lip-synced talking head MP4s
-- --------------------------------------------------------------------------
CREATE TABLE public.video_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id         UUID NOT NULL REFERENCES public.scripts (id) ON DELETE CASCADE,
  voice_asset_id    UUID REFERENCES public.voice_assets (id) ON DELETE SET NULL,
  face_reference_url TEXT,
  file_url          TEXT,
  file_path         TEXT,
  duration_secs     NUMERIC,
  resolution        TEXT,
  provider          TEXT CHECK (provider IN ('kling', 'lipdub', 'sync')),
  status            TEXT NOT NULL DEFAULT 'generating'
                      CHECK (status IN ('generating', 'complete', 'failed')),
  fal_request_id    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.video_assets IS
  'Lip-synced talking-head video renders produced by Kling, LipDub, or Sync providers.';

ALTER TABLE public.video_assets ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_video_assets_script_id      ON public.video_assets (script_id);
CREATE INDEX idx_video_assets_voice_asset_id ON public.video_assets (voice_asset_id);
CREATE INDEX idx_video_assets_status         ON public.video_assets (status);

CREATE TRIGGER trg_video_assets_updated_at
  BEFORE UPDATE ON public.video_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 5. broll_assets - Generated B-roll clips
-- --------------------------------------------------------------------------
CREATE TABLE public.broll_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id   UUID NOT NULL REFERENCES public.scripts (id) ON DELETE CASCADE,
  broll_type  TEXT CHECK (broll_type IN (
                'property_interior', 'booking_dashboard', 'income_screenshot',
                'lifestyle', 'before_after', 'app_demo'
              )),
  prompt      TEXT,
  provider    TEXT CHECK (provider IN ('seedance', 'sora', 'stock')),
  file_url    TEXT,
  file_path   TEXT,
  duration_secs NUMERIC,
  status      TEXT NOT NULL DEFAULT 'generating',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.broll_assets IS
  'AI-generated or stock B-roll clips (property interiors, dashboards, etc.) used as cutaways in final ads.';

ALTER TABLE public.broll_assets ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_broll_assets_script_id ON public.broll_assets (script_id);
CREATE INDEX idx_broll_assets_status    ON public.broll_assets (status);

CREATE TRIGGER trg_broll_assets_updated_at
  BEFORE UPDATE ON public.broll_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 6. finished_ads - Final assembled ad creatives
-- --------------------------------------------------------------------------
CREATE TABLE public.finished_ads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id       UUID NOT NULL REFERENCES public.scripts (id) ON DELETE CASCADE,
  video_asset_id  UUID REFERENCES public.video_assets (id) ON DELETE SET NULL,
  template        TEXT CHECK (template IN (
                    'testimonial_30s', 'result_first_15s', 'storytime_45s', 'listicle_30s'
                  )),
  aspect_ratio    TEXT CHECK (aspect_ratio IN ('9:16', '1:1', '16:9')),
  file_url        TEXT,
  file_path       TEXT,
  duration_secs   NUMERIC,
  resolution      TEXT,
  caption_srt_url TEXT,
  status          TEXT NOT NULL DEFAULT 'assembling'
                    CHECK (status IN ('assembling', 'qa_passed', 'qa_failed', 'complete')),
  qa_results      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.finished_ads IS
  'Fully assembled ad creatives (talking head + B-roll + captions) ready for deployment to Meta/TikTok.';

ALTER TABLE public.finished_ads ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_finished_ads_script_id      ON public.finished_ads (script_id);
CREATE INDEX idx_finished_ads_video_asset_id ON public.finished_ads (video_asset_id);
CREATE INDEX idx_finished_ads_status         ON public.finished_ads (status);

CREATE TRIGGER trg_finished_ads_updated_at
  BEFORE UPDATE ON public.finished_ads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 7. ad_performance - Hyros + Meta metrics per creative
-- --------------------------------------------------------------------------
CREATE TABLE public.ad_performance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_ad_id  UUID NOT NULL REFERENCES public.finished_ads (id) ON DELETE CASCADE,
  script_id       UUID REFERENCES public.scripts (id) ON DELETE SET NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('meta', 'tiktok')),
  cpm             NUMERIC,
  ctr             NUMERIC,
  cpc             NUMERIC,
  hook_rate       NUMERIC,
  hold_rate       NUMERIC,
  cpa             NUMERIC,
  roas            NUMERIC,
  impressions     INTEGER,
  clicks          INTEGER,
  spend           NUMERIC,
  leads           INTEGER,
  calls_booked    INTEGER,
  sales           INTEGER,
  date_range      JSONB,
  fetched_at      TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ad_performance IS
  'Per-creative performance metrics pulled from Hyros (calls/sales/ROAS) and Meta/TikTok (CPM/CTR/spend).';

ALTER TABLE public.ad_performance ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ad_performance_finished_ad_id ON public.ad_performance (finished_ad_id);
CREATE INDEX idx_ad_performance_script_id      ON public.ad_performance (script_id);
CREATE INDEX idx_ad_performance_platform       ON public.ad_performance (platform);
CREATE INDEX idx_ad_performance_fetched_at     ON public.ad_performance (fetched_at);

CREATE TRIGGER trg_ad_performance_updated_at
  BEFORE UPDATE ON public.ad_performance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 8. prompt_library - Few-shot examples for script generation
-- --------------------------------------------------------------------------
CREATE TABLE public.prompt_library (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_text       TEXT,
  performance_score NUMERIC,
  angle             TEXT,
  hook_type         TEXT,
  tone              TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prompt_library IS
  'Curated few-shot script examples ranked by performance score, fed to Claude during script generation.';

ALTER TABLE public.prompt_library ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_prompt_library_is_active ON public.prompt_library (is_active);

CREATE TRIGGER trg_prompt_library_updated_at
  BEFORE UPDATE ON public.prompt_library
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------------
-- 9. creative_briefs - Weekly angle/hook recommendations from Claude
-- --------------------------------------------------------------------------
CREATE TABLE public.creative_briefs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_text       TEXT,
  angles           JSONB,
  hooks            JSONB,
  recommended_tones TEXT[],
  week_of          DATE,
  generated_by     TEXT NOT NULL DEFAULT 'claude',
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'active', 'archived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.creative_briefs IS
  'Weekly creative briefs generated by Claude with recommended angles, hooks, and tones based on recent performance data.';

ALTER TABLE public.creative_briefs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_creative_briefs_status  ON public.creative_briefs (status);
CREATE INDEX idx_creative_briefs_week_of ON public.creative_briefs (week_of);

CREATE TRIGGER trg_creative_briefs_updated_at
  BEFORE UPDATE ON public.creative_briefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
