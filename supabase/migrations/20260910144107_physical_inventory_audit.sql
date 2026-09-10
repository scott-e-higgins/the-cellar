-- Location audits retain observations until the explicit, atomic Apply command.
create table cellar.inventory_audits (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references cellar.households(id),
 location_id uuid not null, status text not null default 'counting' check(status in ('counting','applied','cancelled')),
 snapshot jsonb not null default '[]', observations jsonb not null default '{}',
 revision integer not null default 0, command jsonb, last_request_id uuid,
 created_at timestamptz not null default now(), applied_at timestamptz, cancelled_at timestamptz,
 unique(id,household_id), foreign key(location_id,household_id) references cellar.storage_locations(id,household_id)
);
create unique index inventory_audit_one_active_location on cellar.inventory_audits(household_id,location_id) where status='counting';
create index inventory_audit_location_history on cellar.inventory_audits(household_id,location_id,created_at desc);
alter table cellar.inventory_audits enable row level security;
create policy audit_read_member on cellar.inventory_audits for select to authenticated using(cellar_private.is_household_member(household_id));
create policy audit_create_editor on cellar.inventory_audits for insert to authenticated with check(cellar_private.can_edit_household(household_id));
create policy audit_update_editor on cellar.inventory_audits for update to authenticated using(cellar_private.can_edit_household(household_id)) with check(cellar_private.can_edit_household(household_id));
revoke all on cellar.inventory_audits from anon,authenticated;
grant select on cellar.inventory_audits to authenticated;
-- Only a command can be submitted: clients cannot forge snapshots/completion.
grant insert(id,household_id,location_id),update(command) on cellar.inventory_audits to authenticated;

-- An audit-origin lot reuses the physical bottle/ledger architecture without a
-- fabricated Purchase. Existing acquisition lots and their dates remain intact.
alter table cellar.purchase_items add column inventory_audit_id uuid;
alter table cellar.purchase_items alter column purchase_id drop not null;
alter table cellar.purchase_items add constraint purchase_item_origin check((purchase_id is not null and inventory_audit_id is null) or (purchase_id is null and inventory_audit_id is not null));
alter table cellar.purchase_items add constraint purchase_item_audit_household_fk foreign key(inventory_audit_id,household_id) references cellar.inventory_audits(id,household_id);
create index purchase_item_audit_idx on cellar.purchase_items(inventory_audit_id,household_id) where inventory_audit_id is not null;
alter table cellar.inventory_movements add column inventory_audit_id uuid;
alter table cellar.inventory_movements alter column created_at set default clock_timestamp();
alter table cellar.inventory_movements add constraint movement_audit_household_fk foreign key(inventory_audit_id,household_id) references cellar.inventory_audits(id,household_id);
create index movement_audit_idx on cellar.inventory_movements(inventory_audit_id,household_id) where inventory_audit_id is not null;

-- Serialize inventory writers with Apply, including newly inserted bottles.
-- No privilege elevation; all existing movement validation and RLS remain.
create function cellar_private.lock_audit_inventory() returns trigger language plpgsql security invoker set search_path='' as $$
begin perform pg_advisory_xact_lock(hashtextextended('audit-inventory:'||new.household_id::text,0));return new;end $$;
create trigger aaa_audit_inventory_lock before insert or update on cellar.bottles for each row execute function cellar_private.lock_audit_inventory();
create trigger aaa_audit_inventory_lock before insert on cellar.inventory_movements for each row execute function cellar_private.lock_audit_inventory();

create function cellar.audit_location_snapshot(p_household_id uuid,p_location_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'wine_id',wine_id,'purchase_item_id',purchase_item_id,'location_id',storage_location_id,'is_aging',is_aging,'hold',effective_hold_until_year,'updated_at',updated_at) order by id),'[]') from cellar.bottles where household_id=p_household_id and storage_location_id=p_location_id and status='active';
$$;

