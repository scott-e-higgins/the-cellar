-- Reconciliation receipts record decisions, not duplicate Trip records.
create table cellar.purchase_trip_reconciliation (
 purchase_id uuid primary key, household_id uuid not null,
 decision text not null check(decision in ('auto_linked','accepted','leave_unlinked')),
 method text not null, reference_id uuid references cellar.travel_references(id) on delete set null,
 decided_at timestamptz not null default now(),
 foreign key(purchase_id,household_id) references cellar.purchases(id,household_id) on delete cascade
);
alter table cellar.purchase_trip_reconciliation enable row level security;
create policy "Members read trip decisions" on cellar.purchase_trip_reconciliation for select to authenticated using(cellar_private.is_household_member(household_id));
create policy "Editors add trip decisions" on cellar.purchase_trip_reconciliation for insert to authenticated with check(cellar_private.can_edit_household(household_id));
create policy "Editors update trip decisions" on cellar.purchase_trip_reconciliation for update to authenticated using(cellar_private.can_edit_household(household_id)) with check(cellar_private.can_edit_household(household_id));
grant select,insert,update on cellar.purchase_trip_reconciliation to authenticated;
create index purchase_trip_reconciliation_household on cellar.purchase_trip_reconciliation(household_id);
create index purchase_trip_reconciliation_reference on cellar.purchase_trip_reconciliation(reference_id);

