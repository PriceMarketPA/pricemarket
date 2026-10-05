-- Community reported deals are private to the trusted server API.
-- Every report starts under review; publication is a human moderation action.
create table if not exists public.pm_community_deal_reports (
  id uuid primary key default gen_random_uuid(),
  store_name text not null check (char_length(store_name) between 1 and 100),
  item_title text not null check (char_length(item_title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 500),
  city text not null check (city in ('Mechanicsburg', 'Camp Hill', 'Carlisle', 'Harrisburg', 'Hershey')),
  normal_price numeric(9,2) check (normal_price is null or normal_price > 0),
  sale_price numeric(9,2) not null check (sale_price >= 0),
  photo_path text,
  spotted_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'under_review' check (status in ('active', 'expired', 'under_review')),
  confirmation_count integer not null default 0 check (confirmation_count >= 0),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (normal_price is null or sale_price <= normal_price),
  check (photo_path is null or photo_path like 'pending/%')
);
create unique index if not exists pm_community_deal_fingerprint_open_idx
  on public.pm_community_deal_reports (fingerprint) where status in ('under_review', 'active');
create index if not exists pm_community_deal_feed_idx
  on public.pm_community_deal_reports (city, spotted_at desc) where status = 'active';
create index if not exists pm_community_deal_expiration_idx
  on public.pm_community_deal_reports (expires_at) where status = 'active';

create table if not exists public.pm_community_deal_votes (
  deal_id uuid not null references public.pm_community_deal_reports(id) on delete cascade,
  voter_hash text not null check (voter_hash ~ '^[0-9a-f]{64}$'),
  vote_type text not null check (vote_type in ('still_available', 'expired', 'wrong_info')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deal_id, voter_hash)
);
create table if not exists public.pm_community_deal_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  submissions smallint not null default 0 check (submissions between 0 and 3),
  votes smallint not null default 0 check (votes between 0 and 40)
);
create table if not exists public.pm_community_deal_used_challenges (
  challenge_id uuid primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz not null default now()
);

alter table public.pm_community_deal_reports enable row level security;
alter table public.pm_community_deal_reports force row level security;
alter table public.pm_community_deal_votes enable row level security;
alter table public.pm_community_deal_votes force row level security;
alter table public.pm_community_deal_rate_limits enable row level security;
alter table public.pm_community_deal_rate_limits force row level security;
alter table public.pm_community_deal_used_challenges enable row level security;
alter table public.pm_community_deal_used_challenges force row level security;
revoke all on public.pm_community_deal_reports, public.pm_community_deal_votes,
  public.pm_community_deal_rate_limits, public.pm_community_deal_used_challenges
  from public, anon, authenticated;
grant select, insert, update, delete on public.pm_community_deal_reports to service_role;
grant select, insert, update, delete on public.pm_community_deal_votes to service_role;
grant select, insert, update, delete on public.pm_community_deal_rate_limits to service_role;
grant select, insert, update, delete on public.pm_community_deal_used_challenges to service_role;