create function cellar_private.inventory_audit_transition() returns trigger language plpgsql security invoker set search_path='' as $$
declare cmd jsonb; act text; current_snapshot jsonb; old_wine jsonb; fresh_wine jsonb; obs jsonb; entry record; bid uuid; wid uuid; b cellar.bottles%rowtype; actual integer; expected integer; delta integer; item uuid; reason text; moved integer; remove_ids uuid[]; move_ids uuid[]; snap jsonb; source uuid; req uuid; n integer;
begin
 if not cellar_private.can_edit_household(new.household_id) then raise exception 'Not authorized to edit this household';end if;
 perform pg_advisory_xact_lock(hashtextextended('audit-inventory:'||new.household_id::text,0));
 if tg_op='INSERT' then
  if not exists(select 1 from cellar.storage_locations where id=new.location_id and household_id=new.household_id and is_active) then raise exception 'Choose an active storage location';end if;
  new.snapshot:=cellar.audit_location_snapshot(new.household_id,new.location_id);
  new.observations:='{}';new.status:='counting';new.revision:=0;new.created_at:=clock_timestamp();new.command:=null;
  return new;
 end if;
 cmd:=new.command;new:=old;new.command:=null;
 act:=cmd->>'action';req:=(cmd->>'request_id')::uuid;
 if old.status='applied' and act='apply' then return new;end if;
 if old.last_request_id=req then return new;end if;
 if old.status<>'counting' then raise exception 'This audit is already complete';end if;
 if req is null or (cmd->>'revision')::integer is distinct from old.revision then raise exception 'This audit changed on another screen. Refresh the audit before continuing';end if;
 new.last_request_id:=req;new.revision:=old.revision+1;
 if act='cancel' then new.status:='cancelled';new.cancelled_at:=clock_timestamp();return new;end if;
 if act='refresh' then
  current_snapshot:=cellar.audit_location_snapshot(new.household_id,new.location_id);
  for entry in select key,value from jsonb_each(new.observations) loop
   select coalesce(jsonb_agg(value order by value->>'id'),'[]') into old_wine from jsonb_array_elements(old.snapshot) where value->>'wine_id'=entry.key;
   select coalesce(jsonb_agg(value order by value->>'id'),'[]') into fresh_wine from jsonb_array_elements(current_snapshot) where value->>'wine_id'=entry.key;
   if old_wine<>fresh_wine or jsonb_array_length(coalesce(entry.value->'moves','[]'))>0 then new.observations:=new.observations-entry.key;end if;
  end loop;
  new.snapshot:=current_snapshot;return new;
 end if;
 if act='observe' then
  wid:=(cmd->>'wine_id')::uuid;obs:=cmd->'observation';actual:=(obs->>'actual')::integer;
  if not exists(select 1 from cellar.wines where id=wid and household_id=new.household_id) then raise exception 'Wine not found';end if;
  if actual is null or actual<0 or actual>1000 then raise exception 'Physical count must be a whole number from 0 to 1000';end if;
  if jsonb_typeof(obs->'remove_ids') is distinct from 'array' or jsonb_typeof(obs->'move_ids') is distinct from 'array' then raise exception 'Check bottle choices';end if;
  snap:='[]';
  for bid in select value::text::uuid from jsonb_array_elements_text(obs->'move_ids') loop
   select * into b from cellar.bottles where id=bid and household_id=new.household_id and wine_id=wid and status='active' and storage_location_id<>new.location_id;
   if not found then raise exception 'A selected bottle changed. Refresh and select it again';end if;
   snap:=snap||jsonb_build_array(jsonb_build_object('id',b.id,'location_id',b.storage_location_id,'updated_at',b.updated_at,'is_aging',b.is_aging,'hold',b.effective_hold_until_year));
  end loop;
  new.observations:=jsonb_set(new.observations,array[wid::text],jsonb_build_object('actual',actual,'confirmed',coalesce((obs->>'confirmed')::boolean,false),'reason',left(coalesce(nullif(trim(obs->>'reason'),''),'Not sure'),300),'remove_ids',obs->'remove_ids','moves',snap));
  return new;
 end if;
 if act<>'apply' then raise exception 'Unknown audit action';end if;
 current_snapshot:=cellar.audit_location_snapshot(new.household_id,new.location_id);
 if current_snapshot<>old.snapshot then raise exception 'Inventory changed since this audit began. Refresh counts and reconfirm changed wines before applying';end if;
 if exists(select 1 from jsonb_array_elements(new.snapshot) s where not coalesce((new.observations->(s->>'wine_id')->>'confirmed')::boolean,false)) or exists(select 1 from jsonb_each(new.observations) o where not coalesce((o.value->>'confirmed')::boolean,false)) then raise exception 'Confirm every wine before applying';end if;
 -- Validate every proposal before performing any correction. Row/household
 -- locks and the transaction also protect against an external change mid-Apply.
 for entry in select key,value from jsonb_each(new.observations) order by key loop
  wid:=entry.key::uuid;obs:=entry.value;actual:=(obs->>'actual')::integer;
  select count(*) into expected from jsonb_array_elements(new.snapshot) s where s->>'wine_id'=entry.key;
  moved:=jsonb_array_length(obs->'moves');delta:=actual-expected-moved;
  select coalesce(array_agg(value::uuid),'{}') into remove_ids from jsonb_array_elements_text(obs->'remove_ids');
  if cardinality(remove_ids)<>greatest(0,-delta) or cardinality(remove_ids)<>(select count(distinct id) from unnest(remove_ids) id) then raise exception 'Choose which missing bottles to correct, keeping Aging bottles distinct';end if;
  if exists(select 1 from unnest(remove_ids) id where not exists(select 1 from cellar.bottles where bottles.id=id and household_id=new.household_id and wine_id=wid and status='active' and storage_location_id=new.location_id)) then raise exception 'Missing bottle choice no longer matches this location';end if;
  select coalesce(array_agg((value->>'id')::uuid),'{}') into move_ids from jsonb_array_elements(obs->'moves');
  if cardinality(move_ids)<>(select count(distinct id) from unnest(move_ids) id) then raise exception 'A bottle can be moved only once';end if;
  for snap in select value from jsonb_array_elements(obs->'moves') loop
   if not exists(select 1 from cellar.bottles where id=(snap->>'id')::uuid and household_id=new.household_id and wine_id=wid and status='active' and storage_location_id=(snap->>'location_id')::uuid and updated_at=(snap->>'updated_at')::timestamptz) then raise exception 'A Move Here bottle changed. Refresh counts and select it again';end if;
  end loop;
 end loop;
 for entry in select key,value from jsonb_each(new.observations) order by key loop
  wid:=entry.key::uuid;obs:=entry.value;actual:=(obs->>'actual')::integer;
  select count(*) into expected from jsonb_array_elements(new.snapshot) s where s->>'wine_id'=entry.key;
  moved:=jsonb_array_length(obs->'moves');delta:=actual-expected-moved;
  reason:='Inventory Audit · '||(select name from cellar.storage_locations where id=new.location_id)||' · '||expected||' → '||actual||' · '||(obs->>'reason');
  for source in select distinct (value->>'location_id')::uuid from jsonb_array_elements(obs->'moves') loop
   select array_agg((value->>'id')::uuid) into move_ids from jsonb_array_elements(obs->'moves') where (value->>'location_id')::uuid=source;
   -- Same Move function and physical IDs; tag the ledger entries as this audit
   -- using a local trigger context (no privilege or authorization implications).
   perform set_config('cellar.audit_movement_id',new.id::text,true);
   perform cellar.move_physical_bottles(new.household_id,gen_random_uuid(),move_ids,source,new.location_id);
   perform set_config('cellar.audit_movement_id','',true);
  end loop;
  for bid in select value::uuid from jsonb_array_elements_text(obs->'remove_ids') loop
   select * into b from cellar.bottles where id=bid and household_id=new.household_id for update;
   insert into cellar.inventory_movements(household_id,purchase_item_id,bottle_id,movement_type,quantity,from_location_id,reason,created_by,inventory_audit_id) values(new.household_id,b.purchase_item_id,b.id,'adjust_out',1,new.location_id,reason,auth.uid(),new.id);
   update cellar.bottles set status='adjusted_out',departed_at=clock_timestamp() where id=b.id;
  end loop;
  if delta>0 then
   insert into cellar.purchase_items(household_id,wine_id,quantity,inventory_audit_id,notes) values(new.household_id,wid,delta,new.id,'Physical inventory baseline; acquisition history unknown') returning id into item;
   for n in 1..delta loop
    insert into cellar.bottles(household_id,purchase_item_id,wine_id,storage_location_id,bottle_number) values(new.household_id,item,wid,new.location_id,n) returning id into bid;
    insert into cellar.inventory_movements(household_id,purchase_item_id,bottle_id,movement_type,quantity,to_location_id,reason,created_by,inventory_audit_id) values(new.household_id,item,bid,'adjust_in',1,new.location_id,reason,auth.uid(),new.id);
   end loop;
  end if;
 end loop;
 new.status:='applied';new.applied_at:=clock_timestamp();return new;
