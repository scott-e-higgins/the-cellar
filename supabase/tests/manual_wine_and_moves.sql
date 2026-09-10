-- Isolated household, real authenticated RLS and functions, all writes rolled back.
begin;
do $$
declare h uuid:=gen_random_uuid();u uuid;l uuid:=gen_random_uuid();dest uuid:=gen_random_uuid();r jsonb;w uuid;person uuid:=gen_random_uuid();ids uuid[];aging uuid;req uuid:=gen_random_uuid();before_bottles jsonb;before_purchase jsonb;before_photos jsonb;before_online jsonb;n integer;gift uuid;
begin
 select user_id into u from cellar.household_members where role='owner' limit 1;
 insert into cellar.households(id,name) values(h,'Manual and Move rollback test');
 insert into cellar.household_members(household_id,user_id,role) values(h,u,'owner');
 insert into cellar.storage_locations(id,household_id,name) values(l,h,'Main Rack A'),(dest,h,'Main Rack C');
 insert into cellar.people(id,household_id,display_name) values(person,h,'Test Person');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 set local role authenticated;
 r:=cellar.save_wine_entry(h,gen_random_uuid(),'{"new_winery":{"name":"Test Winery"},"acquisition_date":"1900-01-01","visit_mode":"auto","trip_mode":"manual","create_visit":true}',jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Test Wine'),'quantity',4,'storage_location_id',l)));
 w:=(r->'wine_ids'->>0)::uuid;
 update cellar.wines set category='Manual Red',style='Dry',blend_description='Original blend',official_winery_notes='Retained reference' where id=w;
 perform cellar.save_wine_personal(h,w,jsonb_build_object('name','Corrected Wine','vintage',2023,'winery_id',r->>'winery_id','personal_notes','Our memory'),jsonb_build_array(jsonb_build_object('person_id',person,'favorite',true,'buy_again','yes','notes','Our opinion')));
 if not exists(select 1 from cellar.wines where id=w and name='Corrected Wine' and vintage=2023 and category='Manual Red' and style='Dry' and blend_description='Original blend' and official_winery_notes='Retained reference' and personal_notes='Our memory') then raise exception 'Personal save changed reference data';end if;
 if not exists(select 1 from cellar.wine_preferences where wine_id=w and person_id=person and favorite and buy_again='yes') then raise exception 'Preferences not saved';end if;
 begin
  perform cellar.save_wine_personal(h,w,jsonb_build_object('name','Must rollback'),jsonb_build_array(jsonb_build_object('person_id',gen_random_uuid())));
  raise exception 'Invalid preference accepted';
 exception when foreign_key_violation then null;end;
 if (select name from cellar.wines where id=w)<>'Corrected Wine' then raise exception 'Partial Wine save persisted';end if;
 perform cellar.set_wine_aging_quantity(h,w,1,2032);
 select id into aging from cellar.bottles where wine_id=w and is_aging;
 select array_agg(id order by id) into ids from cellar.bottles where wine_id=w and not is_aging;
 select jsonb_agg(to_jsonb(b)-'storage_location_id'-'updated_at' order by id) into before_bottles from cellar.bottles b where wine_id=w;
 select to_jsonb(p) into before_purchase from cellar.purchases p where id=(r->>'purchase_id')::uuid;
 -- Move one of several, retry after acknowledgement loss, preserve physical IDs.
 if cellar.move_physical_bottles(h,req,ids[1:1],l,dest)<>1 or cellar.move_physical_bottles(h,req,ids[1:1],l,dest)<>1 then raise exception 'Move/retry count failed';end if;
 if (select count(*) from cellar.inventory_movements where move_request_id=req)<>1 then raise exception 'Retry duplicated movement';end if;
 if (select storage_location_id from cellar.bottles where id=ids[1])<>dest or (select sum(quantity) from cellar.inventory_balances where household_id=h)<>4 then raise exception 'Move lost quantity or location';end if;
 -- Move the Aging bottle; every original Aging/hold/purchase field stays attached.
 perform cellar.move_physical_bottles(h,gen_random_uuid(),array[aging],l,dest);
 if (select jsonb_agg(to_jsonb(b)-'storage_location_id'-'updated_at' order by id) from cellar.bottles b where wine_id=w)<>before_bottles then raise exception 'Move changed bottle identity/aging/history';end if;
 if (select to_jsonb(p) from cellar.purchases p where id=(r->>'purchase_id')::uuid)<>before_purchase then raise exception 'Move changed purchase/Visit relationship';end if;
 if (select count(*) from cellar.gifts_given where household_id=h)<>0 or (select count(*) from cellar.openings where household_id=h)<>0 then raise exception 'Move created departure history';end if;
 select count(*) into n from cellar.inventory_movements where household_id=h;
 begin
  perform cellar.move_physical_bottles(h,gen_random_uuid(),ids,l,dest);
  raise exception 'Stale source allowed';
 exception when others then if sqlerrm='Stale source allowed' then raise;end if;end;
 begin
  perform cellar.move_physical_bottles(h,req,ids[2:2],l,dest);
  raise exception 'Changed retry allowed';
 exception when others then if sqlerrm='Changed retry allowed' then raise;end if;end;
 begin
  perform cellar.move_physical_bottles(h,gen_random_uuid(),ids[2:2],l,gen_random_uuid());
  raise exception 'Foreign destination allowed';
 exception when others then if sqlerrm='Foreign destination allowed' then raise;end if;end;
 if (select count(*) from cellar.inventory_movements where household_id=h)<>n then raise exception 'Failed move partially wrote ledger';end if;
 -- Several bottles move together without splitting/recreating purchase records.
 perform cellar.move_physical_bottles(h,gen_random_uuid(),ids[2:3],l,dest);
 if (select sum(quantity) from cellar.inventory_balances where household_id=h and storage_location_id=dest)<>4 or exists(select 1 from cellar.bottles where wine_id=w and storage_location_id<>dest) then raise exception 'Multi bottle move inconsistent';end if;
 -- Gifting after a move sees new storage and still prefers a normal bottle.
 gift:=cellar.gift_bottle_v2(h,(select purchase_item_id from cellar.bottles where id=ids[1]),dest,'Friend','2026-09-10',null,false);
 if (select bottle_was_aging from cellar.gifts_given where id=gift) or (select sum(quantity) from cellar.inventory_balances where household_id=h)<>3 then raise exception 'Moved inventory gift failed';end if;
 reset role;
 update cellar.household_members set role='viewer' where household_id=h and user_id=u;
 set local role authenticated;
 begin
  perform cellar.move_physical_bottles(h,gen_random_uuid(),array[aging],dest,l);
  raise exception 'Viewer move allowed';
 exception when others then if sqlerrm='Viewer move allowed' then raise;end if;end;
 begin
  perform cellar.save_wine_personal(h,w,'{"name":"Denied"}');
  raise exception 'Viewer Wine edit allowed';
 exception when others then if sqlerrm='Viewer Wine edit allowed' then raise;end if;end;
 reset role;
end $$;
rollback;
select 'PASS: personal save and atomic preference rollback, retained reference fields; one/multiple/Aging bottle moves, stable IDs/holds/purchase/Visit, exact retries, stale-source and invalid destination rollback, gift after move, viewer denied; all test records rolled back' as result;