create or replace function public.pm_submit_community_deal(
  p_store_name text, p_item_title text, p_description text, p_city text,
  p_normal_price numeric, p_sale_price numeric, p_photo_path text, p_fingerprint text, p_ip_hash text, p_challenge_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit public.pm_community_deal_rate_limits%rowtype;
  v_duplicate uuid;
  v_id uuid;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'Invalid community deal request'; end if;
  if p_city not in ('Mechanicsburg', 'Camp Hill', 'Carlisle', 'Harrisburg', 'Hershey') then raise exception 'Invalid city'; end if;
  if char_length(btrim(p_store_name)) not between 1 and 100 or char_length(btrim(p_item_title)) not between 1 and 120
    or char_length(btrim(p_description)) not between 1 and 500 or p_sale_price < 0
    or (p_normal_price is not null and (p_normal_price <= 0 or p_sale_price > p_normal_price)) then
    raise exception 'Invalid community deal fields';
  end if;
  insert into public.pm_community_deal_rate_limits (ip_hash) values (p_ip_hash) on conflict do nothing;
  select * into v_limit from public.pm_community_deal_rate_limits where ip_hash = p_ip_hash for update;
  if v_limit.window_started_at < now() - interval '1 hour' then
    update public.pm_community_deal_rate_limits set window_started_at = now(), submissions = 0, votes = 0 where ip_hash = p_ip_hash;
    v_limit.submissions := 0;
    v_limit.votes := 0;
  end if;
  if v_limit.submissions >= 3 then raise exception 'Community deal submission rate limit reached'; end if;
  delete from public.pm_community_deal_used_challenges where used_at < now() - interval '1 day';
  begin
    insert into public.pm_community_deal_used_challenges (challenge_id, ip_hash) values (p_challenge_id, p_ip_hash);
  exception when unique_violation then
    raise exception 'Community deal challenge already used';
  end;
  update public.pm_community_deal_rate_limits set submissions = submissions + 1 where ip_hash = p_ip_hash;
  select id into v_duplicate from public.pm_community_deal_reports
    where fingerprint = p_fingerprint and status in ('under_review', 'active') limit 1;
  if v_duplicate is not null then return jsonb_build_object('duplicate', true); end if;
  begin
    insert into public.pm_community_deal_reports
      (store_name, item_title, description, city, normal_price, sale_price, photo_path, fingerprint, status)
      values (btrim(p_store_name), btrim(p_item_title), btrim(p_description), p_city, p_normal_price, p_sale_price, p_photo_path, p_fingerprint, 'under_review')
      returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('duplicate', true);
  end;
  return jsonb_build_object('id', v_id, 'status', 'under_review');
end;
$$;

create or replace function public.pm_vote_community_deal(p_deal_id uuid, p_vote_type text, p_voter_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_deal public.pm_community_deal_reports%rowtype;
  v_limit public.pm_community_deal_rate_limits%rowtype;
  v_available integer;
  v_expired integer;
  v_wrong integer;
begin
  if p_voter_hash !~ '^[0-9a-f]{64}$' or p_vote_type not in ('still_available', 'expired', 'wrong_info') then
    raise exception 'Invalid community deal vote';
  end if;
  select * into v_deal from public.pm_community_deal_reports where id = p_deal_id for update;
  if not found or v_deal.status <> 'active' or v_deal.expires_at is null or v_deal.expires_at <= now() then
    raise exception 'This deal is no longer active';
  end if;
  insert into public.pm_community_deal_rate_limits (ip_hash) values (p_voter_hash) on conflict do nothing;
  select * into v_limit from public.pm_community_deal_rate_limits where ip_hash = p_voter_hash for update;
  if v_limit.window_started_at < now() - interval '1 hour' then
    update public.pm_community_deal_rate_limits set window_started_at = now(), submissions = 0, votes = 0 where ip_hash = p_voter_hash;
    v_limit.votes := 0;
  end if;
  if v_limit.votes >= 40 then raise exception 'Community deal vote rate limit reached'; end if;
  update public.pm_community_deal_rate_limits set votes = votes + 1 where ip_hash = p_voter_hash;
  insert into public.pm_community_deal_votes (deal_id, voter_hash, vote_type)
    values (p_deal_id, p_voter_hash, p_vote_type)
    on conflict (deal_id, voter_hash) do update set vote_type = excluded.vote_type, updated_at = now();
  select count(*) filter (where vote_type = 'still_available'), count(*) filter (where vote_type = 'expired'),
    count(*) filter (where vote_type = 'wrong_info')
    into v_available, v_expired, v_wrong from public.pm_community_deal_votes where deal_id = p_deal_id;
  update public.pm_community_deal_reports set
    confirmation_count = v_available,
    expires_at = case when p_vote_type = 'still_available' then now() + interval '7 days' else expires_at end,
    status = case
      when v_wrong >= 3 and v_wrong > v_available then 'under_review'
      when v_expired >= 3 and v_expired > v_available then 'expired'
      else 'active'
    end,
    updated_at = now()
    where id = p_deal_id;
  select * into v_deal from public.pm_community_deal_reports where id = p_deal_id;
  return jsonb_build_object('status', v_deal.status, 'confirmationCount', v_available,
    'expiredCount', v_expired, 'wrongInfoCount', v_wrong, 'expiresAt', v_deal.expires_at);
end;
$$;

create or replace function public.pm_expire_community_deals() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_count integer;
begin
  update public.pm_community_deal_reports set status = 'expired', updated_at = now()
    where status = 'active' and expires_at is not null and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.pm_submit_community_deal(text, text, text, text, numeric, numeric, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.pm_vote_community_deal(uuid, text, text) from public, anon, authenticated;
revoke all on function public.pm_expire_community_deals() from public, anon, authenticated;
grant execute on function public.pm_submit_community_deal(text, text, text, text, numeric, numeric, text, text, text, uuid) to service_role;
grant execute on function public.pm_vote_community_deal(uuid, text, text) to service_role;
grant execute on function public.pm_expire_community_deals() to service_role;
