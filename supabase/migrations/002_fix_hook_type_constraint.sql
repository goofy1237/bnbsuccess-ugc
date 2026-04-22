-- Add 'storytime' to scripts.hook_type CHECK constraint
-- Claude's system prompt includes 'storytime' as a valid hook type
ALTER TABLE public.scripts DROP CONSTRAINT IF EXISTS scripts_hook_type_check;
ALTER TABLE public.scripts ADD CONSTRAINT scripts_hook_type_check
  CHECK (hook_type IN ('skeptic', 'curiosity', 'result_first', 'challenge', 'storytime'));

-- Add RLS policies for service_role access (service_role bypasses RLS,
-- but add explicit policies so anon key works for read-only dashboard access)
CREATE POLICY "Allow read access for anon" ON public.competitor_ads FOR SELECT USING (true);
CREATE POLICY "Allow read access for anon" ON public.scripts FOR SELECT USING (true);
CREATE POLICY "Allow read access for anon" ON public.voice_assets FOR SELECT USING (true);
CREATE POLICY "Allow read access for anon" ON public.video_assets FOR SELECT USING (true);
CREATE POLICY "Allow read access for anon" ON public.broll_assets FOR SELECT USING (true);
CREATE POLICY "Allow read access for anon" ON public.finished_ads FOR SELECT USING (true);
CREATE POLICY "Allow read access for anon" ON public.ad_performance FOR SELECT USING (true);
CREATE POLICY "Allow read access for anon" ON public.prompt_library FOR SELECT USING (true);
CREATE POLICY "Allow read access for anon" ON public.creative_briefs FOR SELECT USING (true);
