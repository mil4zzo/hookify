-- Normalize ad media detection for app runtime.
-- `creative` remains a raw Meta snapshot; the app should prefer these columns.

alter table public.ads
  add column if not exists primary_video_id text,
  add column if not exists media_type text not null default 'unknown';

update public.ads
set primary_video_id = nullif(
  coalesce(
    case
      when jsonb_typeof(adcreatives_videos_ids) = 'array'
        then nullif(trim(adcreatives_videos_ids ->> 0), '')
      else null
    end,
    nullif(trim(creative_video_id), ''),
    nullif(trim(creative ->> 'video_id'), '')
  ),
  ''
)
where primary_video_id is null;

update public.ads
set media_type = case
  when nullif(trim(primary_video_id), '') is not null then 'video'
  when nullif(trim(thumbnail_url), '') is not null then 'image'
  when nullif(trim(creative ->> 'thumbnail_url'), '') is not null then 'image'
  when nullif(trim(creative ->> 'image_url'), '') is not null then 'image'
  when nullif(trim(creative ->> 'image_hash'), '') is not null then 'image'
  when nullif(trim(thumb_storage_path), '') is not null then 'image'
  when jsonb_typeof(creative -> 'asset_feed_spec' -> 'images') = 'array'
    and jsonb_array_length(creative -> 'asset_feed_spec' -> 'images') > 0 then 'image'
  when jsonb_typeof(creative -> 'object_story_spec' -> 'photo_data') = 'object' then 'image'
  else 'unknown'
end
where media_type = 'unknown'
   or media_type is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ads_media_type_check'
      and conrelid = 'public.ads'::regclass
  ) then
    alter table public.ads
      add constraint ads_media_type_check
      check (media_type in ('video', 'image', 'unknown'));
  end if;
end $$;

create index if not exists ads_primary_video_id_idx
  on public.ads using btree (primary_video_id)
  where primary_video_id is not null;
