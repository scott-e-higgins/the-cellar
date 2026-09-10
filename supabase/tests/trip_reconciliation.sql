-- All fixtures, including synthetic overlap Trips, roll back; no real history changes.
begin;
do $$
declare h uuid:=gen_random_uuid();u uuid;v uuid:=gen_random_uuid();v2 uuid:=gen_random_uuid();wr uuid:=gen_random_uuid();t text;dt date;t2 uuid:=gen_random_uuid();p uuid;near_p uuid;missing_p uuid;visit_p uuid;shared_p uuid;ambiguous_p uuid;explicit_p uuid;ref uuid;n integer;m jsonb;before_p jsonb;
begin
 select user_id into u from cellar.household_members where role='owner' limit 1;
 insert into cellar.households(id,name) values(h,'Trip reconciliation rollback test');
 insert into cellar.household_members(household_id,user_id,role) values(h,u,'owner');
 insert into cellar.wineries(id,household_id,name) values(wr,h,'Test Winery');
 select id::text,start_date into t,dt from public.trips order by start_date limit 1;
 insert into cellar.winery_visits(id,household_id,winery_id,visit_date) values(v,h,wr,dt),(v2,h,wr,dt);
 insert into cellar.purchases(household_id,acquisition_date) values(h,dt) returning id into p;
 insert into cellar.purchases(household_id,acquisition_date) values(h,dt-2) returning id into near_p;
 insert into cellar.purchases(household_id,acquisition_date) values(h,null) returning id into missing_p;
 insert into cellar.purchases(household_id,acquisition_date,winery_visit_id) values(h,null,v) returning id into visit_p;
 insert into cellar.purchases(household_id,acquisition_date,winery_visit_id) values(h,null,v2) returning id into shared_p;
 insert into cellar.purchases(household_id,acquisition_date,winery_visit_id) values(h,dt-20,v2) returning id into explicit_p;
 insert into cellar.travel_references(household_id,purchase_id,external_system,external_entity_type,external_id) values(h,explicit_p,'travel-journal','trip',t) returning id into ref;
 insert into cellar.travel_references(household_id,winery_visit_id,external_system,external_entity_type,external_id) values(h,v,'travel-journal','trip',t);
 select jsonb_agg(to_jsonb(x) order by id) into before_p from cellar.purchases x where household_id=h;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 set local role authenticated;
 if cellar.purchase_trip_match(h,p)->>'method'<>'date' or cellar.purchase_trip_match(h,near_p)->>'status'<>'needs_review' or cellar.purchase_trip_match(h,missing_p)->>'status'<>'insufficient_information' or cellar.purchase_trip_match(h,visit_p)->>'method'<>'visit' or cellar.purchase_trip_match(h,shared_p)->>'method'<>'shared_visit' then raise exception 'Match precedence failed';end if;
 if cellar.purchase_trip_match(h,explicit_p)->>'warning' is null then raise exception 'Suspicious explicit date not reported';end if;
 perform cellar.reconcile_purchase_trips(h);
 select count(*) into n from cellar.travel_references where household_id=h;
 perform cellar.reconcile_purchase_trips(h);
 if (select count(*) from cellar.travel_references where household_id=h)<>n then raise exception 'Rerun duplicated links';end if;
 if not exists(select 1 from cellar.travel_references where id=ref and external_id=t) then raise exception 'Explicit link replaced';end if;
 if exists(select 1 from cellar.travel_references where purchase_id in (near_p,missing_p)) then raise exception 'Uncertain acquisition auto-linked';end if;
 if (select jsonb_agg(to_jsonb(x) order by id) from cellar.purchases x where household_id=h)<>before_p then raise exception 'Historical acquisition changed';end if;
 perform cellar.reconcile_purchase_trip(h,near_p,'leave_unlinked');perform cellar.reconcile_purchase_trips(h);
 if cellar.purchase_trip_match(h,near_p)->>'status'<>'left_unlinked' then raise exception 'Leave unlinked forgotten';end if;
 perform cellar.reconcile_purchase_trip(h,near_p,'accept',t);perform cellar.reconcile_purchase_trip(h,near_p,'accept',t);
 if (select count(*) from cellar.travel_references where purchase_id=near_p)<>1 then raise exception 'Manual accept retry duplicated';end if;
 begin perform cellar.reconcile_purchase_trip(h,missing_p,'accept','missing-trip');raise exception 'Invisible trip accepted';exception when others then if sqlerrm='Invisible trip accepted' then raise;end if;end;
 -- Overlapping authoritative dates must be ambiguous, even on a boundary.
 reset role;
 insert into public.trips(id,name,start_date,end_date,household_id) select t2,'Rollback overlap fixture',start_date,end_date,household_id from public.trips where id::text=t;
 insert into cellar.purchases(household_id,acquisition_date) values(h,dt) returning id into ambiguous_p;
 set local role authenticated;
 if cellar.purchase_trip_match(h,ambiguous_p)->>'status'<>'needs_review' or jsonb_array_length(cellar.purchase_trip_match(h,ambiguous_p)->'trip_ids')<>2 then raise exception 'Overlapping Trips silently chosen';end if;
 perform cellar.reconcile_purchase_trip(h,ambiguous_p);
 if exists(select 1 from cellar.travel_references where purchase_id=ambiguous_p) then raise exception 'Ambiguous date linked';end if;
 -- Multiple Visit links must not use LIMIT 1 in historical or future inference.
 insert into cellar.travel_references(household_id,winery_visit_id,external_system,external_entity_type,external_id) values(h,v,'travel-journal','trip',t2::text);
 if cellar.infer_acquisition_trip(h,v,null)->>'method'<>'review' then raise exception 'Conflicting Visit trip chosen';end if;
 reset role;
 update cellar.household_members set role='viewer' where household_id=h and user_id=u;
 set local role authenticated;
 begin perform cellar.reconcile_purchase_trips(h);raise exception 'Viewer write allowed';exception when others then if sqlerrm='Viewer write allowed' then raise;end if;end;
 begin perform cellar.purchase_trip_match(gen_random_uuid(),p);raise exception 'Other household read allowed';exception when others then if sqlerrm='Other household read allowed' then raise;end if;end;
 reset role;
end $$;
rollback;
select 'PASS: exact boundaries, linked Visit without date, shared Visit context, near-date review, missing date, overlap/conflict ambiguity, explicit link preservation/warnings, rerun, accept retry, leave-unlinked persistence, unchanged acquisitions, invisible Trip and viewer/household protection; all fixtures rolled back' as result;
