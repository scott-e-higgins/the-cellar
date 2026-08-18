-- Run only after the household members' Supabase Auth accounts exist.
-- Replace the placeholder UUIDs with their real auth.users IDs.

begin;

with new_household as (
  insert into public.households (name)
  values ('Our Cellar')
  returning id
),
new_people as (
  insert into public.people (household_id, auth_user_id, display_name)
  select id, 'OWNER_AUTH_USER_UUID'::uuid, 'Owner' from new_household
  union all
  select id, 'MEMBER_AUTH_USER_UUID'::uuid, 'Member' from new_household
  returning household_id
)
insert into public.household_members (household_id, user_id, role)
select distinct household_id, 'OWNER_AUTH_USER_UUID'::uuid, 'owner' from new_people
union all
select distinct household_id, 'MEMBER_AUTH_USER_UUID'::uuid, 'editor' from new_people;

insert into public.storage_locations (household_id, name, location_type, sort_order)
select household_id, location_name, 'area', sort_order
from (
  select distinct household_id from public.household_members
) household
cross join (values
  ('Rack', 10),
  ('Wall', 20),
  ('Chill', 30),
  ('Custom Area', 40)
) locations(location_name, sort_order)
on conflict do nothing;

commit;
