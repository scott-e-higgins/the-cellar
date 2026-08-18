begin;

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema private
  revoke execute on functions from public;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx
  on public.household_members (user_id, household_id);

create or replace function private.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function private.can_edit_household(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household_id
      and user_id = (select auth.uid())
      and role in ('owner', 'editor')
  );
$$;

create or replace function private.is_household_owner(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household_id
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

create or replace function private.storage_household_id(object_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, auth_user_id)
);

create table public.wineries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  country text,
  state text,
  region text,
  city text,
  address text,
  website_url text,
  contact_phone text,
  contact_email text,
  notes text,
  favorite boolean not null default false,
  would_visit_again text check (would_visit_again in ('yes', 'maybe', 'no')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);

create unique index wineries_household_name_unique
  on public.wineries (household_id, lower(name));

create table public.wines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  winery_id uuid,
  name text not null,
  vintage integer check (vintage between 1800 and 2200),
  non_vintage boolean not null default false,
  blend_description text,
  style text,
  category text,
  sweetness text,
  country text,
  state text,
  region text,
  appellation text,
  vineyard text,
  closure text,
  official_winery_notes text,
  personal_notes text,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  constraint wines_winery_household_fk
    foreign key (winery_id, household_id)
    references public.wineries(id, household_id)
    on delete restrict,
  constraint wines_vintage_mode_check
    check (not (non_vintage and vintage is not null))
);

create index wines_search_idx on public.wines (household_id, lower(name));
create index wines_winery_idx on public.wines (household_id, winery_id);

create table public.varietals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  kind text not null default 'grape' check (kind in ('grape', 'fruit', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);

create unique index varietals_household_name_unique
  on public.varietals (household_id, lower(name));

create table public.wine_varietals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  wine_id uuid not null,
  varietal_id uuid not null,
  percentage numeric(5,2) check (percentage > 0 and percentage <= 100),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique (wine_id, varietal_id),
  constraint wine_varietals_wine_household_fk
    foreign key (wine_id, household_id)
    references public.wines(id, household_id)
    on delete cascade,
  constraint wine_varietals_varietal_household_fk
    foreign key (varietal_id, household_id)
    references public.varietals(id, household_id)
    on delete restrict
);

create table public.winery_visits (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  winery_id uuid not null,
  visit_date date not null,
  notes text,
  favorite boolean not null default false,
  would_visit_again text check (would_visit_again in ('yes', 'maybe', 'no')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  constraint winery_visits_winery_household_fk
    foreign key (winery_id, household_id)
    references public.wineries(id, household_id)
    on delete restrict
);

create index winery_visits_date_idx on public.winery_visits (household_id, visit_date desc);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  acquisition_date date not null,
  purchase_location text,
  winery_visit_id uuid,
  selected_by_person_id uuid,
  purchased_by_person_id uuid,
  subtotal numeric(12,2) check (subtotal >= 0),
  tax numeric(12,2) check (tax >= 0),
  discount numeric(12,2) check (discount >= 0),
  total_cost numeric(12,2) check (total_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  constraint purchases_visit_household_fk
    foreign key (winery_visit_id, household_id)
    references public.winery_visits(id, household_id)
    on delete restrict,
  constraint purchases_selector_household_fk
    foreign key (selected_by_person_id, household_id)
    references public.people(id, household_id)
    on delete restrict,
  constraint purchases_buyer_household_fk
    foreign key (purchased_by_person_id, household_id)
    references public.people(id, household_id)
    on delete restrict
);

create index purchases_date_idx on public.purchases (household_id, acquisition_date desc);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  purchase_id uuid not null,
  wine_id uuid not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(12,2) check (unit_price >= 0),
  total_cost numeric(12,2) check (total_cost >= 0),
  current_value_per_bottle numeric(12,2) check (current_value_per_bottle >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  constraint purchase_items_purchase_household_fk
    foreign key (purchase_id, household_id)
    references public.purchases(id, household_id)
    on delete cascade,
  constraint purchase_items_wine_household_fk
    foreign key (wine_id, household_id)
    references public.wines(id, household_id)
    on delete restrict
);

create index purchase_items_wine_idx on public.purchase_items (household_id, wine_id);

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  parent_location_id uuid,
  location_type text not null default 'area',
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  constraint storage_locations_parent_household_fk
    foreign key (parent_location_id, household_id)
    references public.storage_locations(id, household_id)
    on delete restrict
);

