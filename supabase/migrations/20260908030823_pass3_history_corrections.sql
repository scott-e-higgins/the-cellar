-- Focused corrections only: identities, quantities, bottle status and movements
-- are never recreated. Existing RLS and household permissions remain in force.
create or replace function cellar.correct_history_record(
 p_household_id uuid,p_kind text,p_record_id uuid,p_fields jsonb,p_confirm_relationship boolean default false
) returns uuid language plpgsql security invoker set search_path='' as $$
declare p cellar.purchases%rowtype; g cellar.gifts_given%rowtype; v cellar.winery_visits%rowtype;
 vr cellar.travel_references%rowtype; pr cellar.travel_references%rowtype; next_date date; next_visit uuid; next_gift_date date;
begin
 if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household'; end if;
 if p_kind='purchase' then
  select * into p from cellar.purchases where id=p_record_id and household_id=p_household_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  next_date:=case when p_fields?'acquisition_date' then nullif(p_fields->>'acquisition_date','')::date else p.acquisition_date end;
  next_visit:=case when p_fields?'winery_visit_id' then nullif(p_fields->>'winery_visit_id','')::uuid else p.winery_visit_id end;
  if next_visit is not null and (p_fields?'winery_visit_id' or p_fields?'acquisition_date') then
   select * into v from cellar.winery_visits where id=next_visit and household_id=p_household_id for share;
   if not found then raise exception 'Visit not found'; end if;
   select * into vr from cellar.travel_references where household_id=p_household_id and winery_visit_id=next_visit and external_system='travel-journal' and external_entity_type='trip' limit 1;
   select * into pr from cellar.travel_references where household_id=p_household_id and purchase_id=p.id and external_system='travel-journal' and external_entity_type='trip' limit 1 for update;
   if not p_confirm_relationship and (next_date is null or abs(next_date-v.visit_date)>7 or (vr.id is not null and pr.id is not null and vr.external_id<>pr.external_id) or not exists(select 1 from cellar.purchase_items i join cellar.wines w on w.id=i.wine_id and w.household_id=i.household_id where i.purchase_id=p.id and i.household_id=p_household_id and w.winery_id=v.winery_id)) then
    raise exception 'Confirm this purchase belongs to the selected visit. Dates are kept unchanged.';
   end if;
   if vr.id is not null then
    if pr.id is not null then
     update cellar.travel_references set external_id=vr.external_id,display_label=vr.display_label,deep_link_path=vr.deep_link_path where id=pr.id and household_id=p_household_id;
    else
     insert into cellar.travel_references(household_id,purchase_id,external_system,external_entity_type,external_id,display_label,deep_link_path) values(p_household_id,p.id,'travel-journal','trip',vr.external_id,vr.display_label,vr.deep_link_path);
    end if;
   end if;
  end if;
  update cellar.purchases set acquisition_date=next_date,winery_visit_id=next_visit,
   purchase_location=case when p_fields?'purchase_location' then nullif(trim(p_fields->>'purchase_location'),'') else p.purchase_location end,
   gift_from=case when p_fields?'gift_from' then nullif(trim(p_fields->>'gift_from'),'') else p.gift_from end,
   notes=case when p_fields?'notes' then nullif(p_fields->>'notes','') else p.notes end,
   total_cost=case when p_fields?'total_cost' then nullif(p_fields->>'total_cost','')::numeric else p.total_cost end
  where id=p.id and household_id=p_household_id;
 elsif p_kind='gift' then
  select * into g from cellar.gifts_given where id=p_record_id and household_id=p_household_id for update;
  if not found then raise exception 'Gift not found'; end if;
  if p_fields?'gifted_to' and nullif(trim(p_fields->>'gifted_to'),'') is null then raise exception 'Gift recipient is required'; end if;
  next_gift_date:=case when p_fields?'gifted_on' then (p_fields->>'gifted_on')::date else g.gifted_on end;
  if next_gift_date is null then raise exception 'Gift date is required'; end if;
  update cellar.gifts_given set gifted_to=case when p_fields?'gifted_to' then trim(p_fields->>'gifted_to') else g.gifted_to end,gifted_on=next_gift_date,occasion_note=case when p_fields?'occasion_note' then nullif(p_fields->>'occasion_note','') else g.occasion_note end where id=g.id and household_id=p_household_id;
  if next_gift_date<>g.gifted_on then
   update cellar.inventory_movements set occurred_at=next_gift_date::timestamp at time zone 'UTC' where id=g.inventory_movement_id and household_id=p_household_id;
   update cellar.bottles set departed_at=next_gift_date::timestamp at time zone 'UTC' where id=g.bottle_id and household_id=p_household_id and status='gifted';
  end if;
 else raise exception 'Unsupported correction'; end if;
 return p_record_id;
end $$;
revoke all on function cellar.correct_history_record(uuid,text,uuid,jsonb,boolean) from public,anon;
grant execute on function cellar.correct_history_record(uuid,text,uuid,jsonb,boolean) to authenticated;
