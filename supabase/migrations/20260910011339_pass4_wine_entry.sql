-- Entry orchestration reuses Wine/Purchase/Inventory and the existing enrichment
-- engine. Draft research is not a Wine or inventory record. No new RLS grants.
alter table cellar.enrichment_attempts add column draft_identity jsonb;
alter table cellar.enrichment_attempts drop constraint enrichment_attempts_one_entity_check;
alter table cellar.enrichment_attempts add constraint enrichment_attempts_one_entity_check check (
 num_nonnulls(wine_id,winery_id)=1 or
 (num_nonnulls(wine_id,winery_id)=0 and jsonb_typeof(draft_identity)='object' and nullif(draft_identity->>'name','') is not null)
);
alter table cellar.purchase_items add column entry_request_id uuid;
create index purchase_items_entry_request_idx on cellar.purchase_items(household_id,entry_request_id) where entry_request_id is not null;

create or replace function cellar.save_wine_entry(p_household_id uuid,p_request_id uuid,p_details jsonb,p_lines jsonb,p_definition_only boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 p uuid; w uuid; wr uuid; v uuid; t text; label text; dt date; old cellar.purchases%rowtype;
 item jsonb; resolved jsonb:='[]'; ids jsonb:='[]'; details jsonb:=p_details; draft jsonb; attempt cellar.enrichment_attempts%rowtype;
 n integer; item_id uuid; qty integer; loc uuid; total numeric; prior jsonb;
begin
 if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household'; end if;
 if p_request_id is null then raise exception 'A save identifier is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cellar-acquisition:'||p_household_id::text,0));
 select id into p from cellar.purchases where household_id=p_household_id and client_request_id=p_request_id;
 if p is null then select purchase_id into p from cellar.purchase_items where household_id=p_household_id and entry_request_id=p_request_id limit 1; end if;
 if p is not null then
  select * into old from cellar.purchases where id=p and household_id=p_household_id;
  select jsonb_agg(wine_id order by id) into ids from cellar.purchase_items where purchase_id=p and household_id=p_household_id and (entry_request_id=p_request_id or old.client_request_id=p_request_id);
  select winery_id into wr from cellar.wines where id=(ids->>0)::uuid and household_id=p_household_id;
  select external_id into t from cellar.travel_references where purchase_id=p and household_id=p_household_id and external_system='travel-journal' and external_entity_type='trip' limit 1;
  return jsonb_build_object('purchase_id',p,'wine_ids',ids,'winery_id',wr,'visit_id',old.winery_visit_id,'trip_id',t);
 end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>30 then raise exception 'Add between one and thirty wines'; end if;
 wr:=nullif(details->>'winery_id','')::uuid;
 if wr is null and nullif(trim(details->'new_winery'->>'name'),'') is not null then
  select id into wr from cellar.wineries where household_id=p_household_id and lower(trim(name))=lower(trim(details->'new_winery'->>'name')) order by created_at,id limit 1;
  if wr is null then insert into cellar.wineries(household_id,name,city,state,country) values(p_household_id,trim(details->'new_winery'->>'name'),nullif(details->'new_winery'->>'city',''),nullif(details->'new_winery'->>'state',''),nullif(details->'new_winery'->>'country','')) returning id into wr; end if;
 end if;
 if wr is not null and not exists(select 1 from cellar.wineries where id=wr and household_id=p_household_id) then raise exception 'Choose a winery from this household'; end if;
 p:=nullif(details->>'purchase_id','')::uuid;
 if p is not null then
  select * into old from cellar.purchases where id=p and household_id=p_household_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  dt:=old.acquisition_date;v:=old.winery_visit_id;
  select external_id into t from cellar.travel_references where purchase_id=p and household_id=p_household_id and external_system='travel-journal' and external_entity_type='trip' limit 1;
 else
  dt:=nullif(details->>'acquisition_date','')::date;v:=nullif(details->>'visit_id','')::uuid;t:=nullif(details->>'trip_id','');
  if details->>'visit_mode'='auto' then
   select count(*),(array_agg(id order by id))[1] into n,v from cellar.winery_visits where household_id=p_household_id and winery_id=wr and visit_date=dt;
   if n>1 then raise exception 'More than one visit matches. Choose the visit or leave it unlinked.'; end if;
  end if;
  if v is not null and not exists(select 1 from cellar.winery_visits where id=v and household_id=p_household_id and winery_id=wr) then raise exception 'Choose a visit for this winery'; end if;
  if details->>'trip_mode'='auto' then
   t:=null;
   if v is not null then select external_id into t from cellar.travel_references where winery_visit_id=v and household_id=p_household_id and external_system='travel-journal' and external_entity_type='trip' limit 1; end if;
   if t is null then
    select count(*),(array_agg(id::text order by id))[1] into n,t from public.trips where start_date<=dt and end_date>=dt;
    if n>1 then raise exception 'More than one trip matches. Choose the trip or leave it unlinked.'; end if;
   end if;
  end if;
  if t is not null then select name into label from public.trips where id::text=t; if label is null then raise exception 'Choose a visible Travel Journal trip'; end if; end if;
  if v is null and coalesce((details->>'create_visit')::boolean,false) then
   if wr is null or dt is null then raise exception 'Winery and date are required for a visit'; end if;
   select count(*),(array_agg(id order by id))[1] into n,v from cellar.winery_visits where household_id=p_household_id and winery_id=wr and visit_date=dt;
   if n>1 then raise exception 'Choose an existing visit'; end if;
   if n=0 then
    insert into cellar.winery_visits(household_id,winery_id,visit_date) values(p_household_id,wr,dt) returning id into v;
    if t is not null then insert into cellar.travel_references(household_id,winery_visit_id,external_system,external_entity_type,external_id,display_label) values(p_household_id,v,'travel-journal','trip',t,label); end if;
   end if;
  end if;
 end if;
 for item in select value from jsonb_array_elements(p_lines) loop
  w:=nullif(item->>'wine_id','')::uuid;
  if w is null then
   draft:=(item->'new_wine')||jsonb_build_object('winery_id',wr);
   w:=cellar.save_acquisition(p_household_id,gen_random_uuid(),'{}',jsonb_build_array(jsonb_build_object('new_wine',draft)),true);
  end if;
  if not exists(select 1 from cellar.wines where id=w and household_id=p_household_id) then raise exception 'Choose a wine from this household'; end if;
  if nullif(item->>'enrichment_attempt_id','') is not null then
   select * into attempt from cellar.enrichment_attempts where id=(item->>'enrichment_attempt_id')::uuid and household_id=p_household_id for update;
   if not found or attempt.status not in ('ready_for_review','enriched') then raise exception 'Find Wine Info again before using this result'; end if;
   if attempt.draft_identity is not null then
    if not exists(select 1 from cellar.wines wine join cellar.wineries winery on winery.id=wine.winery_id where wine.id=w and wine.household_id=p_household_id and lower(trim(wine.name))=lower(trim(attempt.draft_identity->>'name')) and lower(trim(winery.name))=lower(trim(attempt.draft_identity->>'winery_name')) and wine.vintage is not distinct from nullif(attempt.draft_identity->>'vintage','')::integer and wine.non_vintage=coalesce((attempt.draft_identity->>'non_vintage')::boolean,false)) then raise exception 'Wine identity changed. Find Wine Info again.'; end if;
   elsif attempt.wine_id is distinct from w then raise exception 'The information belongs to a different wine'; end if;
   if attempt.wine_id is not null and attempt.wine_id<>w then raise exception 'The information is already attached to another wine'; end if;
   update cellar.enrichment_attempts set wine_id=w where id=attempt.id and household_id=p_household_id;
   perform cellar.accept_enrichment_attempt(attempt.id,null);
  end if;
  ids:=ids||jsonb_build_array(w);
  resolved:=resolved||jsonb_build_array((item-'new_wine')||jsonb_build_object('wine_id',w));
 end loop;
 if p_definition_only then return jsonb_build_object('purchase_id',null,'wine_ids',ids,'winery_id',wr,'visit_id',null,'trip_id',null); end if;
 if p is null then
  -- The purchase's explicitly chosen trip can differ from a Visit reference.
  -- No historical Visit/Trip record is edited to force a match.
  details:=details||jsonb_build_object('visit_id',null,'trip_id',t,'acquisition_date',dt);
  p:=cellar.save_acquisition(p_household_id,p_request_id,details,resolved,false);
  update cellar.purchases set winery_visit_id=v where id=p and household_id=p_household_id;
 else
  total:=0;
  for item in select value from jsonb_array_elements(resolved) loop
   if (item->>'quantity')::numeric<>trunc((item->>'quantity')::numeric) then raise exception 'Use whole bottle quantities'; end if;
   qty:=(item->>'quantity')::integer;loc:=nullif(item->>'storage_location_id','')::uuid;w:=(item->>'wine_id')::uuid;
   if qty is null or qty<1 or not exists(select 1 from cellar.storage_locations where id=loc and household_id=p_household_id and is_active) then raise exception 'Check quantity and storage'; end if;
   insert into cellar.purchase_items(household_id,purchase_id,wine_id,quantity,unit_price,total_cost,current_value_per_bottle,entry_request_id) values(p_household_id,p,w,qty,case when old.acquisition_type='gift' then null else nullif(item->>'unit_price','')::numeric end,case when old.acquisition_type='gift' then null else nullif(item->>'total_cost','')::numeric end,case when old.acquisition_type='gift' then null else nullif(item->>'current_value_per_bottle','')::numeric end,p_request_id) returning id into item_id;
   insert into cellar.inventory_movements(household_id,purchase_item_id,movement_type,quantity,to_location_id,occurred_at,reason,created_by) values(p_household_id,item_id,'receive',qty,loc,coalesce(dt,current_date)::timestamptz,'Additional wine from this purchase',auth.uid());
   insert into cellar.bottles(household_id,purchase_item_id,wine_id,storage_location_id,bottle_number) select p_household_id,item_id,w,loc,number from generate_series(1,qty) number;
   total:=total+nullif(item->>'total_cost','')::numeric;
  end loop;
  if old.acquisition_type='purchased' then update cellar.purchases set subtotal=subtotal+total,total_cost=total_cost+total where id=p and household_id=p_household_id; end if;
 end if;
 return jsonb_build_object('purchase_id',p,'wine_ids',ids,'winery_id',wr,'visit_id',v,'trip_id',t);
end $$;
revoke all on function cellar.save_wine_entry(uuid,uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function cellar.save_wine_entry(uuid,uuid,jsonb,jsonb,boolean) to authenticated;