end $$;
create trigger inventory_audit_transition before insert or update on cellar.inventory_audits for each row execute function cellar_private.inventory_audit_transition();

create function cellar_private.tag_audit_move() returns trigger language plpgsql security invoker set search_path='' as $$
declare aid uuid:=nullif(current_setting('cellar.audit_movement_id',true),'')::uuid;
begin
 if aid is not null and new.movement_type='move' then
  if not exists(select 1 from cellar.inventory_audits where id=aid and household_id=new.household_id and status='counting') then raise exception 'Active audit not found';end if;
  new.inventory_audit_id:=aid;new.reason:='Inventory Audit · Changed storage location';
 end if;return new;
end $$;
create trigger tag_audit_move before insert on cellar.inventory_movements for each row execute function cellar_private.tag_audit_move();

create function cellar.inventory_audit_command(p_household_id uuid,p_audit_id uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare a cellar.inventory_audits%rowtype;
begin
 if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household';end if;
 if p_action='start' then
  perform pg_advisory_xact_lock(hashtextextended('audit-start:'||p_household_id::text,0));
  select * into a from cellar.inventory_audits where household_id=p_household_id and location_id=(p_payload->>'location_id')::uuid and status='counting';
  if found then return to_jsonb(a);end if;
  select * into a from cellar.inventory_audits where id=p_audit_id and household_id=p_household_id;
  if found then return to_jsonb(a);end if;
  insert into cellar.inventory_audits(id,household_id,location_id) values(p_audit_id,p_household_id,(p_payload->>'location_id')::uuid) returning * into a;
 else
  update cellar.inventory_audits set command=p_payload||jsonb_build_object('action',p_action) where id=p_audit_id and household_id=p_household_id returning * into a;
  if not found then raise exception 'Audit not found';end if;
 end if;return to_jsonb(a);
end $$;
create function cellar.inventory_audit_locations(p_household_id uuid) returns setof jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(l)||jsonb_build_object('active_audit', (select to_jsonb(a) from cellar.inventory_audits a where a.location_id=l.id and a.household_id=l.household_id and a.status='counting'),
 'last_audit',(select to_jsonb(a) from cellar.inventory_audits a where a.location_id=l.id and a.household_id=l.household_id and a.status='applied' order by a.applied_at desc limit 1),
 'changed_since_audit',exists(select 1 from cellar.inventory_movements m where m.household_id=l.household_id and (m.from_location_id=l.id or m.to_location_id=l.id) and m.created_at>(select max(a.applied_at) from cellar.inventory_audits a where a.location_id=l.id and a.household_id=l.household_id and a.status='applied')))
 from cellar.storage_locations l where l.household_id=p_household_id and l.is_active order by l.sort_order,l.name;
$$;
revoke all on function cellar.audit_location_snapshot(uuid,uuid),cellar.inventory_audit_command(uuid,uuid,text,jsonb),cellar.inventory_audit_locations(uuid) from public,anon;
grant execute on function cellar.audit_location_snapshot(uuid,uuid),cellar.inventory_audit_command(uuid,uuid,text,jsonb),cellar.inventory_audit_locations(uuid) to authenticated;
revoke all on function cellar_private.lock_audit_inventory(),cellar_private.inventory_audit_transition(),cellar_private.tag_audit_move() from public,anon;