create unique index storage_locations_household_name_unique
  on public.storage_locations (household_id, lower(name));

create table public.openings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  wine_id uuid not null,
  opened_at timestamptz not null default now(),
  opened_by_person_id uuid,
  status text not null default 'finished' check (status in ('open', 'finished')),
  enjoyed_with text,
  occasion text,
  memory_notes text,
  issue_type text check (issue_type in ('cork_failed', 'corked', 'oxidized', 'other')),
  issue_notes text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  constraint openings_wine_household_fk
    foreign key (wine_id, household_id)
    references public.wines(id, household_id)
    on delete restrict,
  constraint openings_person_household_fk
    foreign key (opened_by_person_id, household_id)
    references public.people(id, household_id)
    on delete restrict,
  constraint openings_finished_check
    check ((status = 'open' and finished_at is null) or status = 'finished')
);

create index openings_date_idx on public.openings (household_id, opened_at desc);

create table public.tasting_reviews (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  opening_id uuid not null,
  person_id uuid not null,
  rating numeric(2,1) check (rating >= 0.5 and rating <= 5 and rating * 2 = trunc(rating * 2)),
  buy_again text check (buy_again in ('yes', 'maybe', 'no')),
  tasting_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (opening_id, person_id),
  constraint tasting_reviews_opening_household_fk
    foreign key (opening_id, household_id)
    references public.openings(id, household_id)
    on delete cascade,
  constraint tasting_reviews_person_household_fk
    foreign key (person_id, household_id)
    references public.people(id, household_id)
    on delete restrict
);

create table public.wine_preferences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  wine_id uuid not null,
  person_id uuid not null,
  favorite boolean not null default false,
  buy_again text check (buy_again in ('yes', 'maybe', 'no')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (wine_id, person_id),
  constraint wine_preferences_wine_household_fk
    foreign key (wine_id, household_id)
    references public.wines(id, household_id)
    on delete cascade,
  constraint wine_preferences_person_household_fk
    foreign key (person_id, household_id)
    references public.people(id, household_id)
    on delete cascade
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  purchase_item_id uuid not null,
  movement_type text not null check (movement_type in ('receive', 'move', 'open', 'adjust_in', 'adjust_out')),
  quantity numeric(10,2) not null check (quantity > 0),
  from_location_id uuid,
  to_location_id uuid,
  opening_id uuid,
  occurred_at timestamptz not null default now(),
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  constraint inventory_purchase_item_household_fk
    foreign key (purchase_item_id, household_id)
    references public.purchase_items(id, household_id)
    on delete restrict,
  constraint inventory_from_location_household_fk
    foreign key (from_location_id, household_id)
    references public.storage_locations(id, household_id)
    on delete restrict,
  constraint inventory_to_location_household_fk
    foreign key (to_location_id, household_id)
    references public.storage_locations(id, household_id)
    on delete restrict,
  constraint inventory_opening_household_fk
    foreign key (opening_id, household_id)
    references public.openings(id, household_id)
    on delete restrict,
  constraint inventory_movement_shape_check check (
    (movement_type in ('receive', 'adjust_in') and from_location_id is null and to_location_id is not null and opening_id is null)
    or (movement_type = 'move' and from_location_id is not null and to_location_id is not null and from_location_id <> to_location_id and opening_id is null)
    or (movement_type = 'open' and from_location_id is not null and to_location_id is null and opening_id is not null)
    or (movement_type = 'adjust_out' and from_location_id is not null and to_location_id is null and opening_id is null)
  )
);

create index inventory_movements_item_date_idx
  on public.inventory_movements (household_id, purchase_item_id, occurred_at);

