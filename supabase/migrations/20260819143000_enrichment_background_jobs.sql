begin;
create table cellar.enrichment_jobs (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references cellar.households(id) on delete cascade,
 entity_kind text not null check (entity_kind in ('wine','winery')), status text not null default 'running' check (status in ('running','completed','failed')),
 created_by uuid not null references auth.users(id) on delete restrict, processed_count integer not null default 0 check (processed_count>=0),
 failed_count integer not null default 0 check (failed_count>=0), remaining_count integer not null default 0 check (remaining_count>=0), failure_reason text,
 started_at timestamptz not null default now(), completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index enrichment_jobs_one_running_kind_idx on cellar.enrichment_jobs(household_id,entity_kind) where status='running';
create index enrichment_jobs_household_created_idx on cellar.enrichment_jobs(household_id,created_at desc);
create index enrichment_jobs_created_by_idx on cellar.enrichment_jobs(created_by);
create trigger enrichment_jobs_set_updated_at before update on cellar.enrichment_jobs for each row execute function cellar_private.set_updated_at();
alter table cellar.enrichment_jobs enable row level security;
create policy enrichment_jobs_select_member on cellar.enrichment_jobs for select to authenticated using (cellar_private.is_household_member(household_id));
create policy enrichment_jobs_insert_editor on cellar.enrichment_jobs for insert to authenticated with check (cellar_private.can_edit_household(household_id) and created_by=(select auth.uid()));
create policy enrichment_jobs_update_creator on cellar.enrichment_jobs for update to authenticated using (cellar_private.can_edit_household(household_id) and created_by=(select auth.uid())) with check (cellar_private.can_edit_household(household_id) and created_by=(select auth.uid()));
grant select,insert,update on cellar.enrichment_jobs to authenticated;
commit;
