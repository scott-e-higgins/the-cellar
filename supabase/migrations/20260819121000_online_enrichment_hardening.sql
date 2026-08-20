begin;

alter function cellar.accept_enrichment_attempt(uuid, jsonb) security invoker;
alter function cellar.reject_enrichment_attempt(uuid) security invoker;

create policy wine_online_info_insert_editor on cellar.wine_online_info
for insert to authenticated with check (cellar_private.can_edit_household(household_id));
create policy wine_online_info_update_editor on cellar.wine_online_info
for update to authenticated using (cellar_private.can_edit_household(household_id))
with check (cellar_private.can_edit_household(household_id));

create policy winery_online_info_insert_editor on cellar.winery_online_info
for insert to authenticated with check (cellar_private.can_edit_household(household_id));
create policy winery_online_info_update_editor on cellar.winery_online_info
for update to authenticated using (cellar_private.can_edit_household(household_id))
with check (cellar_private.can_edit_household(household_id));

grant insert, update on cellar.wine_online_info to authenticated;
grant insert, update on cellar.winery_online_info to authenticated;

create index enrichment_attempts_created_by_idx on cellar.enrichment_attempts (created_by);
create index enrichment_attempts_reviewed_by_idx on cellar.enrichment_attempts (reviewed_by) where reviewed_by is not null;
create index enrichment_attempts_wine_household_fk_idx on cellar.enrichment_attempts (wine_id, household_id) where wine_id is not null;
create index enrichment_attempts_winery_household_fk_idx on cellar.enrichment_attempts (winery_id, household_id) where winery_id is not null;
create index enrichment_sources_attempt_household_fk_idx on cellar.enrichment_sources (attempt_id, household_id);
create index wine_online_info_household_idx on cellar.wine_online_info (household_id);
create index wine_online_info_attempt_household_fk_idx on cellar.wine_online_info (accepted_attempt_id, household_id);
create index wine_online_info_accepted_by_idx on cellar.wine_online_info (accepted_by) where accepted_by is not null;
create index winery_online_info_household_idx on cellar.winery_online_info (household_id);
create index winery_online_info_attempt_household_fk_idx on cellar.winery_online_info (accepted_attempt_id, household_id);
create index winery_online_info_accepted_by_idx on cellar.winery_online_info (accepted_by) where accepted_by is not null;

commit;
