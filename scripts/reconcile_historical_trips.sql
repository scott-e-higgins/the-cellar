-- Authorized one-time reconciliation for the existing Cellar household.
-- Safe to rerun: explicit links and Leave Unlinked decisions are preserved.
-- Runs with the owner's existing authenticated role; never uses a definer bypass.
begin;
create temporary table trip_reconciliation_result(result jsonb) on commit drop;
do $$
declare h uuid;u uuid;tbl text;fingerprint text;before_data jsonb:='{}';after_data jsonb:='{}';old_links jsonb;new_links integer;initial_count integer;output jsonb;n integer;
begin
 select id into strict h from cellar.households where name='The Cellar';
 select user_id into u from cellar.household_members where household_id=h and role='owner' order by user_id limit 1;
 if u is null then raise exception 'Household owner required';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 set local role authenticated;
 -- Cooperative acquisition lock plus row locks keep acquisition context stable.
 perform pg_advisory_xact_lock(hashtextextended('cellar-acquisition:'||h::text,0));
 perform 1 from cellar.purchases where household_id=h order by id for update;
 foreach tbl in array array['wines','wineries','purchases','purchase_items','winery_visits','bottles','inventory_movements','openings','gifts_given','photos','documents','wine_preferences','tasting_reviews','wine_online_info','winery_online_info','wine_drinking_guidance'] loop
  execute format('select md5(coalesce(string_agg(to_jsonb(x)::text,%L order by to_jsonb(x)::text),%L)) from cellar.%I x where household_id=$1','','',tbl) into fingerprint using h;
  before_data:=before_data||jsonb_build_object(tbl,fingerprint);
 end loop;
 select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) into fingerprint from public.trips t;
 before_data:=before_data||jsonb_build_object('travel_journal_trips',fingerprint);
 select coalesce(jsonb_object_agg(id,to_jsonb(r)),'{}'),count(*) into old_links,initial_count from cellar.travel_references r where household_id=h;
 output:=jsonb_build_object('examined',(select count(*) from cellar.purchases where household_id=h),'before',(select jsonb_agg(x) from(select q->>'status' status,q->>'method' method,count(*) n from cellar.purchase_trip_queue(h) q group by 1,2)x));
 perform cellar.reconcile_purchase_trips(h);
 select count(*)-initial_count into new_links from cellar.travel_references where household_id=h;
 -- Repeat inside the transaction to prove no extra links appear on a rerun.
 perform cellar.reconcile_purchase_trips(h);
 if (select count(*) from cellar.travel_references where household_id=h)<>initial_count+new_links then raise exception 'Rerun added extra links';end if;
 if exists(select 1 from jsonb_each(old_links) old left join cellar.travel_references r on r.id::text=old.key where to_jsonb(r) is distinct from old.value) then raise exception 'An existing link changed';end if;
 foreach tbl in array array['wines','wineries','purchases','purchase_items','winery_visits','bottles','inventory_movements','openings','gifts_given','photos','documents','wine_preferences','tasting_reviews','wine_online_info','winery_online_info','wine_drinking_guidance'] loop
  execute format('select md5(coalesce(string_agg(to_jsonb(x)::text,%L order by to_jsonb(x)::text),%L)) from cellar.%I x where household_id=$1','','',tbl) into fingerprint using h;
  after_data:=after_data||jsonb_build_object(tbl,fingerprint);
 end loop;
 select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) into fingerprint from public.trips t;
 after_data:=after_data||jsonb_build_object('travel_journal_trips',fingerprint);
 if before_data<>after_data then raise exception 'Protected historical data changed; rollback';end if;
 output:=output||jsonb_build_object('new_links',new_links,'unchanged_history',true,'rerun_added',0,'after',(select jsonb_agg(x) from(select q->>'status' status,q->>'method' method,count(*) n from cellar.purchase_trip_queue(h) q group by 1,2)x),'suspicious',(select coalesce(jsonb_agg(q),'[]') from cellar.purchase_trip_queue(h) q where q->>'warning' is not null));
 reset role;
 insert into trip_reconciliation_result values(output);
end $$;
select result from trip_reconciliation_result;
commit;
