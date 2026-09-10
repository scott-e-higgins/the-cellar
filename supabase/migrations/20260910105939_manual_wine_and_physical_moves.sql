-- Retry receipts live alongside the existing movement ledger. No inventory
-- records are rewritten, and callers retain the existing household RLS rules.
alter table cellar.inventory_movements add column move_request_id uuid;
create unique index inventory_move_request_bottle on cellar.inventory_movements(household_id,move_request_id,bottle_id) where move_request_id is not null;

create or replace function cellar.move_physical_bottles(p_household_id uuid,p_request_id uuid,p_bottle_ids uuid[],p_from_location_id uuid,p_to_location_id uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare b cellar.bottles%rowtype; wanted uuid[]; previous uuid[]; n integer:=0;
begin
 if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household';end if;
 if p_request_id is null or coalesce(cardinality(p_bottle_ids),0)=0 or array_position(p_bottle_ids,null) is not null then raise exception 'Choose bottles to move';end if;
 select array_agg(distinct id order by id) into wanted from unnest(p_bottle_ids) id;
 if cardinality(wanted)<>cardinality(p_bottle_ids) then raise exception 'A bottle can only be selected once';end if;
 perform pg_advisory_xact_lock(hashtextextended('physical-move:'||p_household_id::text,0));
 select array_agg(bottle_id order by bottle_id) into previous from cellar.inventory_movements where household_id=p_household_id and move_request_id=p_request_id;
 if previous is not null then
  if previous<>wanted or exists(select 1 from cellar.inventory_movements where household_id=p_household_id and move_request_id=p_request_id and (from_location_id is distinct from p_from_location_id or to_location_id is distinct from p_to_location_id)) then raise exception 'This move request was already used for a different move';end if;
  return cardinality(previous);
 end if;
 if p_from_location_id is null or p_to_location_id is null or p_from_location_id=p_to_location_id then raise exception 'Choose a different destination';end if;
 if not exists(select 1 from cellar.storage_locations where id=p_to_location_id and household_id=p_household_id and is_active) then raise exception 'Choose an active household storage location';end if;
 perform 1 from cellar.bottles where id=any(wanted) and household_id=p_household_id order by id for update;
 if (select count(*) from cellar.bottles where id=any(wanted) and household_id=p_household_id and status='active' and storage_location_id=p_from_location_id)<>cardinality(wanted) then raise exception 'These bottles changed. Refresh before moving them';end if;
 if (select count(distinct wine_id) from cellar.bottles where id=any(wanted) and household_id=p_household_id)<>1 then raise exception 'Choose bottles of the same wine';end if;
 for b in select * from cellar.bottles where id=any(wanted) and household_id=p_household_id order by purchase_item_id,id loop
  insert into cellar.inventory_movements(household_id,purchase_item_id,bottle_id,movement_type,quantity,from_location_id,to_location_id,reason,created_by,move_request_id)
   values(p_household_id,b.purchase_item_id,b.id,'move',1,p_from_location_id,p_to_location_id,'Changed storage location',auth.uid(),p_request_id);
  update cellar.bottles set storage_location_id=p_to_location_id where id=b.id and household_id=p_household_id;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function cellar.move_physical_bottles(uuid,uuid,uuid[],uuid,uuid) from public,anon;
grant execute on function cellar.move_physical_bottles(uuid,uuid,uuid[],uuid,uuid) to authenticated;

create or replace function cellar.save_wine_personal(p_household_id uuid,p_wine_id uuid,p_fields jsonb,p_preferences jsonb default '[]')
returns uuid language plpgsql security invoker set search_path='' as $$
declare pref jsonb;
begin
 if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household';end if;
 if nullif(trim(p_fields->>'name'),'') is null then raise exception 'Wine name is required';end if;
 if jsonb_typeof(p_preferences) is distinct from 'array' then raise exception 'Preferences must be a list';end if;
 update cellar.wines set name=trim(p_fields->>'name'),winery_id=nullif(p_fields->>'winery_id','')::uuid,
  non_vintage=coalesce((p_fields->>'non_vintage')::boolean,false),
  vintage=case when coalesce((p_fields->>'non_vintage')::boolean,false) then null else nullif(p_fields->>'vintage','')::integer end,
  personal_notes=nullif(trim(p_fields->>'personal_notes'),''),favorite=coalesce((p_fields->>'favorite')::boolean,false)
 where id=p_wine_id and household_id=p_household_id;
 if not found then raise exception 'Wine not found';end if;
 for pref in select value from jsonb_array_elements(p_preferences) loop
  insert into cellar.wine_preferences(household_id,wine_id,person_id,favorite,buy_again,notes)
  values(p_household_id,p_wine_id,(pref->>'person_id')::uuid,coalesce((pref->>'favorite')::boolean,false),nullif(pref->>'buy_again',''),nullif(trim(pref->>'notes'),''))
  on conflict(wine_id,person_id) do update set favorite=excluded.favorite,buy_again=excluded.buy_again,notes=excluded.notes;
 end loop;
 return p_wine_id;
end $$;
revoke all on function cellar.save_wine_personal(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function cellar.save_wine_personal(uuid,uuid,jsonb,jsonb) to authenticated;
