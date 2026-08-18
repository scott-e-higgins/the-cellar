begin;

create or replace function public.move_inventory(
  p_household_id uuid,
  p_purchase_item_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity numeric,
  p_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare movement_id uuid;
begin
  if not private.can_edit_household(p_household_id) then
    raise exception 'Not authorized to edit this household';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  if p_from_location_id = p_to_location_id then raise exception 'Choose a different destination'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_purchase_item_id::text || ':' || p_from_location_id::text, 0));

  insert into public.inventory_movements (
    household_id, purchase_item_id, movement_type, quantity, from_location_id,
    to_location_id, reason, created_by
  ) values (
    p_household_id, p_purchase_item_id, 'move', p_quantity, p_from_location_id,
    p_to_location_id, nullif(trim(p_reason), ''), auth.uid()
  ) returning id into movement_id;
  return movement_id;
end;
$$;

create or replace function public.adjust_inventory(
  p_household_id uuid,
  p_purchase_item_id uuid,
  p_storage_location_id uuid,
  p_quantity_delta numeric,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare movement_id uuid;
begin
  if not private.can_edit_household(p_household_id) then
    raise exception 'Not authorized to edit this household';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then raise exception 'Adjustment cannot be zero'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_purchase_item_id::text || ':' || p_storage_location_id::text, 0));

  insert into public.inventory_movements (
    household_id, purchase_item_id, movement_type, quantity,
    from_location_id, to_location_id, reason, created_by
  ) values (
    p_household_id, p_purchase_item_id,
    case when p_quantity_delta > 0 then 'adjust_in' else 'adjust_out' end,
    abs(p_quantity_delta),
    case when p_quantity_delta < 0 then p_storage_location_id else null end,
    case when p_quantity_delta > 0 then p_storage_location_id else null end,
    trim(p_reason), auth.uid()
  ) returning id into movement_id;
  return movement_id;
end;
$$;

revoke execute on function public.move_inventory(uuid, uuid, uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.adjust_inventory(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.move_inventory(uuid, uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.adjust_inventory(uuid, uuid, uuid, numeric, text) to authenticated;

commit;
