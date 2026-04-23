-- Create the ugc-assets storage bucket for generated UGC media
-- Public read (for serving to Meta/TikTok via URL), service-role write.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ugc-assets',
  'ugc-assets',
  true,
  104857600, -- 100 MB
  array['video/mp4', 'audio/mpeg', 'audio/wav', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS policies: anon can read, only service_role writes.
-- (service_role bypasses RLS, so we only need to gate anon/authenticated.)

drop policy if exists "ugc_assets_public_read" on storage.objects;
create policy "ugc_assets_public_read"
  on storage.objects for select
  using (bucket_id = 'ugc-assets');
