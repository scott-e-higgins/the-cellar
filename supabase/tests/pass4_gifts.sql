-- Synthetic household; no test records persist.
begin;
do $$
declare h uuid:=gen_random_uuid();u uuid;l uuid:=gen_random_uuid();r jsonb;w uuid;i uuid;g uuid;g2 uuid;b uuid;n integer;
begin
 select user_id into u from cellar.household_members where role='owner' limit 1;
 insert into cellar.households(id,name) values(h,'Gift workflow rollback test');
 insert into cellar.household_members(household_id,user_id,role) values(h,u,'owner');
 insert into cellar.storage_locations(id,household_id,name) values(l,h,'Rack');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 set local role authenticated;
 r:=cellar.save_wine_entry(h,gen_random_uuid(),'{"new_winery":{"name":"Test Winery"},"acquisition_date":"2026-09-04","visit_mode":"manual","trip_mode":"manual"}',jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Test Wine'),'quantity',4,'storage_location_id',l)));
 w:=(r->'wine_ids'->>0)::uuid;
 select id into i from cellar.purchase_items where purchase_id=(r->>'purchase_id')::uuid;
 perform cellar.set_wine_aging_quantity(h,w,2,2030);
 g:=cellar.gift_bottle_v2(h,i,l,'Friend','2026-09-10','Thank you',false);
 if (select bottle_was_aging from cellar.gifts_given where id=g) or (select count(*) from cellar.bottles where household_id=h and status='active')<>3 then raise exception 'First gift must remove one normal bottle';end if;
 g2:=cellar.gift_bottle_v2(h,i,l,'Friend 2','2026-09-10',null,false);
 if (select bottle_was_aging from cellar.gifts_given where id=g2) then raise exception 'Equivalent remaining normal bottle not selected';end if;
 begin
  perform cellar.gift_bottle_v2(h,i,l,'Friend 3','2026-09-10',null,false);
  raise exception 'Unconfirmed Aging gift accepted';
 exception when others then if sqlerrm='Unconfirmed Aging gift accepted' then raise;end if;end;
 if (select count(*) from cellar.bottles where household_id=h and status='active')<>2 then raise exception 'Failed gift mutated inventory';end if;
 g2:=cellar.gift_bottle_v2(h,i,l,'Friend 3','2026-09-10',null,true);
 if not (select bottle_was_aging from cellar.gifts_given where id=g2) or (select count(*) from cellar.bottles where household_id=h and status='active')<>1 then raise exception 'Confirmed Aging gift failed';end if;
 select bottle_id into b from cellar.gifts_given where id=g;
 select count(*) into n from cellar.inventory_movements where household_id=h;
 perform cellar.correct_history_record(h,'gift',g,'{"gifted_to":"Corrected Friend","gifted_on":"2026-09-09","occasion_note":"Corrected note"}',false);
 if not exists(select 1 from cellar.gifts_given where id=g and gifted_to='Corrected Friend' and gifted_on='2026-09-09' and bottle_id=b) or (select count(*) from cellar.inventory_movements where household_id=h)<>n or (select count(*) from cellar.bottles where household_id=h and status='active')<>1 then raise exception 'Correction duplicated or changed inventory';end if;
 if not exists(select 1 from cellar.inventory_movements m join cellar.gifts_given x on x.inventory_movement_id=m.id where x.id=g and m.occurred_at::date='2026-09-09') then raise exception 'Gift movement date not corrected';end if;
 -- Column grants do not allow changing quantities or identity.
 begin
  update cellar.gifts_given set wine_id=gen_random_uuid() where id=g;
  raise exception 'Gift identity changed';
 exception when insufficient_privilege then null;end;
 begin
  update cellar.inventory_movements set quantity=99 where household_id=h;
  raise exception 'Movement quantity changed';
 exception when insufficient_privilege then null;end;
 -- Date correction does not expose unrelated receive/open movements.
 update cellar.inventory_movements set occurred_at='1900-01-01' where household_id=h and movement_type='receive';
 if found then raise exception 'Non-gift movement date changed';end if;
 reset role;
 update cellar.household_members set role='viewer' where household_id=h and user_id=u;
 set local role authenticated;
 begin
  perform cellar.correct_history_record(h,'gift',g,'{"gifted_to":"Denied"}',false);
  raise exception 'Viewer correction allowed';
 exception when others then if sqlerrm='Viewer correction allowed' then raise;end if;end;
 begin
  perform cellar.gift_bottle_v2(h,i,l,'Denied','2026-09-10',null,true);
  raise exception 'Viewer gifting allowed';
 exception when others then if sqlerrm='Viewer gifting allowed' then raise;end if;end;
 reset role;
end $$;
rollback;
select 'PASS: normal/equivalent/Aging gifting; failed mutation rollback; correction without inventory change; limited columns and gift-only movement dates; viewer protection; all test records rolled back' as result;
