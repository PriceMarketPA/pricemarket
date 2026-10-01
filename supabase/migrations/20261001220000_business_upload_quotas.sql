-- Private, server-only quota ledger for pending business media uploads.
create table if not exists public.pm_business_upload_sessions (
  submission_id uuid primary key,
  challenge_id uuid not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  gallery_issue_count smallint not null default 0 check (gallery_issue_count between 0 and 10)
);

create table if not exists public.pm_business_upload_slots (
  submission_id uuid not null references public.pm_business_upload_sessions(submission_id) on delete cascade,
  role text not null check (role in ('logo', 'cover', 'document', 'gallery-1', 'gallery-2', 'gallery-3', 'gallery-4', 'gallery-5')),
  issue_count smallint not null default 0 check (issue_count between 0 and 5),
  active_path text,
  previous_path text,
  status text not null default 'empty' check (status in ('empty', 'issued', 'uploaded', 'removed')),
  updated_at timestamptz not null default now(),
  primary key (submission_id, role)
);

create table if not exists public.pm_business_upload_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  session_count smallint not null default 0 check (session_count between 0 and 10)
);

alter table public.pm_business_upload_sessions enable row level security;
alter table public.pm_business_upload_sessions force row level security;
alter table public.pm_business_upload_slots enable row level security;
alter table public.pm_business_upload_slots force row level security;
alter table public.pm_business_upload_rate_limits enable row level security;
alter table public.pm_business_upload_rate_limits force row level security;
revoke all on public.pm_business_upload_sessions from anon, authenticated;
revoke all on public.pm_business_upload_slots from anon, authenticated;
revoke all on public.pm_business_upload_rate_limits from anon, authenticated;
grant all on public.pm_business_upload_sessions to service_role;
grant all on public.pm_business_upload_slots to service_role;
grant all on public.pm_business_upload_rate_limits to service_role;

