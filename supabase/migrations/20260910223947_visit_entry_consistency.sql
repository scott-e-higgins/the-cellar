-- Save an inline Winery, Visit and authoritative Trip link together under existing RLS.
create function cellar.save_winery_visit(p_household_id uuid,p_request_id uuid,p_fields jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare w uuid;v uuid;trip text;trip_name text;matching jsonb;visit_day date;winery_name text;matches integer;
begin
 if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized';end if;
 if p_request_id is null then raise exception 'A request ID is required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household_id::text||p_request_id::text,0));
 select id into v from cellar.winery_visits where id=p_request_id and household_id=p_household_id;
 if found then return v;end if;
 visit_day:=nullif(p_fields->>'visit_date','')::date;
 if visit_day is null then raise exception 'Choose a Visit date';end if;
 if coalesce(p_fields->>'trip_mode','auto')='auto' then
  matching:=cellar.infer_acquisition_trip(p_household_id,null,visit_day);
  if matching->>'method'='review' then raise exception 'Choose a matching Trip or leave it unlinked';end if;
  trip:=matching->'trip_ids'->>0;
 elsif p_fields->>'trip_mode'='manual' then trip:=nullif(p_fields->>'trip_id','');
 else raise exception 'Invalid Trip selection';end if;
 if trip is not null then
  select t.name into trip_name from public.trips t where t.id::text=trip;
  if not found then raise exception 'Choose an available Travel Journal Trip';end if;
 end if;
 w:=nullif(p_fields->>'winery_id','')::uuid;
 if w is null then
  winery_name:=nullif(btrim(p_fields->>'new_winery_name'),'');
  if winery_name is null then raise exception 'Choose a winery or add it here';end if;
  -- Serialize same-name inline creation, including separate clients.
  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text||lower(winery_name),1));
  select count(*) into matches from cellar.wineries x where x.household_id=p_household_id and lower(btrim(x.name))=lower(winery_name);
  if matches>1 then raise exception 'More than one Winery has this name; select the existing Winery';end if;
  select id into w from cellar.wineries x where x.household_id=p_household_id and lower(btrim(x.name))=lower(winery_name);
  if w is null then insert into cellar.wineries(household_id,name,city) values(p_household_id,winery_name,nullif(btrim(p_fields->>'new_winery_city'),'')) returning id into w;end if;
 elsif not exists(select 1 from cellar.wineries where id=w and household_id=p_household_id) then raise exception 'Choose a Winery in this collection';end if;
 insert into cellar.winery_visits(id,household_id,winery_id,visit_date,notes,favorite,would_visit_again)
 values(p_request_id,p_household_id,w,visit_day,nullif(p_fields->>'notes',''),coalesce((p_fields->>'favorite')::boolean,false),nullif(p_fields->>'would_visit_again','')) returning id into v;
 if trip is not null then
  insert into cellar.travel_references(household_id,winery_visit_id,external_system,external_entity_type,external_id,display_label)
  values(p_household_id,v,'travel-journal','trip',trip,trip_name);
 end if;
 return v;
end $$;
revoke all on function cellar.save_winery_visit(uuid,uuid,jsonb) from public,anon;
grant execute on function cellar.save_winery_visit(uuid,uuid,jsonb) to authenticated;