create or replace function private.validate_inventory_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item_quantity numeric(10,2);
  item_wine_id uuid;
  source_balance numeric(10,2);
  received_quantity numeric(10,2);
  opening_wine_id uuid;
begin
  select quantity, wine_id
    into item_quantity, item_wine_id
  from public.purchase_items
  where id = new.purchase_item_id
    and household_id = new.household_id
  for update;

  if not found then
    raise exception 'Purchase item does not belong to this household';
  end if;

  if new.movement_type = 'receive' then
    select coalesce(sum(quantity), 0)
      into received_quantity
    from public.inventory_movements
    where household_id = new.household_id
      and purchase_item_id = new.purchase_item_id
      and movement_type = 'receive';

    if received_quantity + new.quantity > item_quantity then
      raise exception 'Received quantity cannot exceed purchased quantity';
    end if;
  end if;

  if new.from_location_id is not null then
    select coalesce(sum(
      case
        when to_location_id = new.from_location_id then quantity
        when from_location_id = new.from_location_id then -quantity
        else 0
      end
    ), 0)
      into source_balance
    from public.inventory_movements
    where household_id = new.household_id
      and purchase_item_id = new.purchase_item_id;

    if source_balance < new.quantity then
      raise exception 'Movement would create negative inventory';
    end if;
  end if;

  if new.movement_type = 'open' then
    select wine_id
      into opening_wine_id
    from public.openings
    where id = new.opening_id
      and household_id = new.household_id;

    if opening_wine_id is distinct from item_wine_id then
      raise exception 'Opening and purchase item must reference the same wine';
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_inventory_movement_before_insert
before insert on public.inventory_movements
for each row execute function private.validate_inventory_movement();

create or replace function private.protect_purchase_item_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  received_quantity numeric(10,2);
  has_movements boolean;
begin
  select coalesce(sum(quantity) filter (where movement_type = 'receive'), 0), count(*) > 0
    into received_quantity, has_movements
  from public.inventory_movements
  where household_id = old.household_id
    and purchase_item_id = old.id;

  if new.quantity < received_quantity then
    raise exception 'Purchased quantity cannot be lower than quantity already received';
  end if;

  if new.wine_id is distinct from old.wine_id and has_movements then
    raise exception 'Wine identity cannot change after inventory history exists';
  end if;

  return new;
end;
$$;

create trigger protect_purchase_item_history_before_update
before update on public.purchase_items
for each row execute function private.protect_purchase_item_history();

create or replace function private.protect_opening_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.wine_id is distinct from old.wine_id and exists (
    select 1
    from public.inventory_movements
    where household_id = old.household_id
      and opening_id = old.id
  ) then
    raise exception 'Wine identity cannot change after opening inventory history exists';
  end if;

  return new;
end;
$$;

create trigger protect_opening_history_before_update
before update on public.openings
for each row execute function private.protect_opening_history();

