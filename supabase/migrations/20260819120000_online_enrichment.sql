begin;

create table public.enrichment_attempts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  wine_id uuid,
  winery_id uuid,
  status text not null default 'searching'
    check (status in ('searching', 'enriched', 'ready_for_review', 'no_match', 'failed', 'rejected')),
  confidence text check (confidence in ('high', 'medium', 'low', 'none')),
  match_type text check (match_type in ('exact', 'general', 'inferred', 'ambiguous', 'none')),
  attempt_type text not null default 'find' check (attempt_type in ('find', 'refresh', 'batch')),
  proposed_data jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_data) = 'object'),
  conflict_data jsonb not null default '{}'::jsonb check (jsonb_typeof(conflict_data) = 'object'),
  match_explanation text,
  provider text,
  model text,
  request_id text,
  auto_accepted boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_reason text,
  usage_data jsonb not null default '{}'::jsonb check (jsonb_typeof(usage_data) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, household_id),
  constraint enrichment_attempts_one_entity_check check (num_nonnulls(wine_id, winery_id) = 1),
  constraint enrichment_attempts_wine_household_fk
    foreign key (wine_id, household_id) references public.wines(id, household_id) on delete cascade,
  constraint enrichment_attempts_winery_household_fk
    foreign key (winery_id, household_id) references public.wineries(id, household_id) on delete cascade
);

create index enrichment_attempts_wine_idx
  on public.enrichment_attempts (household_id, wine_id, created_at desc)
  where wine_id is not null;
create index enrichment_attempts_winery_idx
  on public.enrichment_attempts (household_id, winery_id, created_at desc)
  where winery_id is not null;
create index enrichment_attempts_status_idx
  on public.enrichment_attempts (household_id, status, created_at desc);

create table public.enrichment_sources (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  attempt_id uuid not null,
  source_name text not null,
  source_url text not null check (source_url ~* '^https?://'),
  source_type text not null
    check (source_type in ('official_winery', 'producer_technical_sheet', 'official_pdf', 'official_distributor', 'wine_database', 'professional_source', 'retailer', 'tourism_organization', 'official_business', 'secondary', 'other')),
  exact_match boolean not null default false,
  contributed_fields text[] not null default '{}',
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint enrichment_sources_attempt_household_fk
    foreign key (attempt_id, household_id) references public.enrichment_attempts(id, household_id) on delete cascade
);

create index enrichment_sources_attempt_idx
  on public.enrichment_sources (household_id, attempt_id);

create table public.wine_online_info (
  wine_id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  accepted_data jsonb not null default '{}'::jsonb check (jsonb_typeof(accepted_data) = 'object'),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  match_type text not null check (match_type in ('exact', 'general', 'inferred')),
  accepted_attempt_id uuid not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz not null default now(),
  last_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wine_id, household_id),
  constraint wine_online_info_wine_household_fk
    foreign key (wine_id, household_id) references public.wines(id, household_id) on delete cascade,
  constraint wine_online_info_attempt_household_fk
    foreign key (accepted_attempt_id, household_id) references public.enrichment_attempts(id, household_id) on delete restrict
);

create table public.winery_online_info (
  winery_id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  accepted_data jsonb not null default '{}'::jsonb check (jsonb_typeof(accepted_data) = 'object'),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  match_type text not null check (match_type in ('exact', 'general', 'inferred')),
  accepted_attempt_id uuid not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz not null default now(),
  last_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (winery_id, household_id),
  constraint winery_online_info_winery_household_fk
    foreign key (winery_id, household_id) references public.wineries(id, household_id) on delete cascade,
  constraint winery_online_info_attempt_household_fk
    foreign key (accepted_attempt_id, household_id) references public.enrichment_attempts(id, household_id) on delete restrict
);

create trigger wine_online_info_set_updated_at
before update on public.wine_online_info
for each row execute function private.set_updated_at();

create trigger winery_online_info_set_updated_at
before update on public.winery_online_info
for each row execute function private.set_updated_at();

alter table public.enrichment_attempts enable row level security;
alter table public.enrichment_sources enable row level security;
alter table public.wine_online_info enable row level security;
alter table public.winery_online_info enable row level security;

create policy enrichment_attempts_select_member on public.enrichment_attempts
for select to authenticated using (private.is_household_member(household_id));
create policy enrichment_attempts_insert_editor on public.enrichment_attempts
for insert to authenticated with check (
  private.can_edit_household(household_id)
  and created_by = (select auth.uid())
);
create policy enrichment_attempts_update_editor on public.enrichment_attempts
for update to authenticated using (private.can_edit_household(household_id))
with check (private.can_edit_household(household_id));

