-- Integration assertions use an isolated synthetic household and ROLLBACK.
-- No existing collection or Travel Journal records are modified.
begin;
do $$
declare u uuid; h uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); wry uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); k uuid:=gen_random_uuid();
 p uuid; p2 uuid; w uuid; item uuid; o uuid; rid uuid:=gen_random_uuid(); lines jsonb; details jsonb; before_count integer; trip text;
begin
 select user_id into u from cellar.household_members where role='owner' limit 1;
 if u is null then raise exception 'Test requires an existing authenticated Cellar owner'; end if;
 insert into cellar.households(id,name) values(h,'Pass 2 transaction test');
 insert into cellar.household_members(household_id,user_id,role) values(h,u,'owner');
 insert into cellar.people(id,household_id,display_name) values(s,h,'Test Scott'),(k,h,'Test Kay');
 insert into cellar.storage_locations(id,household_id,name) values(l,h,'Test Rack');
 insert into cellar.wineries(id,household_id,name) values(wry,h,'Test Winery');
 insert into cellar.winery_visits(id,household_id,winery_id,visit_date) values(v,h,wry,current_date);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 set local role authenticated;
 select id::text into trip from public.trips limit 1;
 if trip is not null then
 insert into cellar.travel_references(household_id,winery_visit_id,external_system,external_entity_type,external_id,display_label) values(h,v,'travel-journal','trip',trip,'Test visit trip');
 end if;
 lines:=jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Test New Wine','winery_id',wry,'vintage',2023),'quantity',3,'storage_location_id',l,'unit_price',20,'total_cost',60));
 details:=jsonb_build_object('acquisition_type','purchased','acquisition_date',current_date,'visit_id',v,'subtotal',60,'total_cost',60);
 p:=cellar.save_acquisition(h,rid,details,lines);
 if (select count(*) from cellar.purchases where household_id=h)<>1 or (select count(*) from cellar.bottles where household_id=h)<>3 then raise exception 'New wine acquisition failed'; end if;
 if (select winery_visit_id from cellar.purchases where id=p)<>v then raise exception 'Visit lost'; end if;
 if trip is not null and not exists(select 1 from cellar.travel_references where purchase_id=p and external_id=trip) then raise exception 'Trip lost'; end if;
 if cellar.save_acquisition(h,rid,details,lines)<>p or (select count(*) from cellar.bottles where household_id=h)<>3 then raise exception 'Retry duplicated inventory'; end if;
 select id,wine_id into item,w from cellar.purchase_items where purchase_id=p;
 lines:=jsonb_build_array(jsonb_build_object('wine_id',w,'quantity',2,'storage_location_id',l),jsonb_build_object('new_wine',jsonb_build_object('name','Test Missing Wine','winery_id',wry),'quantity',1,'storage_location_id',l));
 p2:=cellar.save_acquisition(h,gen_random_uuid(),details,lines);
 if (select count(*) from cellar.purchase_items where purchase_id=p2)<>2 or (select count(*) from cellar.wines where household_id=h)<>2 or (select count(*) from cellar.bottles where household_id=h)<>6 then raise exception 'Mixed purchase failed'; end if;
 -- Matching wine creation reuses its identity without overwriting personal data.
 perform cellar.save_acquisition(h,gen_random_uuid(),details,jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Test New Wine','winery_id',wry,'vintage',2023,'personal_notes','Do not overwrite'))),true);
 if (select count(*) from cellar.wines where household_id=h)<>2 or (select personal_notes from cellar.wines where id=w) is not null then raise exception 'Wine reuse failed'; end if;
 before_count:=(select count(*) from cellar.bottles where household_id=h);
 begin
 perform cellar.save_acquisition(h,gen_random_uuid(),details,jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Must Roll Back'),'quantity',1,'storage_location_id',l),jsonb_build_object('wine_id',w,'quantity',1,'storage_location_id',gen_random_uuid())));
 raise exception 'Expected invalid location failure';
 exception when others then
 if sqlerrm='Expected invalid location failure' then raise; end if;
 end;
 if exists(select 1 from cellar.wines where household_id=h and name='Must Roll Back') or (select count(*) from cellar.bottles where household_id=h)<>before_count then raise exception 'Partial save escaped rollback'; end if;
 reset role;
 delete from cellar.wine_drinking_guidance where household_id=h and wine_id=w;
 set local role authenticated;
 perform cellar.set_wine_aging_quantity(h,w,2,null);
 if (select count(*) from cellar.bottles where household_id=h and wine_id=w and is_aging)<>2 or exists(select 1 from cellar.bottles where household_id=h and wine_id=w and is_aging and effective_hold_until_year is not null) then raise exception 'Aging without guidance failed'; end if;
 perform cellar.set_wine_aging_quantity(h,w,2,2035);
 perform cellar.set_wine_aging_quantity(h,w,2,null);
 if exists(select 1 from cellar.bottles where household_id=h and wine_id=w and is_aging and user_hold_override_year is distinct from 2035) then raise exception 'Manual override lost'; end if;
 o:=cellar.open_bottle_with_reviews_v2(h,item,l,s,now(),'open',null,null,null,null,null,'[]',false);
 if (select count(*) from cellar.bottles where household_id=h and status='active')<>before_count-1 or (select bottle_was_aging from cellar.openings where id=o) then raise exception 'Opening did not prefer normal bottle'; end if;
 perform cellar.save_opening_review(h,o,'{"status":"finished","memory_notes":"Later review"}',jsonb_build_array(jsonb_build_object('person_id',s,'rating',4,'buy_again','yes','tasting_notes','Scott note'),jsonb_build_object('person_id',k,'rating',3.5,'buy_again','maybe','tasting_notes','Kay note')));
 perform cellar.save_opening_review(h,o,'{"status":"finished","memory_notes":"Correction"}',jsonb_build_array(jsonb_build_object('person_id',s,'rating',5,'buy_again','yes')));
 if (select count(*) from cellar.bottles where household_id=h and status='active')<>before_count-1 or (select count(*) from cellar.tasting_reviews where opening_id=o)<>2 or (select rating from cellar.tasting_reviews where opening_id=o and person_id=k)<>3.5 or (select status from cellar.openings where id=o)<>'finished' then raise exception 'Later review/retry changed inventory or individual reviews'; end if;
 reset role;
 update cellar.household_members set role='viewer' where household_id=h and user_id=u;
 set local role authenticated;
 begin
 perform cellar.save_opening_review(h,o,'{"status":"open"}','[]');
 raise exception 'Viewer edit was allowed';
 exception when others then if sqlerrm='Viewer edit was allowed' then raise; end if; end;
 reset role;
end $$;
rollback;
select 'PASS: atomic acquisition, mixed lines, visit/trip links, retry, wine reuse, rollback, Aging without guidance, override, normal bottle selection, later individual reviews and viewer protection; all synthetic data rolled back' as result;
