begin;

alter table public.openings
  add column opened_by_both boolean not null default false;

alter table public.openings
  add constraint openings_single_or_both_check
  check (not opened_by_both or opened_by_person_id is null);

commit;