create policy enrichment_sources_select_member on public.enrichment_sources
for select to authenticated using (private.is_household_member(household_id));
create policy enrichment_sources_insert_editor on public.enrichment_sources
for insert to authenticated with check (private.can_edit_household(household_id));

create policy wine_online_info_select_member on public.wine_online_info
for select to authenticated using (private.is_household_member(household_id));
create policy winery_online_info_select_member on public.winery_online_info
for select to authenticated using (private.is_household_member(household_id));

create or replace function public.accept_enrichment_attempt(
  p_attempt_id uuid,
  p_edited_data jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.enrichment_attempts%rowtype;
  final_data jsonb;
begin
  select * into attempt
  from public.enrichment_attempts
  where id = p_attempt_id;

  if attempt.id is null
     or (select auth.uid()) is null
     or not private.can_edit_household(attempt.household_id) then
    raise exception 'Enrichment attempt not found or not authorized';
  end if;

  if attempt.status not in ('ready_for_review', 'enriched') then
    raise exception 'Only completed enrichment attempts can be accepted';
  end if;

  final_data := coalesce(p_edited_data, attempt.proposed_data);
  if final_data is null or jsonb_typeof(final_data) <> 'object' then
    raise exception 'Accepted enrichment data must be a JSON object';
  end if;

  if attempt.wine_id is not null then
    insert into public.wine_online_info (
      wine_id, household_id, accepted_data, confidence, match_type,
      accepted_attempt_id, accepted_by, accepted_at, last_refreshed_at
    ) values (
      attempt.wine_id, attempt.household_id, final_data,
      coalesce(nullif(attempt.confidence, 'none'), 'medium'),
      case when attempt.match_type in ('exact', 'general', 'inferred') then attempt.match_type else 'inferred' end,
      attempt.id, (select auth.uid()), now(), now()
    )
    on conflict (wine_id) do update set
      accepted_data = excluded.accepted_data,
      confidence = excluded.confidence,
      match_type = excluded.match_type,
      accepted_attempt_id = excluded.accepted_attempt_id,
      accepted_by = excluded.accepted_by,
      accepted_at = excluded.accepted_at,
      last_refreshed_at = excluded.last_refreshed_at;
  else
    insert into public.winery_online_info (
      winery_id, household_id, accepted_data, confidence, match_type,
      accepted_attempt_id, accepted_by, accepted_at, last_refreshed_at
    ) values (
      attempt.winery_id, attempt.household_id, final_data,
      coalesce(nullif(attempt.confidence, 'none'), 'medium'),
      case when attempt.match_type in ('exact', 'general', 'inferred') then attempt.match_type else 'inferred' end,
      attempt.id, (select auth.uid()), now(), now()
    )
    on conflict (winery_id) do update set
      accepted_data = excluded.accepted_data,
      confidence = excluded.confidence,
      match_type = excluded.match_type,
      accepted_attempt_id = excluded.accepted_attempt_id,
      accepted_by = excluded.accepted_by,
      accepted_at = excluded.accepted_at,
      last_refreshed_at = excluded.last_refreshed_at;
  end if;

  update public.enrichment_attempts
  set status = 'enriched', reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = attempt.id;
end;
$$;

create or replace function public.reject_enrichment_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.enrichment_attempts%rowtype;
begin
  select * into attempt from public.enrichment_attempts where id = p_attempt_id;
  if attempt.id is null
     or (select auth.uid()) is null
     or not private.can_edit_household(attempt.household_id) then
    raise exception 'Enrichment attempt not found or not authorized';
  end if;
  update public.enrichment_attempts
  set status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = attempt.id;
end;
$$;

revoke all on function public.accept_enrichment_attempt(uuid, jsonb) from public, anon;
grant execute on function public.accept_enrichment_attempt(uuid, jsonb) to authenticated;
revoke all on function public.reject_enrichment_attempt(uuid) from public, anon;
grant execute on function public.reject_enrichment_attempt(uuid) to authenticated;

grant select, insert, update on public.enrichment_attempts to authenticated;
grant select, insert on public.enrichment_sources to authenticated;
grant select on public.wine_online_info to authenticated;
grant select on public.winery_online_info to authenticated;

commit;
