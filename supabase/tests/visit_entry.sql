begin;
do $$
declare h uuid:=gen_random_uuid();u uuid;t uuid:=gen_random_uuid();overlap uuid:=gen_random_uuid();req uuid:=gen_random_uuid();v uuid;w uuid;n integer;f jsonb;
begin
 select user_id into u from cellar.household_members where role='owner' limit 1;
 insert into cellar.households(id,name) values(h,'Visit entry rollback fixture');
 insert into cellar.household_members(household_id,user_id,role) values(h,u,'owner');
 insert into public.trips(id,name,start_date,end_date,household_id) select t,'Visit entry test Trip','1900-06-01','1900-06-03',household_id from public.trips limit 1;
 insert into public.trips(id,name,start_date,end_date,household_id) select overlap,'Overlap test Trip','1900-06-03','1900-06-04',household_id from public.trips limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 set local role authenticated;
 f:=jsonb_build_object('new_winery_name','Test Inline Winery','new_winery_city','Geneva','visit_date','1900-06-01','trip_mode','auto');
 v:=cellar.save_winery_visit(h,req,f);
 select winery_id into w from cellar.winery_visits where id=v;
 if not exists(select 1 from cellar.wineries where id=w and city='Geneva') or not exists(select 1 from cellar.travel_references where winery_visit_id=v and external_id=t::text) then raise exception 'Inline Winery/Visit/exact Trip failed';end if;
 if cellar.save_winery_visit(h,req,f)<>v or (select count(*) from cellar.winery_visits where household_id=h)<>1 or (select count(*) from cellar.wineries where household_id=h)<>1 then raise exception 'Retry duplicated records';end if;
 -- Exact-name reuse and existing-context selection do not duplicate the Winery.
 perform cellar.save_winery_visit(h,gen_random_uuid(),f||'{"visit_date":"1900-06-02"}');
 if (select count(*) from cellar.wineries where household_id=h)<>1 then raise exception 'Inline name duplicated Winery';end if;
 v:=cellar.save_winery_visit(h,gen_random_uuid(),jsonb_build_object('winery_id',w,'visit_date','1900-06-20','trip_mode','auto'));
 if exists(select 1 from cellar.travel_references where winery_visit_id=v) then raise exception 'No-match date linked';end if;
 n:=(select count(*) from cellar.winery_visits where household_id=h);
 begin
  perform cellar.save_winery_visit(h,gen_random_uuid(),f||'{"new_winery_name":"Ambiguous must not persist","visit_date":"1900-06-03"}');
  raise exception 'Overlap silently chosen';
 exception when others then if sqlerrm='Overlap silently chosen' then raise;end if;end;
 if (select count(*) from cellar.winery_visits where household_id=h)<>n or exists(select 1 from cellar.wineries where household_id=h and name='Ambiguous must not persist') then raise exception 'Ambiguous save partly persisted';end if;
 v:=cellar.save_winery_visit(h,gen_random_uuid(),f||'{"visit_date":"1900-06-03","trip_mode":"manual","trip_id":null}');
 if exists(select 1 from cellar.travel_references where winery_visit_id=v) then raise exception 'Explicit unlinked ignored';end if;
 v:=cellar.save_winery_visit(h,gen_random_uuid(),f||jsonb_build_object('visit_date','1900-06-20','trip_mode','manual','trip_id',t));
 if not exists(select 1 from cellar.travel_references where winery_visit_id=v and external_id=t::text) then raise exception 'Intentional manual link ignored';end if;
 begin
  perform cellar.save_winery_visit(h,gen_random_uuid(),f||'{"trip_mode":"manual","trip_id":"missing","new_winery_name":"Invalid Trip must not persist"}');
  raise exception 'Invalid Trip accepted';
 exception when others then if sqlerrm='Invalid Trip accepted' then raise;end if;end;
 -- A later Visit constraint failure must also roll back inline Winery creation.
 begin
  perform cellar.save_winery_visit(h,gen_random_uuid(),f||'{"new_winery_name":"Rollback Winery","would_visit_again":"invalid"}');
  raise exception 'Invalid Visit accepted';
 exception when others then if sqlerrm='Invalid Visit accepted' then raise;end if;end;
 if exists(select 1 from cellar.wineries where household_id=h and name in ('Rollback Winery','Invalid Trip must not persist')) then raise exception 'Failed save left Winery';end if;
 begin
  perform cellar.save_winery_visit(gen_random_uuid(),gen_random_uuid(),f);
  raise exception 'Foreign household allowed';
 exception when others then if sqlerrm='Foreign household allowed' then raise;end if;end;
 reset role;
 update cellar.household_members set role='viewer' where household_id=h and user_id=u;
 set local role authenticated;
 begin
  perform cellar.save_winery_visit(h,gen_random_uuid(),f);
  raise exception 'Viewer save allowed';
 exception when others then if sqlerrm='Viewer save allowed' then raise;end if;end;
 reset role;
end $$;
rollback;
select 'PASS: inline and existing Winery, exact/no/ambiguous Trip, manual override/unlinked, stable retries, atomic failure rollback, viewer/cross-household restrictions; all fixtures rolled back' result;
