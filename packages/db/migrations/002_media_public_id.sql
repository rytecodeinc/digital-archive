-- Opaque public IDs for stable /photo/:id deep links (Google Photos–style).
alter table media add column if not exists public_id text;

update media
set public_id = rtrim(
  translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'),
  '='
)
where public_id is null;

alter table media alter column public_id set not null;

create unique index if not exists media_public_id_uidx on media (public_id);
