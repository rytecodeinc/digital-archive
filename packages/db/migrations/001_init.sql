-- Digital Archive — Phase 1 schema
create extension if not exists citext;
create extension if not exists pgcrypto;

create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  display_name    text not null,
  password_hash   text,
  avatar_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists archives (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references users(id),
  title           text not null default 'Travel Archive',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists ownership_transfers (
  id              uuid primary key default gen_random_uuid(),
  archive_id      uuid not null references archives(id) on delete cascade,
  from_user_id    uuid not null references users(id),
  to_user_id      uuid not null references users(id),
  status          text not null check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz
);

create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  token_hash      bytea not null unique,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
create index if not exists sessions_user_id_idx on sessions(user_id);

do $$ begin
  create type media_type as enum ('photo', 'video');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type media_status as enum ('pending_upload', 'processing', 'ready', 'failed', 'deleted');
exception when duplicate_object then null;
end $$;

create table if not exists media (
  id                  uuid primary key default gen_random_uuid(),
  archive_id          uuid not null references archives(id),
  uploaded_by         uuid not null references users(id),
  type                media_type not null default 'photo',
  status              media_status not null default 'pending_upload',
  taken_at            timestamptz,
  taken_at_source     text check (taken_at_source in ('exif', 'client', 'upload')),
  uploaded_at         timestamptz not null default now(),
  sort_at             timestamptz not null,
  content_hash        bytea,
  byte_size           bigint,
  mime_type           text not null,
  width               int,
  height              int,
  duration_ms         int,
  r2_original_key     text not null unique,
  r2_thumb_key        text,
  r2_preview_key      text,
  r2_video_poster_key text,
  caption             text,
  alt_text            text,
  location_name       text,
  latitude            double precision,
  longitude           double precision,
  exif_json           jsonb,
  client_local_id     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists media_timeline_idx
  on media (archive_id, sort_at desc, id desc)
  where deleted_at is null and status = 'ready';

create unique index if not exists media_archive_hash_uidx
  on media (archive_id, content_hash)
  where content_hash is not null and deleted_at is null;

create unique index if not exists media_archive_client_local_uidx
  on media (archive_id, client_local_id)
  where client_local_id is not null;

do $$ begin
  create type album_visibility as enum ('private', 'unlisted', 'public');
exception when duplicate_object then null;
end $$;

create table if not exists albums (
  id              uuid primary key default gen_random_uuid(),
  archive_id      uuid not null references archives(id),
  year            int not null,
  location_slug   text not null,
  title           text not null,
  description     text,
  visibility      album_visibility not null default 'private',
  cover_media_id  uuid references media(id) on delete set null,
  start_date      date,
  end_date        date,
  media_count     int not null default 0,
  photo_count     int not null default 0,
  video_count     int not null default 0,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (archive_id, year, location_slug)
);

create table if not exists album_media (
  album_id        uuid not null references albums(id) on delete cascade,
  media_id        uuid not null references media(id) on delete cascade,
  position        bigint not null,
  added_at        timestamptz not null default now(),
  primary key (album_id, media_id)
);

create unique index if not exists album_media_position_uidx
  on album_media (album_id, position);

create index if not exists album_media_media_id_idx
  on album_media (media_id);

create table if not exists schema_migrations (
  id          text primary key,
  applied_at  timestamptz not null default now()
);