-- Same authoritative date/Visit precedence used by historical and future entry.
create function cellar.infer_acquisition_trip(p_household_id uuid,p_visit_id uuid,p_date date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ids text[];
begin
 if not cellar_private.is_household_member(p_household_id) then raise exception 'Not authorized';end if;
 select array_agg(distinct external_id order by external_id) into ids from cellar.travel_references where household_id=p_household_id and winery_visit_id=p_visit_id and external_system='travel-journal' and external_entity_type='trip';
 if cardinality(ids)>0 then
  if cardinality(ids)=1 and exists(select 1 from public.trips where id::text=ids[1]) then return jsonb_build_object('method','visit','trip_ids',ids,'reason','Inherited from the linked Winery Visit');end if;
  return jsonb_build_object('method','review','trip_ids',ids,'reason','The Winery Visit has conflicting or unavailable Trip links');
 end if;
 select array_agg(id::text order by id) into ids from public.trips where start_date<=p_date and end_date>=p_date;
 if cardinality(ids)=1 then return jsonb_build_object('method','date','trip_ids',ids,'reason','Acquisition date falls inside exactly one Trip');end if;
 if cardinality(ids)>1 then return jsonb_build_object('method','review','trip_ids',ids,'reason','More than one Trip contains the acquisition date');end if;
 return jsonb_build_object('method','none','trip_ids','[]'::jsonb,'reason','No exact Trip-date match');
end $$;

create function cellar.purchase_trip_match(p_household_id uuid,p_purchase_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare p cellar.purchases%rowtype;ids text[];v_ids text[];m jsonb;r cellar.purchase_trip_reconciliation%rowtype;warning text:=null;method text;status text;
begin
 if not cellar_private.is_household_member(p_household_id) then raise exception 'Not authorized';end if;
 select * into p from cellar.purchases where id=p_purchase_id and household_id=p_household_id;
 if not found then raise exception 'Acquisition not found';end if;
 select * into r from cellar.purchase_trip_reconciliation where purchase_id=p.id and household_id=p_household_id;
 select array_agg(distinct external_id order by external_id) into ids from cellar.travel_references where household_id=p_household_id and purchase_id=p.id and external_system='travel-journal' and external_entity_type='trip';
 if cardinality(ids)>0 then
  if cardinality(ids)>1 then warning:='Multiple existing Trip links';
  elsif not exists(select 1 from public.trips where id::text=ids[1]) then warning:='Existing Trip is unavailable or missing';
  elsif p.acquisition_date is not null and not exists(select 1 from public.trips where id::text=ids[1] and p.acquisition_date between start_date and end_date) then warning:='Existing Trip dates do not contain the acquisition date';end if;
  if exists(select 1 from cellar.travel_references where household_id=p_household_id and winery_visit_id=p.winery_visit_id and external_system='travel-journal' and external_entity_type='trip' and not(external_id=any(ids))) then warning:=concat_ws('; ',warning,'Purchase and Visit Trip links disagree');end if;
  status:=case when r.decision='auto_linked' and exists(select 1 from cellar.travel_references where id=r.reference_id and purchase_id=p.id and external_id=any(ids)) then 'auto_linked' else 'already_linked' end;
  return jsonb_build_object('purchase_id',p.id,'status',status,'method',r.method,'trip_ids',ids,'reason','Existing link preserved','warning',warning);
 end if;
 if r.decision='leave_unlinked' then return jsonb_build_object('purchase_id',p.id,'status','left_unlinked','trip_ids','[]'::jsonb,'reason','You chose to leave this acquisition unlinked');end if;
 m:=cellar.infer_acquisition_trip(p_household_id,p.winery_visit_id,p.acquisition_date);
 method:=m->>'method';
 if method in ('visit','date') then status:='ready';
 elsif method='review' then status:='needs_review';
 else
  -- A shared Visit is an independently established acquisition context. Never
  -- infer an event from import timestamps or winery geography alone.
  select array_agg(distinct tr.external_id order by tr.external_id) into v_ids
  from cellar.purchases peer join cellar.travel_references tr on tr.purchase_id=peer.id and tr.household_id=peer.household_id
  where peer.household_id=p_household_id and peer.id<>p.id and peer.winery_visit_id=p.winery_visit_id and tr.external_system='travel-journal' and tr.external_entity_type='trip';
  if cardinality(v_ids)=1 and exists(select 1 from public.trips where id::text=v_ids[1]) then
   m:=jsonb_build_object('method','shared_visit','trip_ids',v_ids,'reason','Another acquisition from this same Winery Visit has one authoritative Trip');status:='ready';
  elsif cardinality(v_ids)>0 then
   m:=jsonb_build_object('method','review','trip_ids',v_ids,'reason','Other acquisitions from this Visit have conflicting or unavailable Trip links');status:='needs_review';
  elsif p.acquisition_date is null then status:='insufficient_information';m:=m||jsonb_build_object('reason','No acquisition date or independently linked Visit/batch');
  else
   select array_agg(id::text order by start_date,id) into ids from public.trips where start_date<=end_date and ((p.acquisition_date between start_date-2 and start_date-1) or (p.acquisition_date between end_date+1 and end_date+2));
   if cardinality(ids)>0 then status:='needs_review';m:=jsonb_build_object('method','near','trip_ids',ids,'reason','Acquisition date is 1–2 days outside these Trip dates; review required');else status:='no_match';end if;
  end if;
 end if;
 return m||jsonb_build_object('purchase_id',p.id,'status',status,'warning',null);
end $$;

create function cellar.purchase_trip_queue(p_household_id uuid)
returns setof jsonb language sql stable security invoker set search_path='' as $$
 select cellar.purchase_trip_match(p_household_id,p.id) from cellar.purchases p where p.household_id=p_household_id order by p.acquisition_date desc nulls last,p.id;
$$;

create function cellar.reconcile_purchase_trip(p_household_id uuid,p_purchase_id uuid,p_action text default 'auto',p_trip_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m jsonb;chosen text;label text;ref uuid;method text;
begin
 if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized';end if;
 -- Serialize against other reconciliation calls and normal purchase edits.
 perform 1 from cellar.purchases where id=p_purchase_id and household_id=p_household_id for update;
 if not found then raise exception 'Acquisition not found';end if;
 m:=cellar.purchase_trip_match(p_household_id,p_purchase_id);
 if m->>'status' in ('already_linked','auto_linked') then return m;end if;
 if p_action='auto' then
  if m->>'status'<>'ready' then return m;end if;
  chosen:=m->'trip_ids'->>0;method:=m->>'method';
 elsif p_action='accept' then chosen:=p_trip_id;method:='manual';
 elsif p_action='leave_unlinked' then
  insert into cellar.purchase_trip_reconciliation(purchase_id,household_id,decision,method) values(p_purchase_id,p_household_id,'leave_unlinked','manual') on conflict(purchase_id) do update set decision='leave_unlinked',method='manual',reference_id=null,decided_at=now();
  return cellar.purchase_trip_match(p_household_id,p_purchase_id);
 else raise exception 'Unknown reconciliation action';end if;
 select name into label from public.trips where id::text=chosen;
 if not found then raise exception 'Choose a visible Travel Journal Trip';end if;
 insert into cellar.travel_references(household_id,purchase_id,external_system,external_entity_type,external_id,display_label) values(p_household_id,p_purchase_id,'travel-journal','trip',chosen,label) returning id into ref;
 insert into cellar.purchase_trip_reconciliation(purchase_id,household_id,decision,method,reference_id) values(p_purchase_id,p_household_id,case when p_action='auto' then 'auto_linked' else 'accepted' end,method,ref)
 on conflict(purchase_id) do update set decision=excluded.decision,method=excluded.method,reference_id=excluded.reference_id,decided_at=now();
 return cellar.purchase_trip_match(p_household_id,p_purchase_id);
end $$;

create function cellar.reconcile_purchase_trips(p_household_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare id uuid;m jsonb;result jsonb:='{}';
begin
 if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized';end if;
 for id in select p.id from cellar.purchases p where p.household_id=p_household_id order by case when cellar.purchase_trip_match(p_household_id,p.id)->>'method' in ('visit','date') then 0 else 1 end,p.id loop
  m:=cellar.reconcile_purchase_trip(p_household_id,id);
  result:=jsonb_set(result,array[m->>'status'],to_jsonb(coalesce((result->>(m->>'status'))::integer,0)+1));
 end loop;
 return result;
end $$;
revoke all on function cellar.infer_acquisition_trip(uuid,uuid,date),cellar.purchase_trip_match(uuid,uuid),cellar.purchase_trip_queue(uuid),cellar.reconcile_purchase_trip(uuid,uuid,text,text),cellar.reconcile_purchase_trips(uuid) from public,anon;
grant execute on function cellar.infer_acquisition_trip(uuid,uuid,date),cellar.purchase_trip_match(uuid,uuid),cellar.purchase_trip_queue(uuid),cellar.reconcile_purchase_trip(uuid,uuid,text,text),cellar.reconcile_purchase_trips(uuid) to authenticated;

-- Route future automatic entry through the same Visit/date inference.
create or replace function cellar.save_wine_entry(p_household_id uuid,p_request_id uuid,p_details jsonb,p_lines jsonb,p_definition_only boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 p uuid; w uuid; wr uuid; v uuid; t text; label text; dt date; old cellar.purchases%rowtype;
 item jsonb; resolved jsonb:='[]'; ids jsonb:='[]'; details jsonb:=p_details; draft jsonb; attempt cellar.enrichment_attempts%rowtype;
 trip_match jsonb; receipt jsonb; n integer; item_id uuid; qty integer; loc uuid; total numeric; prior jsonb;
begin
 if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household'; end if;
 if p_request_id is null then raise exception 'A save identifier is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cellar-acquisition:'||p_household_id::text,0));
 select id into p from cellar.purchases where household_id=p_household_id and client_request_id=p_request_id;
 if p is null then select purchase_id into p from cellar.purchase_items where household_id=p_household_id and entry_request_id=p_request_id limit 1; end if;
 if p is not null then
  select * into old from cellar.purchases where id=p and household_id=p_household_id;
  if old.entry_receipts ? p_request_id::text then return old.entry_receipts->(p_request_id::text); end if;
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
   trip_match:=cellar.infer_acquisition_trip(p_household_id,v,dt);
   if trip_match->>'method'='review' then raise exception '%',trip_match->>'reason';end if;
   t:=trip_match->'trip_ids'->>0;
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
 receipt:=jsonb_build_object('purchase_id',p,'wine_ids',ids,'winery_id',wr,'visit_id',v,'trip_id',t);
 update cellar.purchases set entry_receipts=entry_receipts||jsonb_build_object(p_request_id::text,receipt) where id=p and household_id=p_household_id;
 return receipt;
end $$;
revoke all on function cellar.save_wine_entry(uuid,uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function cellar.save_wine_entry(uuid,uuid,jsonb,jsonb,boolean) to authenticated;