create or replace function public.record_purchase(
  p_household_id uuid,
  p_acquisition_date date,
  p_purchase_location text,
  p_selected_by_person_id uuid,
  p_purchased_by_person_id uuid,
  p_subtotal numeric,
  p_tax numeric,
  p_discount numeric,
  p_total_cost numeric,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  purchase_id uuid;
  purchase_item_id uuid;
  item jsonb;
begin
  if not private.can_edit_household(p_household_id) then
    raise exception 'Not authorized to edit this household';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one purchase item is required';
  end if;

  insert into public.purchases (
    household_id, acquisition_date, purchase_location,
    selected_by_person_id, purchased_by_person_id,
    subtotal, tax, discount, total_cost, notes
  ) values (
    p_household_id, p_acquisition_date, nullif(trim(p_purchase_location), ''),
    p_selected_by_person_id, p_purchased_by_person_id,
    p_subtotal, p_tax, p_discount, p_total_cost, nullif(trim(p_notes), '')
  ) returning id into purchase_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.purchase_items (
      household_id, purchase_id, wine_id, quantity, unit_price,
      total_cost, current_value_per_bottle, notes
    ) values (
      p_household_id,
      purchase_id,
      (item->>'wine_id')::uuid,
      (item->>'quantity')::numeric,
      nullif(item->>'unit_price', '')::numeric,
      nullif(item->>'total_cost', '')::numeric,
      nullif(item->>'current_value_per_bottle', '')::numeric,
      nullif(trim(item->>'notes'), '')
    ) returning id into purchase_item_id;

    insert into public.inventory_movements (
      household_id, purchase_item_id, movement_type, quantity,
      to_location_id, occurred_at, reason, created_by
    ) values (
      p_household_id,
      purchase_item_id,
      'receive',
      (item->>'quantity')::numeric,
      (item->>'storage_location_id')::uuid,
      p_acquisition_date::timestamptz,
      'Initial receipt',
      auth.uid()
    );
  end loop;

  return purchase_id;
end;
$$;

create or replace function public.open_bottle(
  p_household_id uuid,
  p_purchase_item_id uuid,
  p_storage_location_id uuid,
  p_opened_by_person_id uuid,
  p_opened_at timestamptz,
  p_status text,
  p_enjoyed_with text,
  p_occasion text,
  p_memory_notes text,
  p_issue_type text,
  p_issue_notes text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  wine_id uuid;
  opening_id uuid;
begin
  if not private.can_edit_household(p_household_id) then
    raise exception 'Not authorized to edit this household';
  end if;

  select purchase_items.wine_id
    into wine_id
  from public.purchase_items
  where id = p_purchase_item_id
    and household_id = p_household_id;

  if wine_id is null then
    raise exception 'Purchase item does not belong to this household';
  end if;

  insert into public.openings (
    household_id, wine_id, opened_at, opened_by_person_id, status,
    enjoyed_with, occasion, memory_notes, issue_type, issue_notes, finished_at
  ) values (
    p_household_id,
    wine_id,
    coalesce(p_opened_at, now()),
    p_opened_by_person_id,
    coalesce(p_status, 'finished'),
    nullif(trim(p_enjoyed_with), ''),
    nullif(trim(p_occasion), ''),
    nullif(trim(p_memory_notes), ''),
    p_issue_type,
    nullif(trim(p_issue_notes), ''),
    case when coalesce(p_status, 'finished') = 'finished' then coalesce(p_opened_at, now()) else null end
  ) returning id into opening_id;

  insert into public.inventory_movements (
    household_id, purchase_item_id, movement_type, quantity,
    from_location_id, opening_id, occurred_at, reason, created_by
  ) values (
    p_household_id,
    p_purchase_item_id,
    'open',
    1,
    p_storage_location_id,
    opening_id,
    coalesce(p_opened_at, now()),
    'Bottle opened',
    auth.uid()
  );

  return opening_id;
end;
$$;

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  wine_id uuid,
  winery_id uuid,
  winery_visit_id uuid,
  opening_id uuid,
  purchase_id uuid,
  storage_path text not null,
  original_filename text,
  mime_type text not null,
  file_size_bytes bigint check (file_size_bytes >= 0),
  width integer check (width > 0),
  height integer check (height > 0),
  caption text,
  photographed_at timestamptz,
  sort_order integer not null default 0,
  is_hero boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, storage_path),
  constraint photos_wine_household_fk foreign key (wine_id, household_id) references public.wines(id, household_id) on delete cascade,
  constraint photos_winery_household_fk foreign key (winery_id, household_id) references public.wineries(id, household_id) on delete cascade,
  constraint photos_visit_household_fk foreign key (winery_visit_id, household_id) references public.winery_visits(id, household_id) on delete cascade,
  constraint photos_opening_household_fk foreign key (opening_id, household_id) references public.openings(id, household_id) on delete cascade,
  constraint photos_purchase_household_fk foreign key (purchase_id, household_id) references public.purchases(id, household_id) on delete cascade,
  constraint photos_one_parent_check check (num_nonnulls(wine_id, winery_id, winery_visit_id, opening_id, purchase_id) = 1)
);

