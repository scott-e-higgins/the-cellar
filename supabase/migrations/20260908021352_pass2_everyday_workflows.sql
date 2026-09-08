-- Cellar only. Existing inventory and Travel Journal tables retain their contracts.
alter table cellar.purchases add column if not exists client_request_id uuid;
create unique index if not exists purchases_client_request_idx
  on cellar.purchases (household_id, client_request_id) where client_request_id is not null;

create or replace function cellar.save_acquisition(
  p_household_id uuid, p_request_id uuid, p_details jsonb, p_lines jsonb,
  p_definition_only boolean default false
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  purchase_id uuid; wine_id uuid; wine_data jsonb; line jsonb;
  items jsonb := '[]'; visit_id uuid := nullif(p_details->>'visit_id','')::uuid;
  trip_id text := nullif(p_details->>'trip_id',''); trip_label text;
  v_winery_id uuid; v_vintage integer; v_non_vintage boolean; visit_trip text;
begin
  if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household'; end if;
  if p_request_id is null then raise exception 'A save identifier is required'; end if;
  -- Serializes the same request and wine matching within a small household collection.
  perform pg_advisory_xact_lock(hashtextextended('cellar-acquisition:' || p_household_id::text, 0));
  select id into purchase_id from cellar.purchases where household_id=p_household_id and client_request_id=p_request_id;
  if purchase_id is not null then return purchase_id; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one wine'; end if;
  if p_definition_only and jsonb_array_length(p_lines)<>1 then raise exception 'Save one wine without bottles'; end if;
  if visit_id is not null and not exists(select 1 from cellar.winery_visits where id=visit_id and household_id=p_household_id) then raise exception 'Choose a valid winery visit'; end if;
  if visit_id is not null then
    select external_id, display_label into visit_trip,trip_label from cellar.travel_references
      where household_id=p_household_id and winery_visit_id=visit_id and external_system='travel-journal' and external_entity_type='trip' limit 1;
    if trip_id is not null and visit_trip is not null and trip_id<>visit_trip then raise exception 'Use the linked trip from this visit'; end if;
    trip_id := coalesce(visit_trip,trip_id);
  end if;
  -- Trip visibility continues to use the existing shared-login/RLS contract.
  if trip_id is not null then
    select name into trip_label from public.trips where id::text=trip_id;
    if trip_label is null then raise exception 'Choose a visible Travel Journal trip'; end if;
  end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    wine_id := nullif(line->>'wine_id','')::uuid;
    if wine_id is null then
      wine_data := line->'new_wine';
      if nullif(trim(wine_data->>'name'),'') is null then raise exception 'Wine name is required'; end if;
      v_winery_id := nullif(wine_data->>'winery_id','')::uuid;
      v_non_vintage := coalesce((wine_data->>'non_vintage')::boolean,false);
      v_vintage := case when v_non_vintage then null else nullif(wine_data->>'vintage','')::integer end;
      select w.id into wine_id from cellar.wines w
        where w.household_id=p_household_id and lower(trim(w.name))=lower(trim(wine_data->>'name'))
          and w.winery_id is not distinct from v_winery_id and w.vintage is not distinct from v_vintage and w.non_vintage=v_non_vintage
        order by w.created_at,w.id limit 1;
      if wine_id is null then
        insert into cellar.wines(household_id,winery_id,name,vintage,non_vintage,style,category,sweetness,country,state,vineyard,closure,blend_description,official_winery_notes,personal_notes)
        values(p_household_id,v_winery_id,trim(wine_data->>'name'),v_vintage,v_non_vintage,nullif(wine_data->>'style',''),nullif(wine_data->>'category',''),nullif(wine_data->>'sweetness',''),nullif(wine_data->>'country',''),nullif(wine_data->>'state',''),nullif(wine_data->>'vineyard',''),nullif(wine_data->>'closure',''),nullif(wine_data->>'blend_description',''),nullif(wine_data->>'official_winery_notes',''),nullif(wine_data->>'personal_notes','')) returning id into wine_id;
      end if;
    end if;
    if not exists(select 1 from cellar.wines w where w.id=wine_id and w.household_id=p_household_id) then raise exception 'Choose a wine from this household'; end if;
    if p_definition_only then return wine_id; end if;
    if not exists(select 1 from cellar.storage_locations where id=nullif(line->>'storage_location_id','')::uuid and household_id=p_household_id and is_active) then raise exception 'Choose an active storage location'; end if;
    items := items || jsonb_build_array((line - 'new_wine') || jsonb_build_object('wine_id',wine_id));
  end loop;
  purchase_id := cellar.record_acquisition(p_household_id,coalesce(p_details->>'acquisition_type','purchased'),nullif(p_details->>'acquisition_date','')::date,p_details->>'purchase_location',p_details->>'gift_from',nullif(p_details->>'selected_by_person_id','')::uuid,nullif(p_details->>'purchased_by_person_id','')::uuid,nullif(p_details->>'subtotal','')::numeric,nullif(p_details->>'tax','')::numeric,nullif(p_details->>'discount','')::numeric,nullif(p_details->>'total_cost','')::numeric,p_details->>'notes',items);
  update cellar.purchases set winery_visit_id=visit_id,client_request_id=p_request_id where id=purchase_id and household_id=p_household_id;
  if trip_id is not null then
    insert into cellar.travel_references(household_id,purchase_id,external_system,external_entity_type,external_id,display_label)
      values(p_household_id,purchase_id,'travel-journal','trip',trip_id,trip_label);
  end if;
  return purchase_id;
end;
$$;
revoke all on function cellar.save_acquisition(uuid,uuid,jsonb,jsonb,boolean) from public, anon;
grant execute on function cellar.save_acquisition(uuid,uuid,jsonb,jsonb,boolean) to authenticated;

create or replace function cellar.save_opening_review(p_household_id uuid,p_opening_id uuid,p_fields jsonb,p_reviews jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare current_opening cellar.openings%rowtype; review jsonb; next_status text;
begin
  if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household'; end if;
  select * into current_opening from cellar.openings where id=p_opening_id and household_id=p_household_id for update;
  if not found then raise exception 'Opening not found'; end if;
  next_status := coalesce(p_fields->>'status',current_opening.status);
  update cellar.openings set
    status=next_status,
    finished_at=case when next_status='open' then null else coalesce(nullif(p_fields->>'finished_at','')::timestamptz,current_opening.finished_at,now()) end,
    opened_at=coalesce(nullif(p_fields->>'opened_at','')::timestamptz,current_opening.opened_at),
    opened_by_person_id=case when p_fields ? 'opened_by_person_id' then nullif(p_fields->>'opened_by_person_id','')::uuid else current_opening.opened_by_person_id end,
    opened_by_both=coalesce((p_fields->>'opened_by_both')::boolean,current_opening.opened_by_both),
    memory_notes=case when p_fields ? 'memory_notes' then nullif(p_fields->>'memory_notes','') else current_opening.memory_notes end,
    enjoyed_with=case when p_fields ? 'enjoyed_with' then nullif(p_fields->>'enjoyed_with','') else current_opening.enjoyed_with end,
    occasion=case when p_fields ? 'occasion' then nullif(p_fields->>'occasion','') else current_opening.occasion end,
    issue_type=case when p_fields ? 'issue_type' then nullif(p_fields->>'issue_type','') else current_opening.issue_type end,
    issue_notes=case when p_fields ? 'issue_notes' then nullif(p_fields->>'issue_notes','') else current_opening.issue_notes end
  where id=p_opening_id and household_id=p_household_id;
  for review in select value from jsonb_array_elements(coalesce(p_reviews,'[]')) loop
    insert into cellar.tasting_reviews(household_id,opening_id,person_id,rating,buy_again,tasting_notes)
      values(p_household_id,p_opening_id,(review->>'person_id')::uuid,nullif(review->>'rating','')::numeric,nullif(review->>'buy_again',''),nullif(review->>'tasting_notes',''))
      on conflict (opening_id,person_id) do update set rating=excluded.rating,buy_again=excluded.buy_again,tasting_notes=excluded.tasting_notes;
  end loop;
  return p_opening_id;
end;
$$;
revoke all on function cellar.save_opening_review(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function cellar.save_opening_review(uuid,uuid,jsonb,jsonb) to authenticated;

-- Manual Aging needs no generated estimate; retain individual existing overrides.
create or replace function cellar.set_wine_aging_quantity(
  p_household_id uuid,
  p_wine_id uuid,
  p_aging_count integer,
  p_user_hold_override_year integer default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_count integer;
  guidance cellar.wine_drinking_guidance%rowtype;
begin
  if not cellar_private.can_edit_household(p_household_id) then
    raise exception 'Not authorized to edit this household';
  end if;
  if p_aging_count < 0 then raise exception 'Aging bottle count cannot be negative'; end if;
  if p_user_hold_override_year is not null
     and p_user_hold_override_year not between extract(year from current_date)::integer and 2300 then
    raise exception 'Hold-until year must be this year or later';
  end if;

  perform 1
  from cellar.bottles
  where household_id = p_household_id and wine_id = p_wine_id and status = 'active'
  for update;

  select count(*) into active_count
  from cellar.bottles
  where household_id = p_household_id and wine_id = p_wine_id and status = 'active';

  if p_aging_count > active_count then
    raise exception 'Only % bottles are currently available', active_count;
  end if;

  select * into guidance
  from cellar.wine_drinking_guidance
  where household_id = p_household_id and wine_id = p_wine_id;


  with ranked as (
    select id, row_number() over (order by is_aging desc, bottle_number, id) as rank
    from cellar.bottles
    where household_id = p_household_id and wine_id = p_wine_id and status = 'active'
  )
  update cellar.bottles bottle
  set is_aging = ranked.rank <= p_aging_count,
      suggested_hold_until_year = case when ranked.rank <= p_aging_count then guidance.suggested_hold_until_year else null end,
      user_hold_override_year = case when ranked.rank <= p_aging_count then coalesce(p_user_hold_override_year,bottle.user_hold_override_year) else null end,
      aging_guidance_source = case when ranked.rank <= p_aging_count then guidance.guidance_source else null end,
      aging_started_at = case
        when ranked.rank <= p_aging_count then coalesce(bottle.aging_started_at, now())
        else null
      end
  from ranked
  where bottle.id = ranked.id;

  return p_aging_count;
end;
$$;
