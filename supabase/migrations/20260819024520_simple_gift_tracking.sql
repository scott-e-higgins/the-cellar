begin;

alter table public.purchases
  add column acquisition_type text not null default 'purchased',
  add column gift_from text,
  add constraint purchases_acquisition_type_check
    check (acquisition_type in ('purchased', 'gift')),
  add constraint purchases_gift_from_shape_check
    check (acquisition_type = 'gift' or gift_from is null);

create index purchases_household_type_date_idx
  on public.purchases (household_id, acquisition_type, acquisition_date desc);

create table public.gifts_given (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  wine_id uuid not null,
  purchase_item_id uuid not null,
  storage_location_id uuid not null,
  inventory_movement_id uuid not null,
  gifted_to text not null check (length(trim(gifted_to)) > 0),
  gifted_on date not null,
  occasion_note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique (inventory_movement_id, household_id),
  constraint gifts_given_wine_household_fk
    foreign key (wine_id, household_id)
    references public.wines(id, household_id)
    on delete restrict,
  constraint gifts_given_item_household_fk
    foreign key (purchase_item_id, household_id)
    references public.purchase_items(id, household_id)
    on delete restrict,
  constraint gifts_given_location_household_fk
    foreign key (storage_location_id, household_id)
    references public.storage_locations(id, household_id)
    on delete restrict,
  constraint gifts_given_movement_household_fk
    foreign key (inventory_movement_id, household_id)
    references public.inventory_movements(id, household_id)
    on delete restrict
);

create index gifts_given_household_date_idx
  on public.gifts_given (household_id, gifted_on desc);
create index gifts_given_wine_idx
  on public.gifts_given (household_id, wine_id);
create index gifts_given_purchase_item_idx
  on public.gifts_given (household_id, purchase_item_id);
create index gifts_given_location_idx
  on public.gifts_given (household_id, storage_location_id);

alter table public.gifts_given enable row level security;

create policy "Household members can view gifts given"
on public.gifts_given for select
to authenticated
using ((select private.is_household_member(household_id)));

create policy "Household editors can add gifts given"
on public.gifts_given for insert
to authenticated
with check ((select private.can_edit_household(household_id)));

grant select, insert on public.gifts_given to authenticated;

create or replace function public.record_acquisition(
  p_household_id uuid,
  p_acquisition_type text,
  p_acquisition_date date,
  p_purchase_location text,
  p_gift_from text,
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
  acquisition_id uuid;
  acquisition_kind text := coalesce(nullif(trim(p_acquisition_type), ''), 'purchased');
begin
  if acquisition_kind not in ('purchased', 'gift') then
    raise exception 'Acquisition type must be purchased or gift';
  end if;

  acquisition_id := public.record_purchase(
    p_household_id,
    coalesce(p_acquisition_date, current_date),
    case when acquisition_kind = 'purchased' then p_purchase_location else null end,
    case when acquisition_kind = 'purchased' then p_selected_by_person_id else null end,
    case when acquisition_kind = 'purchased' then p_purchased_by_person_id else null end,
    case when acquisition_kind = 'purchased' then p_subtotal else null end,
    case when acquisition_kind = 'purchased' then p_tax else null end,
    case when acquisition_kind = 'purchased' then p_discount else null end,
    case when acquisition_kind = 'purchased' then p_total_cost else null end,
    p_notes,
    p_items
  );

  update public.purchases
  set acquisition_date = p_acquisition_date,
      acquisition_type = acquisition_kind,
      gift_from = case when acquisition_kind = 'gift' then nullif(trim(p_gift_from), '') else null end
  where id = acquisition_id
    and household_id = p_household_id;

  return acquisition_id;
end;
$$;

create or replace function public.gift_bottle(
  p_household_id uuid,
  p_purchase_item_id uuid,
  p_storage_location_id uuid,
  p_gifted_to text,
  p_gifted_on date,
  p_occasion_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item_wine_id uuid;
  movement_id uuid;
  gift_id uuid;
  recipient text := nullif(trim(p_gifted_to), '');
begin
  if not private.can_edit_household(p_household_id) then
    raise exception 'Not authorized to edit this household';
  end if;
  if recipient is null then
    raise exception 'Gifted to is required';
  end if;
  if p_gifted_on is null then
    raise exception 'Gift date is required';
  end if;

  select wine_id
    into item_wine_id
  from public.purchase_items
  where id = p_purchase_item_id
    and household_id = p_household_id;

  if item_wine_id is null then
    raise exception 'Purchase item does not belong to this household';
  end if;

  insert into public.inventory_movements (
    household_id, purchase_item_id, movement_type, quantity,
    from_location_id, occurred_at, reason, created_by
  ) values (
    p_household_id,
    p_purchase_item_id,
    'adjust_out',
    1,
    p_storage_location_id,
    p_gifted_on::timestamptz,
    'Gifted to ' || recipient,
    auth.uid()
  ) returning id into movement_id;

  insert into public.gifts_given (
    household_id, wine_id, purchase_item_id, storage_location_id,
    inventory_movement_id, gifted_to, gifted_on, occasion_note, created_by
  ) values (
    p_household_id,
    item_wine_id,
    p_purchase_item_id,
    p_storage_location_id,
    movement_id,
    recipient,
    p_gifted_on,
    nullif(trim(p_occasion_note), ''),
    auth.uid()
  ) returning id into gift_id;

  return gift_id;
end;
$$;

revoke execute on function public.record_acquisition(uuid, text, date, text, text, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb) from public, anon;
grant execute on function public.record_acquisition(uuid, text, date, text, text, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb) to authenticated;

revoke execute on function public.gift_bottle(uuid, uuid, uuid, text, date, text) from public, anon;
grant execute on function public.gift_bottle(uuid, uuid, uuid, text, date, text) to authenticated;

commit;