create unique index photos_one_wine_hero on public.photos (wine_id) where is_hero and wine_id is not null;
create unique index photos_one_winery_hero on public.photos (winery_id) where is_hero and winery_id is not null;
create unique index photos_one_visit_hero on public.photos (winery_visit_id) where is_hero and winery_visit_id is not null;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  purchase_id uuid not null,
  document_type text not null default 'receipt',
  display_title text not null,
  document_date date,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, storage_path),
  constraint documents_purchase_household_fk
    foreign key (purchase_id, household_id)
    references public.purchases(id, household_id)
    on delete cascade
);

create table public.travel_references (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  purchase_id uuid,
  winery_visit_id uuid,
  opening_id uuid,
  external_system text not null default 'travel-journal',
  external_entity_type text not null default 'trip',
  external_id text not null,
  display_label text,
  deep_link_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  constraint travel_references_purchase_household_fk foreign key (purchase_id, household_id) references public.purchases(id, household_id) on delete cascade,
  constraint travel_references_visit_household_fk foreign key (winery_visit_id, household_id) references public.winery_visits(id, household_id) on delete cascade,
  constraint travel_references_opening_household_fk foreign key (opening_id, household_id) references public.openings(id, household_id) on delete cascade,
  constraint travel_references_one_parent_check check (num_nonnulls(purchase_id, winery_visit_id, opening_id) = 1)
);

