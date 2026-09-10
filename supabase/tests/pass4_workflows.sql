-- Synthetic household only; every test write is rolled back.
begin;
do $$
declare u uuid;h uuid:=gen_random_uuid();l uuid:=gen_random_uuid();r uuid:=gen_random_uuid();r2 uuid:=gen_random_uuid();p uuid;w uuid;wr uuid;v uuid;v2 uuid; a uuid; result jsonb; again jsonb; fields jsonb;lines jsonb;count_before integer;trip text;trip_date date;
begin
 select user_id into u from cellar.household_members where role='owner' limit 1;
 if u is null then raise exception 'An existing Cellar owner is required for rollback tests';end if;
 insert into cellar.households(id,name) values(h,'Pass 4 rollback test');
 insert into cellar.household_members(household_id,user_id,role) values(h,u,'owner');
 insert into cellar.storage_locations(id,household_id,name) values(l,h,'Test Rack');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 set local role authenticated;
 fields:=jsonb_build_object('new_winery',jsonb_build_object('name','Pass4 Winery','city','Test Town'),'acquisition_date','1900-01-01','visit_mode','auto','trip_mode','manual','create_visit',true,'acquisition_type','purchased','subtotal',40,'total_cost',40);
 lines:=jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','First Wine','vintage',2023),'quantity',2,'storage_location_id',l,'unit_price',20,'total_cost',40));
 result:=cellar.save_wine_entry(h,r,fields,lines);p:=(result->>'purchase_id')::uuid;w:=(result->'wine_ids'->>0)::uuid;wr:=(result->>'winery_id')::uuid;v:=(result->>'visit_id')::uuid;
 if p is null or w is null or wr is null or v is null or (select count(*) from cellar.bottles where household_id=h)<>2 then raise exception 'Inline winery/wine/visit/acquisition failed';end if;
 again:=cellar.save_wine_entry(h,r,fields,lines);
 if again<>result or (select count(*) from cellar.wineries where household_id=h)<>1 or (select count(*) from cellar.bottles where household_id=h)<>2 then raise exception 'Save retry duplicated records';end if;
 -- Add Another appends a new wine to the same purchase and is retry-safe.
 fields:=jsonb_build_object('purchase_id',p,'winery_id',wr);
 lines:=jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Second Wine','vintage',2024),'quantity',3,'storage_location_id',l,'unit_price',10,'total_cost',30));
 result:=cellar.save_wine_entry(h,r2,fields,lines);
 perform cellar.save_wine_entry(h,r2,fields,lines);
 if (result->>'purchase_id')::uuid<>p or (select count(*) from cellar.purchases where household_id=h)<>1 or (select count(*) from cellar.purchase_items where purchase_id=p)<>2 or (select count(*) from cellar.bottles where household_id=h)<>5 or (select total_cost from cellar.purchases where id=p)<>70 then raise exception 'Append or append retry failed';end if;
 if (select winery_visit_id from cellar.purchases where id=p)<>v then raise exception 'Append lost visit';end if;
 -- Multi-line retries must preserve response order for the first-wine photo target.
 r2:=gen_random_uuid();
 lines:=jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Ordered A'),'quantity',1,'storage_location_id',l),jsonb_build_object('new_wine',jsonb_build_object('name','Ordered B'),'quantity',1,'storage_location_id',l));
 result:=cellar.save_wine_entry(h,r2,fields,lines);
 again:=cellar.save_wine_entry(h,r2,fields,lines);
 if result<>again or jsonb_array_length(result->'wine_ids')<>2 or (select name from cellar.wines where id=(again->'wine_ids'->>0)::uuid)<>'Ordered A' then raise exception 'Retry changed photo target order';end if;
 -- A date matched Visit is automatic; no trip match is not an error.
 fields:=jsonb_build_object('winery_id',wr,'acquisition_date','1900-01-01','visit_mode','auto','trip_mode','auto');
 result:=cellar.save_wine_entry(h,gen_random_uuid(),fields,lines);
 if (result->>'visit_id')::uuid<>v or result->>'trip_id' is not null then raise exception 'Date/visit inference failed';end if;
 -- Multiple visits cannot be silently chosen.
 insert into cellar.winery_visits(household_id,winery_id,visit_date) values(h,wr,'1900-01-01') returning id into v2;
 count_before:=(select count(*) from cellar.purchases where household_id=h);
 begin
 perform cellar.save_wine_entry(h,gen_random_uuid(),fields,lines);
 raise exception 'Ambiguous visits were allowed';
 exception when others then if sqlerrm='Ambiguous visits were allowed' then raise;end if;end;
 if (select count(*) from cellar.purchases where household_id=h)<>count_before then raise exception 'Ambiguous save partially committed';end if;
 -- A visible authoritative Trip with an unambiguous start date is inferred.
 select t.id::text,t.start_date into trip,trip_date from public.trips t where t.start_date is not null and t.end_date>=t.start_date and (select count(*) from public.trips x where x.start_date<=t.start_date and x.end_date>=t.start_date)=1 limit 1;
 if trip is not null then
  fields:=jsonb_build_object('winery_id',wr,'acquisition_date',trip_date,'visit_mode','auto','trip_mode','auto','create_visit',true);
  result:=cellar.save_wine_entry(h,gen_random_uuid(),fields,lines);
  if result->>'trip_id'<>trip or not exists(select 1 from cellar.travel_references where household_id=h and purchase_id=(result->>'purchase_id')::uuid and external_id=trip) or not exists(select 1 from cellar.travel_references where household_id=h and winery_visit_id=(result->>'visit_id')::uuid and external_id=trip) then raise exception 'Automatic Trip not inherited by new visit/purchase';end if;
 end if;
 -- Draft enrichment attaches on save, using existing acceptance without personal overwrites.
 insert into cellar.enrichment_attempts(household_id,draft_identity,status,confidence,match_type,proposed_data,created_by) values(h,jsonb_build_object('name','First Wine','winery_name','Pass4 Winery','vintage',2023,'non_vintage',false),'ready_for_review','high','exact','{"category":"Red Wine","description":"Sourced description"}',u) returning id into a;
 fields:=jsonb_build_object('winery_id',wr,'visit_mode','manual','trip_mode','manual','acquisition_date','1900-01-02');
 lines:=jsonb_build_array(jsonb_build_object('wine_id',w,'enrichment_attempt_id',a,'quantity',1,'storage_location_id',l));
 perform cellar.save_wine_entry(h,gen_random_uuid(),fields,lines);
 if not exists(select 1 from cellar.wine_online_info where wine_id=w and accepted_data->>'category'='Red Wine') or (select category from cellar.wines where id=w) is not null then raise exception 'Sourced information not preserved separately';end if;
 -- Stale identity cannot be accepted into another Wine; entire write rolls back.
 count_before:=(select count(*) from cellar.wines where household_id=h);
 begin
 perform cellar.save_wine_entry(h,gen_random_uuid(),fields,jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Wrong Identity','vintage',2023),'enrichment_attempt_id',a,'quantity',1,'storage_location_id',l)));
 raise exception 'Stale information accepted';
 exception when others then if sqlerrm='Stale information accepted' then raise;end if;end;
 if (select count(*) from cellar.wines where household_id=h)<>count_before then raise exception 'Stale save left a Wine';end if;
 -- Invalid storage cannot leave a newly created Winery/Wine behind.
 begin
 perform cellar.save_wine_entry(h,gen_random_uuid(),jsonb_build_object('new_winery',jsonb_build_object('name','Must Roll Back'),'acquisition_date','1900-01-02'),jsonb_build_array(jsonb_build_object('new_wine',jsonb_build_object('name','Must Roll Back'),'quantity',1,'storage_location_id',gen_random_uuid())));
 raise exception 'Invalid storage accepted';
 exception when others then if sqlerrm='Invalid storage accepted' then raise;end if;end;
 if exists(select 1 from cellar.wineries where household_id=h and name='Must Roll Back') then raise exception 'Failed save left Winery';end if;
 reset role;
 update cellar.household_members set role='viewer' where household_id=h and user_id=u;
 set local role authenticated;
 begin
 perform cellar.save_wine_entry(h,gen_random_uuid(),fields,lines);
 raise exception 'Viewer save accepted';
 exception when others then if sqlerrm='Viewer save accepted' then raise;end if;end;
 reset role;
end $$;
rollback;
select 'PASS: inline Winery/Wine/Visit, initial and append retries, same Purchase totals/inventory, automatic Trip/Visit, ambiguity rollback, sourced enrichment attachment, identity checks, failed-save rollback and viewer protection; no persisted test records' as result;
