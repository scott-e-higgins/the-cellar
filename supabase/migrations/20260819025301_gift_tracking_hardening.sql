begin;

revoke all on public.gifts_given from public, anon;
grant select, insert on public.gifts_given to authenticated;

create index gifts_given_wine_household_fk_idx
  on public.gifts_given (wine_id, household_id);
create index gifts_given_item_household_fk_idx
  on public.gifts_given (purchase_item_id, household_id);
create index gifts_given_location_household_fk_idx
  on public.gifts_given (storage_location_id, household_id);
create index gifts_given_created_by_idx
  on public.gifts_given (created_by);

commit;