create unique index travel_references_target_unique
  on public.travel_references (
    household_id,
    external_system,
    external_entity_type,
    external_id,
    coalesce(purchase_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(winery_visit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(opening_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create or replace view public.inventory_balances
with (security_invoker = true)
as
with entries as (
  select household_id, purchase_item_id, to_location_id as storage_location_id, quantity
  from public.inventory_movements
  where to_location_id is not null
  union all
  select household_id, purchase_item_id, from_location_id as storage_location_id, -quantity
  from public.inventory_movements
  where from_location_id is not null
)
select
  entries.household_id,
  entries.purchase_item_id,
  purchase_items.wine_id,
  entries.storage_location_id,
  sum(entries.quantity)::numeric(10,2) as quantity
from entries
join public.purchase_items
  on purchase_items.id = entries.purchase_item_id
 and purchase_items.household_id = entries.household_id
group by entries.household_id, entries.purchase_item_id, purchase_items.wine_id, entries.storage_location_id
having abs(sum(entries.quantity)) > 0.0001;

create or replace view public.wine_inventory_summary
with (security_invoker = true)
as
select
  wines.household_id,
  wines.id as wine_id,
  coalesce(sum(inventory_balances.quantity), 0)::numeric(10,2) as available_quantity
from public.wines
left join public.inventory_balances
  on inventory_balances.wine_id = wines.id
 and inventory_balances.household_id = wines.household_id
group by wines.household_id, wines.id;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy "Members can view their households"
on public.households for select
to authenticated
using (private.is_household_member(id));

create policy "Owners can update their households"
on public.households for update
to authenticated
using (private.is_household_owner(id))
with check (private.is_household_owner(id));

create policy "Members can view household membership"
on public.household_members for select
to authenticated
using (private.is_household_member(household_id));

create policy "Owners can manage household membership"
on public.household_members for all
to authenticated
using (private.is_household_owner(household_id))
with check (private.is_household_owner(household_id));

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
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy "Household members can view %1$s" on public.%1$I for select to authenticated using (private.is_household_member(household_id))',
      table_name
    );
    execute format(
      'create policy "Household editors can manage %1$s" on public.%1$I for all to authenticated using (private.can_edit_household(household_id)) with check (private.can_edit_household(household_id))',
      table_name
    );
  end loop;
end;
$$;

alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.openings enable row level security;
alter table public.inventory_movements enable row level security;

create policy "Household members can view purchases"
on public.purchases for select
to authenticated
using (private.is_household_member(household_id));

create policy "Household editors can add purchases"
on public.purchases for insert
to authenticated
with check (private.can_edit_household(household_id));

create policy "Household editors can update purchases"
on public.purchases for update
to authenticated
using (private.can_edit_household(household_id))
with check (private.can_edit_household(household_id));

create policy "Household members can view purchase items"
on public.purchase_items for select
to authenticated
using (private.is_household_member(household_id));

create policy "Household editors can add purchase items"
on public.purchase_items for insert
to authenticated
with check (private.can_edit_household(household_id));

create policy "Household editors can update purchase items"
on public.purchase_items for update
to authenticated
using (private.can_edit_household(household_id))
with check (private.can_edit_household(household_id));

create policy "Household members can view openings"
on public.openings for select
to authenticated
using (private.is_household_member(household_id));

create policy "Household editors can add openings"
on public.openings for insert
to authenticated
with check (private.can_edit_household(household_id));

create policy "Household editors can update openings"
on public.openings for update
to authenticated
using (private.can_edit_household(household_id))
with check (private.can_edit_household(household_id));

create policy "Household members can view inventory movements"
on public.inventory_movements for select
to authenticated
using (private.is_household_member(household_id));

create policy "Household editors can add inventory movements"
on public.inventory_movements for insert
to authenticated
with check (private.can_edit_household(household_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'households', 'household_members', 'people', 'wineries', 'wines', 'varietals',
    'winery_visits', 'purchases', 'purchase_items', 'storage_locations', 'openings',
    'tasting_reviews', 'wine_preferences', 'photos', 'documents', 'travel_references'
  ]
  loop
    execute format(
      'create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()',
      table_name
    );
  end loop;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('cellar-photos', 'cellar-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('cellar-documents', 'cellar-documents', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Members can view Cellar files"
on storage.objects for select
to authenticated
using (
  bucket_id in ('cellar-photos', 'cellar-documents')
  and private.is_household_member(private.storage_household_id(name))
);

create policy "Editors can add Cellar files"
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('cellar-photos', 'cellar-documents')
  and private.can_edit_household(private.storage_household_id(name))
);

create policy "Editors can update Cellar files"
on storage.objects for update
to authenticated
using (
  bucket_id in ('cellar-photos', 'cellar-documents')
  and private.can_edit_household(private.storage_household_id(name))
)
with check (
  bucket_id in ('cellar-photos', 'cellar-documents')
  and private.can_edit_household(private.storage_household_id(name))
);

create policy "Editors can delete Cellar files"
on storage.objects for delete
to authenticated
using (
  bucket_id in ('cellar-photos', 'cellar-documents')
  and private.can_edit_household(private.storage_household_id(name))
);

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant usage on schema public, private to authenticated;

grant select on
  public.households,
  public.household_members,
  public.people,
  public.wineries,
  public.wines,
  public.varietals,
  public.wine_varietals,
  public.winery_visits,
  public.purchases,
  public.purchase_items,
  public.storage_locations,
  public.openings,
  public.tasting_reviews,
  public.wine_preferences,
  public.inventory_movements,
  public.photos,
  public.documents,
  public.travel_references,
  public.inventory_balances,
  public.wine_inventory_summary
to authenticated;

grant insert, update, delete on
  public.household_members,
  public.people,
  public.wineries,
  public.wines,
  public.varietals,
  public.wine_varietals,
  public.winery_visits,
  public.storage_locations,
  public.tasting_reviews,
  public.wine_preferences,
  public.photos,
  public.documents,
  public.travel_references
to authenticated;

grant update on public.households to authenticated;
grant insert, update on public.purchases, public.purchase_items, public.openings to authenticated;
grant insert on public.inventory_movements to authenticated;

grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.can_edit_household(uuid) to authenticated;
grant execute on function private.is_household_owner(uuid) to authenticated;
grant execute on function private.storage_household_id(text) to authenticated;
grant execute on function public.record_purchase(uuid, date, text, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb) to authenticated;
grant execute on function public.open_bottle(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text) to authenticated;

commit;
