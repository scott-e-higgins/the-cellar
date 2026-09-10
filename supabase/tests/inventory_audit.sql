begin;
do $$
declare h uuid:=gen_random_uuid();u uuid;loc uuid:=gen_random_uuid();wall uuid:=gen_random_uuid();chill uuid:=gen_random_uuid();r jsonb;a jsonb;other jsonb;aid uuid:=gen_random_uuid();w uuid;extra uuid:=gen_random_uuid();wall_wine uuid;normal uuid;aging uuid;move_id uuid;n integer;before_history jsonb;before_bottles jsonb;rev integer;req uuid:=gen_random_uuid();cnt integer;
begin
 select user_id into u from cellar.household_members where role='owner' limit 1;
 insert into cellar.households(id,name) values(h,'Inventory Audit rollback test');
 insert into cellar.household_members(household_id,user_id,role) values(h,u,'owner');
 insert into cellar.storage_locations(id,household_id,name) values(loc,h,'Rack'),(wall,h,'Wall'),(chill,h,'Chill');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
 r:=cellar.save_wine_entry(h,gen_random_uuid(),'{"new_winery":{"name":"Audit Winery"},"acquisition_date":"1900-01-01","trip_mode":"manual","visit_mode":"manual"}',jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Riesling'),'quantity',3,'storage_location_id',loc),jsonb_build_object('new_wine',jsonb_build_object('name','Cider'),'quantity',2,'storage_location_id',wall)));
 w:=(r->'wine_ids'->>0)::uuid;wall_wine:=(r->'wine_ids'->>1)::uuid;
 insert into cellar.wines(id,household_id,name) values(extra,h,'Found wine');
 perform cellar.set_wine_aging_quantity(h,w,1,2035);
 select id into normal from cellar.bottles where wine_id=w and not is_aging limit 1;
 select id into aging from cellar.bottles where wine_id=w and is_aging;
 perform cellar.set_wine_aging_quantity(h,wall_wine,1,2036);
 select id into move_id from cellar.bottles where wine_id=wall_wine and is_aging;
 select jsonb_agg(to_jsonb(p) order by id) into before_history from cellar.purchases p where household_id=h;
 select jsonb_agg(to_jsonb(b) order by id) into before_bottles from cellar.bottles b where household_id=h;
 -- Location independence and one resumable audit per location.
 a:=cellar.inventory_audit_command(h,aid,'start',jsonb_build_object('location_id',loc));
 if jsonb_array_length(a->'snapshot')<>3 then raise exception 'Wrong location snapshot';end if;
 if (cellar.inventory_audit_command(h,gen_random_uuid(),'start',jsonb_build_object('location_id',loc))->>'id')<>aid::text then raise exception 'Duplicate active audit';end if;
 other:=cellar.inventory_audit_command(h,gen_random_uuid(),'start',jsonb_build_object('location_id',wall));
 -- Count shortage, preserve the explicitly present Aging bottle.
 a:=cellar.inventory_audit_command(h,aid,'observe',jsonb_build_object('revision',a->'revision','request_id',req,'wine_id',w,'observation',jsonb_build_object('actual',2,'confirmed',true,'reason','Not sure','remove_ids',jsonb_build_array(normal),'move_ids','[]'::jsonb)));
 -- Lost acknowledgement retry, same request, must not advance or duplicate.
 rev:=(a->>'revision')::integer;
 a:=cellar.inventory_audit_command(h,aid,'observe',jsonb_build_object('revision',0,'request_id',req,'wine_id',w,'observation',jsonb_build_object('actual',2,'confirmed',true,'remove_ids',jsonb_build_array(normal),'move_ids','[]'::jsonb)));
 if (a->>'revision')::integer<>rev then raise exception 'Observation retry not idempotent';end if;
 a:=cellar.inventory_audit_command(h,aid,'observe',jsonb_build_object('revision',a->'revision','request_id',gen_random_uuid(),'wine_id',wall_wine,'observation',jsonb_build_object('actual',1,'confirmed',true,'remove_ids','[]'::jsonb,'move_ids',jsonb_build_array(move_id))));
 a:=cellar.inventory_audit_command(h,aid,'observe',jsonb_build_object('revision',a->'revision','request_id',gen_random_uuid(),'wine_id',extra,'observation','{"actual":2,"confirmed":true,"remove_ids":[],"move_ids":[]}'::jsonb));
 if (select jsonb_agg(to_jsonb(b) order by id) from cellar.bottles b where household_id=h)<>before_bottles then raise exception 'Counting mutated inventory';end if;
 -- Cross-session optimistic locking protects saved progress.
 begin
  perform cellar.inventory_audit_command(h,aid,'cancel',jsonb_build_object('revision',0,'request_id',gen_random_uuid()));raise exception 'Stale revision accepted';
 exception when others then if sqlerrm='Stale revision accepted' then raise;end if;end;
 -- No client can forge the applied flag or the server snapshot.
 begin update cellar.inventory_audits set status='applied' where id=aid;raise exception 'Forged completion allowed';exception when insufficient_privilege then null;end;
 a:=cellar.inventory_audit_command(h,aid,'apply',jsonb_build_object('revision',a->'revision','request_id',gen_random_uuid()));
 if a->>'status'<>'applied' then raise exception 'Not completed';end if;
 if (select count(*) from cellar.bottles where household_id=h and storage_location_id=loc and status='active')<>5 then raise exception 'Wrong final Rack quantity';end if;
 if not exists(select 1 from cellar.bottles where id=aging and status='active' and is_aging and effective_hold_until_year=2035) then raise exception 'Aging shortage lost';end if;
 if not exists(select 1 from cellar.bottles where id=move_id and storage_location_id=loc and is_aging and effective_hold_until_year=2036) then raise exception 'Aging move lost';end if;
 if (select sum(quantity) from cellar.inventory_balances where household_id=h and storage_location_id=loc)<>5 then raise exception 'Bottle ledger mismatch';end if;
 if (select jsonb_agg(to_jsonb(p) order by id) from cellar.purchases p where household_id=h)<>before_history then raise exception 'Audit fabricated purchase history';end if;
 if exists(select 1 from cellar.gifts_given where household_id=h) or exists(select 1 from cellar.openings where household_id=h) then raise exception 'Audit fabricated consumption/gift';end if;
 if (select count(*) from cellar.inventory_movements where inventory_audit_id=aid)<>4 then raise exception 'Audit ledger incomplete';end if;
 select count(*) into cnt from cellar.inventory_movements where household_id=h;
 perform cellar.inventory_audit_command(h,aid,'apply',jsonb_build_object('revision',0,'request_id',gen_random_uuid()));
 if (select count(*) from cellar.inventory_movements where household_id=h)<>cnt then raise exception 'Apply duplicated adjustments';end if;
 -- Wall is still counting; move from Wall makes its snapshot stale.
 begin perform cellar.inventory_audit_command(h,(other->>'id')::uuid,'apply',jsonb_build_object('revision',other->'revision','request_id',gen_random_uuid()));raise exception 'Stale inventory accepted';exception when others then if sqlerrm='Stale inventory accepted' then raise;end if;end;
 other:=cellar.inventory_audit_command(h,(other->>'id')::uuid,'refresh',jsonb_build_object('revision',other->'revision','request_id',gen_random_uuid()));
 if jsonb_array_length(other->'snapshot')<>1 then raise exception 'Stale recovery failed';end if;
 other:=cellar.inventory_audit_command(h,(other->>'id')::uuid,'cancel',jsonb_build_object('revision',other->'revision','request_id',gen_random_uuid()));
 if (select count(*) from cellar.inventory_movements where household_id=h)<>cnt then raise exception 'Cancel mutated inventory';end if;
 if (select count(*) from cellar.inventory_audits where household_id=h and status='applied')<>1 then raise exception 'Location status not independent';end if;
 -- Audit-origin bottles remain fully usable by existing Gift and Move paths.
 select id into normal from cellar.bottles where wine_id=extra limit 1;
 perform cellar.move_physical_bottles(h,gen_random_uuid(),array[normal],loc,chill);
 perform cellar.gift_bottle_v2(h,(select purchase_item_id from cellar.bottles where id=normal),chill,'Test friend',current_date,null,false);
 if not exists(select 1 from cellar.gifts_given where household_id=h and wine_id=extra) then raise exception 'Audit bottle gift failed';end if;
 if not exists(select 1 from cellar.inventory_audit_locations(h) l where l->>'id'=loc::text and (l->>'changed_since_audit')::boolean) then raise exception 'Cross-location change not shown';end if;
 reset role;update cellar.household_members set role='viewer' where household_id=h;set local role authenticated;
 begin perform cellar.inventory_audit_command(h,gen_random_uuid(),'start',jsonb_build_object('location_id',chill));raise exception 'Viewer allowed audit';exception when others then if sqlerrm='Viewer allowed audit' then raise;end if;end;
 begin perform cellar.inventory_audit_command(h,aid,'apply','{}');raise exception 'Viewer allowed apply';exception when others then if sqlerrm='Viewer allowed apply' then raise;end if;end;
 reset role;delete from cellar.household_members where household_id=h;set local role authenticated;
 if exists(select 1 from cellar.inventory_audits where household_id=h) or exists(select 1 from cellar.inventory_audit_locations(h)) then raise exception 'Cross-household audit exposed';end if;
 reset role;
end $$;
rollback;
select 'PASS: counting isolation, location scope, resume, shortages/Aging, extra baseline without purchases, Move Here/Aging, atomic Apply/retry, stale revision and inventory, recovery/cancel, existing Gift/Move with baseline bottles, independent status, editor RLS and no forged completion' as result;
