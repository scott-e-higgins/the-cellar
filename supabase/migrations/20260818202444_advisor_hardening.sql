begin;

-- Pin every helper function's resolution context. These functions only use
-- built-in or fully qualified objects, so an empty search path is safest.
alter function private.set_updated_at() set search_path = '';
alter function private.storage_household_id(text) set search_path = '';

-- Keep the member read policy, but split owner writes by command so the owner
-- policy does not become a second permissive SELECT policy.
drop policy "Owners can manage household membership" on public.household_members;

create policy "Owners can add household membership"
on public.household_members for insert
to authenticated
with check (private.is_household_owner(household_id));

create policy "Owners can update household membership"
on public.household_members for update
to authenticated
using (private.is_household_owner(household_id))
with check (private.is_household_owner(household_id));

create policy "Owners can delete household membership"
on public.household_members for delete
to authenticated
using (private.is_household_owner(household_id));

-- The original generic ALL policies also overlapped the member SELECT policy.
-- Preserve the same editor permissions with command-specific policies.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'people', 'wineries', 'wines', 'varietals', 'wine_varietals',
    'winery_visits', 'storage_locations', 'tasting_reviews', 'wine_preferences',
    'photos', 'documents', 'travel_references'
  ]
  loop
    execute format(
      'drop policy "Household editors can manage %1$s" on public.%1$I',
      table_name
    );
    execute format(
      'create policy "Household editors can add %1$s" on public.%1$I for insert to authenticated with check (private.can_edit_household(household_id))',
      table_name
    );
    execute format(
      'create policy "Household editors can update %1$s" on public.%1$I for update to authenticated using (private.can_edit_household(household_id)) with check (private.can_edit_household(household_id))',
      table_name
    );
    execute format(
      'create policy "Household editors can delete %1$s" on public.%1$I for delete to authenticated using (private.can_edit_household(household_id))',
      table_name
    );
  end loop;
end;
$$;

-- PostgreSQL does not create indexes for referencing foreign-key columns.
-- These indexes cover each FK in constraint-column order for joins and
-- referential actions. Existing household-first product indexes remain useful
-- for the application's household-scoped queries.
create index documents_created_by_idx
  on public.documents (created_by);
create index documents_purchase_fk_idx
  on public.documents (purchase_id, household_id);

create index inventory_movements_from_location_fk_idx
  on public.inventory_movements (from_location_id, household_id);
create index inventory_movements_created_by_idx
  on public.inventory_movements (created_by);
create index inventory_movements_opening_fk_idx
  on public.inventory_movements (opening_id, household_id);
create index inventory_movements_purchase_item_fk_idx
  on public.inventory_movements (purchase_item_id, household_id);
create index inventory_movements_to_location_fk_idx
  on public.inventory_movements (to_location_id, household_id);

create index openings_person_fk_idx
  on public.openings (opened_by_person_id, household_id);
create index openings_wine_fk_idx
  on public.openings (wine_id, household_id);

create index people_auth_user_idx
  on public.people (auth_user_id);

create index photos_created_by_idx
  on public.photos (created_by);
create index photos_opening_fk_idx
  on public.photos (opening_id, household_id);
create index photos_purchase_fk_idx
  on public.photos (purchase_id, household_id);
create index photos_visit_fk_idx
  on public.photos (winery_visit_id, household_id);
create index photos_wine_fk_idx
  on public.photos (wine_id, household_id);
create index photos_winery_fk_idx
  on public.photos (winery_id, household_id);

create index purchase_items_purchase_fk_idx
  on public.purchase_items (purchase_id, household_id);
create index purchase_items_wine_fk_idx
  on public.purchase_items (wine_id, household_id);

create index purchases_buyer_fk_idx
  on public.purchases (purchased_by_person_id, household_id);
create index purchases_selector_fk_idx
  on public.purchases (selected_by_person_id, household_id);
create index purchases_visit_fk_idx
  on public.purchases (winery_visit_id, household_id);

create index storage_locations_parent_fk_idx
  on public.storage_locations (parent_location_id, household_id);

create index tasting_reviews_household_idx
  on public.tasting_reviews (household_id);
create index tasting_reviews_opening_fk_idx
  on public.tasting_reviews (opening_id, household_id);
create index tasting_reviews_person_fk_idx
  on public.tasting_reviews (person_id, household_id);

create index travel_references_opening_fk_idx
  on public.travel_references (opening_id, household_id);
create index travel_references_purchase_fk_idx
  on public.travel_references (purchase_id, household_id);
create index travel_references_visit_fk_idx
  on public.travel_references (winery_visit_id, household_id);

create index wine_preferences_household_idx
  on public.wine_preferences (household_id);
create index wine_preferences_person_fk_idx
  on public.wine_preferences (person_id, household_id);
create index wine_preferences_wine_fk_idx
  on public.wine_preferences (wine_id, household_id);

create index wine_varietals_household_idx
  on public.wine_varietals (household_id);
create index wine_varietals_varietal_fk_idx
  on public.wine_varietals (varietal_id, household_id);
create index wine_varietals_wine_fk_idx
  on public.wine_varietals (wine_id, household_id);

create index winery_visits_winery_fk_idx
  on public.winery_visits (winery_id, household_id);

create index wines_winery_fk_idx
  on public.wines (winery_id, household_id);

commit;