create or replace function public.pm_create_business_upload_session(
  p_submission_id uuid,
  p_challenge_id uuid,
  p_expires_at timestamptz,
  p_ip_hash text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate public.pm_business_upload_rate_limits%rowtype;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid upload request context'; end if;
  insert into public.pm_business_upload_rate_limits (ip_hash) values (p_ip_hash) on conflict do nothing;
  select * into v_rate from public.pm_business_upload_rate_limits where ip_hash = p_ip_hash for update;
  if v_rate.window_started_at < now() - interval '1 hour' then
    update public.pm_business_upload_rate_limits set window_started_at = now(), session_count = 0 where ip_hash = p_ip_hash;
    v_rate.session_count := 0;
  end if;
  if v_rate.session_count >= 10 then raise exception 'Upload session rate limit reached'; end if;
  if exists (select 1 from public.pm_business_upload_sessions where challenge_id = p_challenge_id) then
    raise exception 'This upload challenge has already been used';
  end if;
  insert into public.pm_business_upload_sessions (submission_id, challenge_id, expires_at)
    values (p_submission_id, p_challenge_id, p_expires_at);
  update public.pm_business_upload_rate_limits set session_count = session_count + 1 where ip_hash = p_ip_hash;
  return true;
end;
$$;

create or replace function public.pm_reserve_business_upload_slot(
  p_submission_id uuid,
  p_role text,
  p_object_path text,
  p_replace_path text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.pm_business_upload_sessions%rowtype;
  v_slot public.pm_business_upload_slots%rowtype;
  v_gallery_slots integer;
begin
  if p_role not in ('logo', 'cover', 'document', 'gallery-1', 'gallery-2', 'gallery-3', 'gallery-4', 'gallery-5') then
    raise exception 'Unsupported upload role';
  end if;

  select * into v_session
    from public.pm_business_upload_sessions
    where submission_id = p_submission_id and expires_at > now()
    for update;
  if not found then raise exception 'Upload session expired'; end if;

  select * into v_slot from public.pm_business_upload_slots
    where submission_id = p_submission_id and role = p_role for update;
  if not found then
    if p_role like 'gallery-%' then
      select count(*) into v_gallery_slots from public.pm_business_upload_slots
        where submission_id = p_submission_id and role like 'gallery-%' and status in ('issued', 'uploaded');
      if v_gallery_slots >= 5 then raise exception 'Gallery is limited to five files'; end if;
    end if;
    insert into public.pm_business_upload_slots (submission_id, role) values (p_submission_id, p_role);
    select * into v_slot from public.pm_business_upload_slots
      where submission_id = p_submission_id and role = p_role for update;
  end if;

  if v_slot.issue_count >= 5 then raise exception 'Upload replacement limit reached for this slot'; end if;
  if p_role like 'gallery-%' and v_session.gallery_issue_count >= 10 then
    raise exception 'Gallery upload limit reached for this submission';
  end if;

  if v_slot.status in ('issued', 'uploaded') then
    if v_slot.status <> 'uploaded' or p_replace_path is null or p_replace_path <> v_slot.active_path then
      raise exception 'This upload slot is already in use';
    end if;
  elsif p_replace_path is not null then
    raise exception 'The file selected for replacement is no longer active';
  end if;

  update public.pm_business_upload_slots set
    previous_path = case when v_slot.status = 'uploaded' then v_slot.active_path else null end,
    active_path = p_object_path,
    issue_count = issue_count + 1,
    status = 'issued',
    updated_at = now()
    where submission_id = p_submission_id and role = p_role;
  if p_role like 'gallery-%' then
    update public.pm_business_upload_sessions set gallery_issue_count = gallery_issue_count + 1
      where submission_id = p_submission_id;
  end if;
  return true;
end;
$$;

create or replace function public.pm_finalize_business_upload_slot(
  p_submission_id uuid,
  p_role text,
  p_object_path text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.pm_business_upload_slots%rowtype;
begin
  if not exists (select 1 from public.pm_business_upload_sessions where submission_id = p_submission_id and expires_at > now()) then
    raise exception 'Upload session expired';
  end if;
  select * into v_slot from public.pm_business_upload_slots
    where submission_id = p_submission_id and role = p_role for update;
  if not found or v_slot.status <> 'issued' or v_slot.active_path <> p_object_path then
    raise exception 'Upload reservation does not match';
  end if;
  update public.pm_business_upload_slots set status = 'uploaded', updated_at = now()
    where submission_id = p_submission_id and role = p_role;
  return v_slot.previous_path;
end;
$$;

create or replace function public.pm_remove_business_upload_slot_file(
  p_submission_id uuid,
  p_role text,
  p_object_path text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.pm_business_upload_slots%rowtype;
begin
  if not exists (select 1 from public.pm_business_upload_sessions where submission_id = p_submission_id and expires_at > now()) then
    raise exception 'Upload session expired';
  end if;
  select * into v_slot from public.pm_business_upload_slots
    where submission_id = p_submission_id and role = p_role for update;
  if not found then return false; end if;
  if v_slot.active_path = p_object_path then
    if v_slot.status = 'issued' and v_slot.previous_path is not null then
      update public.pm_business_upload_slots set active_path = previous_path, previous_path = null, status = 'uploaded', updated_at = now()
        where submission_id = p_submission_id and role = p_role;
    else
      update public.pm_business_upload_slots set active_path = null, previous_path = null, status = 'removed', updated_at = now()
        where submission_id = p_submission_id and role = p_role;
    end if;
    return true;
  end if;
  if v_slot.previous_path = p_object_path then
    update public.pm_business_upload_slots set previous_path = null, updated_at = now()
      where submission_id = p_submission_id and role = p_role;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.pm_reserve_business_upload_slot(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.pm_create_business_upload_session(uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.pm_finalize_business_upload_slot(uuid, text, text) from public, anon, authenticated;
revoke all on function public.pm_remove_business_upload_slot_file(uuid, text, text) from public, anon, authenticated;
grant execute on function public.pm_reserve_business_upload_slot(uuid, text, text, text) to service_role;
grant execute on function public.pm_create_business_upload_session(uuid, uuid, timestamptz, text) to service_role;
grant execute on function public.pm_finalize_business_upload_slot(uuid, text, text) to service_role;
grant execute on function public.pm_remove_business_upload_slot_file(uuid, text, text) to service_role;

