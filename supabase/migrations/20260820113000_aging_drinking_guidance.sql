begin;

create table cellar.wine_drinking_guidance (
  wine_id uuid primary key,
  household_id uuid not null,
  window_start_year integer not null check (window_start_year between 1800 and 2300),
  window_end_year integer not null check (window_end_year between 1800 and 2300),
  suggested_hold_until_year integer not null check (suggested_hold_until_year between 1800 and 2300),
  guidance_source text not null check (guidance_source in ('producer', 'professional', 'wine_specific', 'cellar_estimate')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  rationale text not null,
  source_guidance text,
  source_url text,
  source_attempt_id uuid,
  last_calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wine_id, household_id),
  constraint wine_drinking_guidance_wine_household_fk
    foreign key (wine_id, household_id)
    references cellar.wines(id, household_id)
    on delete cascade,
  constraint wine_drinking_guidance_attempt_household_fk
    foreign key (source_attempt_id)
    references cellar.enrichment_attempts(id)
    on delete set null,
  constraint wine_drinking_guidance_window_check
    check (window_start_year <= suggested_hold_until_year and suggested_hold_until_year <= window_end_year)
);

create index wine_drinking_guidance_household_window_idx
  on cellar.wine_drinking_guidance (household_id, window_end_year, window_start_year);
create index wine_drinking_guidance_source_attempt_idx
  on cellar.wine_drinking_guidance (source_attempt_id, household_id)
  where source_attempt_id is not null;

create trigger wine_drinking_guidance_set_updated_at
before update on cellar.wine_drinking_guidance
for each row execute function cellar_private.set_updated_at();

alter table cellar.wine_drinking_guidance enable row level security;

create policy wine_drinking_guidance_select_member
on cellar.wine_drinking_guidance for select
to authenticated
using (cellar_private.is_household_member(household_id));

create policy wine_drinking_guidance_insert_editor
on cellar.wine_drinking_guidance for insert
to authenticated
with check (cellar_private.can_edit_household(household_id));

create policy wine_drinking_guidance_update_editor
on cellar.wine_drinking_guidance for update
to authenticated
using (cellar_private.can_edit_household(household_id))
with check (cellar_private.can_edit_household(household_id));

grant select, insert, update on cellar.wine_drinking_guidance to authenticated;

create table cellar.bottles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  purchase_item_id uuid not null,
  wine_id uuid not null,
  storage_location_id uuid not null,
  bottle_number integer not null check (bottle_number > 0),
  status text not null default 'active' check (status in ('active', 'opened', 'gifted', 'adjusted_out')),
  is_aging boolean not null default false,
  suggested_hold_until_year integer check (suggested_hold_until_year between 1800 and 2300),
  user_hold_override_year integer check (user_hold_override_year between 1800 and 2300),
  effective_hold_until_year integer generated always as
    (coalesce(user_hold_override_year, suggested_hold_until_year)) stored,
  aging_guidance_source text check (aging_guidance_source in ('producer', 'professional', 'wine_specific', 'cellar_estimate')),
  aging_started_at timestamptz,
  departed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (purchase_item_id, bottle_number),
  constraint bottles_item_household_fk
    foreign key (purchase_item_id, household_id)
    references cellar.purchase_items(id, household_id)
    on delete restrict,
  constraint bottles_wine_household_fk
    foreign key (wine_id, household_id)
    references cellar.wines(id, household_id)
    on delete restrict,
  constraint bottles_location_household_fk
    foreign key (storage_location_id, household_id)
    references cellar.storage_locations(id, household_id)
    on delete restrict,
  constraint bottles_departure_check
    check ((status = 'active' and departed_at is null) or (status <> 'active' and departed_at is not null)),
  constraint bottles_aging_shape_check
    check (not is_aging or aging_started_at is not null)
);

create index bottles_household_wine_active_idx
  on cellar.bottles (household_id, wine_id, is_aging, bottle_number)
  where status = 'active';
create index bottles_household_location_active_idx
  on cellar.bottles (household_id, storage_location_id, purchase_item_id)
  where status = 'active';

create trigger bottles_set_updated_at
before update on cellar.bottles
for each row execute function cellar_private.set_updated_at();

alter table cellar.bottles enable row level security;

create policy bottles_select_member
on cellar.bottles for select
to authenticated
using (cellar_private.is_household_member(household_id));

create policy bottles_insert_editor
on cellar.bottles for insert
to authenticated
with check (cellar_private.can_edit_household(household_id));

create policy bottles_update_editor
on cellar.bottles for update
to authenticated
using (cellar_private.can_edit_household(household_id))
with check (cellar_private.can_edit_household(household_id));

grant select, insert, update on cellar.bottles to authenticated;

alter table cellar.inventory_movements
  add column bottle_id uuid,
  add constraint inventory_movements_bottle_household_fk
    foreign key (bottle_id, household_id)
    references cellar.bottles(id, household_id)
    on delete restrict;

alter table cellar.openings
  add column bottle_id uuid,
  add column bottle_was_aging boolean not null default false,
  add column bottle_hold_until_year integer check (bottle_hold_until_year between 1800 and 2300),
  add constraint openings_bottle_household_fk
    foreign key (bottle_id, household_id)
    references cellar.bottles(id, household_id)
    on delete restrict;

alter table cellar.gifts_given
  add column bottle_id uuid,
  add column bottle_was_aging boolean not null default false,
  add column bottle_hold_until_year integer check (bottle_hold_until_year between 1800 and 2300),
  add constraint gifts_given_bottle_household_fk
    foreign key (bottle_id, household_id)
    references cellar.bottles(id, household_id)
    on delete restrict;

create index inventory_movements_bottle_idx
  on cellar.inventory_movements (bottle_id, household_id)
  where bottle_id is not null;
create index openings_bottle_idx
  on cellar.openings (bottle_id, household_id)
  where bottle_id is not null;
create index gifts_given_bottle_idx
  on cellar.gifts_given (bottle_id, household_id)
  where bottle_id is not null;

do $$
begin
  if exists (
    select 1 from cellar.inventory_balances
    where quantity < 0 or quantity <> trunc(quantity)
  ) then
    raise exception 'Bottle backfill requires non-negative whole-bottle inventory balances';
  end if;
end;
$$;

with expanded as (
  select
    balance.household_id,
    balance.purchase_item_id,
    balance.wine_id,
    balance.storage_location_id,
    row_number() over (
      partition by balance.purchase_item_id
      order by balance.storage_location_id, generated.seq_value
    )::integer as bottle_number
  from cellar.inventory_balances balance
  cross join lateral generate_series(1, balance.quantity::integer) generated(seq_value)
  where balance.quantity > 0
)
insert into cellar.bottles (
  household_id, purchase_item_id, wine_id, storage_location_id, bottle_number
)
select household_id, purchase_item_id, wine_id, storage_location_id, bottle_number
from expanded;

do $$
declare
  expected_count bigint;
  actual_count bigint;
begin
  select coalesce(sum(quantity), 0)::bigint into expected_count
  from cellar.inventory_balances where quantity > 0;
  select count(*) into actual_count from cellar.bottles where status = 'active';
  if expected_count <> actual_count then
    raise exception 'Bottle backfill mismatch: expected %, created %', expected_count, actual_count;
  end if;
end;
$$;

create or replace function cellar_private.refresh_wine_guidance(p_wine_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  wine_record cellar.wines%rowtype;
  online_record cellar.wine_online_info%rowtype;
  guidance_text text;
  identity_text text;
  source_kind text;
  source_link text;
  start_year integer;
  end_year integer;
  hold_year integer;
  vintage_year integer;
  current_year integer := extract(year from current_date)::integer;
  matched_min_year integer;
  matched_max_year integer;
  rationale_text text;
  confidence_text text;
  has_explicit_guidance boolean := false;
begin
  select * into wine_record from cellar.wines where id = p_wine_id;
  if not found then return; end if;

  select * into online_record
  from cellar.wine_online_info
  where wine_id = wine_record.id and household_id = wine_record.household_id;

  guidance_text := nullif(trim(coalesce(online_record.accepted_data->>'aging_guidance', '')), '');
  identity_text := lower(concat_ws(' ',
    wine_record.name, wine_record.category, wine_record.style, wine_record.sweetness,
    wine_record.blend_description, wine_record.region, wine_record.appellation,
    online_record.accepted_data->>'official_name', online_record.accepted_data->>'category',
    online_record.accepted_data->>'style', online_record.accepted_data->>'sweetness',
    online_record.accepted_data->>'varietals', online_record.accepted_data->>'description',
    online_record.accepted_data->>'technical_details', guidance_text
  ));
  vintage_year := coalesce(
    wine_record.vintage,
    case
      when online_record.accepted_data->>'vintage' ~ '^[0-9]{4}$'
      then (online_record.accepted_data->>'vintage')::integer
      else null
    end
  );

  if guidance_text is not null then
    select min((match)[1]::integer), max((match)[1]::integer)
      into matched_min_year, matched_max_year
    from regexp_matches(guidance_text, '(20[0-9]{2})', 'g') as match;

    if matched_max_year is not null then
      has_explicit_guidance := true;
      start_year := case
        when matched_min_year < current_year then matched_min_year
        when guidance_text ~* '(now|currently|immediately)' then current_year
        when matched_min_year = matched_max_year then greatest(coalesce(vintage_year + 2, current_year), current_year)
        else matched_min_year
      end;
      end_year := matched_max_year;
    elsif vintage_year is not null and guidance_text ~* '(at least (a )?decade|10 years|ten years)' then
      has_explicit_guidance := true;
      start_year := greatest(vintage_year + 2, current_year);
      end_year := vintage_year + 10;
    end if;
  end if;

  if has_explicit_guidance and end_year >= start_year then
    select
      case
        when bool_or(source_type in ('official_winery', 'official_pdf', 'producer_technical_sheet')) then 'producer'
        when bool_or(source_type = 'professional_source') then 'professional'
        else 'wine_specific'
      end,
      (array_agg(source_url order by
        case
          when source_type in ('official_winery', 'official_pdf', 'producer_technical_sheet') then 1
          when source_type = 'professional_source' then 2 else 3
        end,
        exact_match desc
      ))[1]
      into source_kind, source_link
    from cellar.enrichment_sources
    where attempt_id = online_record.accepted_attempt_id;
    source_kind := coalesce(source_kind, 'wine_specific');
    confidence_text := case when online_record.match_type = 'exact' then 'high' else 'medium' end;
    rationale_text := 'Saved from published guidance for this wine where a usable year or duration was available.';
  else
    if vintage_year is null and wine_record.non_vintage is not true then return; end if;
    vintage_year := coalesce(vintage_year, current_year);
    source_kind := 'cellar_estimate';
    confidence_text := case when online_record.wine_id is not null then 'medium' else 'low' end;

    if identity_text ~ '(port|madeira|fortified)' then
      start_year := vintage_year + 5; end_year := vintage_year + 25;
      rationale_text := 'Cellar estimate based on a fortified style that commonly rewards extended aging.';
    elsif identity_text ~ '(barolo|barbaresco|nebbiolo|brunello|tannat|cabernet sauvignon|bordeaux|syrah|shiraz)' then
      start_year := vintage_year + 4; end_year := vintage_year + 15;
      rationale_text := 'Cellar estimate based on a structured red-wine style and vintage.';
    elsif identity_text ~ '(cabernet franc|pinot noir|merlot|red blend|sangiovese|tempranillo)' then
      start_year := vintage_year + 3; end_year := vintage_year + 10;
      rationale_text := 'Cellar estimate based on the red-wine style and vintage.';
    elsif identity_text ~ '(ice wine|eiswein|sp[aä]tlese|late harvest|dessert wine|botrytis)' then
      start_year := vintage_year + 3; end_year := vintage_year + 18;
      rationale_text := 'Cellar estimate based on a sweet, high-acid wine style and vintage.';
    elsif identity_text ~ '(riesling|rkatsiteli|chenin blanc)' then
      start_year := vintage_year + 2; end_year := vintage_year + 12;
      rationale_text := 'Cellar estimate based on an acid-driven white-wine style and vintage.';
    elsif identity_text ~ '(chardonnay|white burgundy)' then
      start_year := vintage_year + 2; end_year := vintage_year + 8;
      rationale_text := 'Cellar estimate based on Chardonnay style and vintage.';
    elsif identity_text ~ '(champagne|sparkling|traditional method|p[eé]tillant)' then
      start_year := greatest(vintage_year + 1, current_year); end_year := greatest(vintage_year + 6, current_year + 3);
      rationale_text := 'Cellar estimate based on sparkling-wine style.';
    elsif identity_text ~ '(sauvignon blanc|pinot grigio|pinot gris|ros[eé]|fruit wine|blueberry|cranberry)' then
      start_year := vintage_year + 1; end_year := vintage_year + 4;
      rationale_text := 'Cellar estimate based on a fresher style generally enjoyed relatively young.';
    elsif guidance_text ~* '(age-worthy|ageworthy|age well|keeper|long haul|cellar|develop.*over time)' then
      start_year := vintage_year + 2; end_year := vintage_year + 9;
      rationale_text := 'Cellar estimate based on published age-worthiness language without a precise window.';
    else
      return;
    end if;
  end if;

  if end_year < current_year then
    start_year := least(start_year, end_year);
    hold_year := end_year;
  else
    start_year := least(start_year, end_year);
    hold_year := greatest(current_year, start_year + greatest(0, round((end_year - start_year) * 0.35)::integer));
    hold_year := least(hold_year, end_year);
  end if;

  insert into cellar.wine_drinking_guidance (
    wine_id, household_id, window_start_year, window_end_year,
    suggested_hold_until_year, guidance_source, confidence, rationale,
    source_guidance, source_url, source_attempt_id, last_calculated_at
  ) values (
    wine_record.id, wine_record.household_id, start_year, end_year,
    hold_year, source_kind, confidence_text, rationale_text,
    guidance_text, source_link, online_record.accepted_attempt_id, now()
  )
  on conflict (wine_id) do update set
    household_id = excluded.household_id,
    window_start_year = excluded.window_start_year,
    window_end_year = excluded.window_end_year,
    suggested_hold_until_year = excluded.suggested_hold_until_year,
    guidance_source = excluded.guidance_source,
    confidence = excluded.confidence,
    rationale = excluded.rationale,
    source_guidance = excluded.source_guidance,
    source_url = excluded.source_url,
    source_attempt_id = excluded.source_attempt_id,
    last_calculated_at = excluded.last_calculated_at;

  update cellar.bottles bottle
  set suggested_hold_until_year = hold_year,
      aging_guidance_source = source_kind
  where bottle.household_id = wine_record.household_id
    and bottle.wine_id = wine_record.id
    and bottle.status = 'active'
    and bottle.is_aging
    and bottle.user_hold_override_year is null;
end;
$$;

create or replace function cellar_private.refresh_wine_guidance_trigger()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform cellar_private.refresh_wine_guidance(
    case when tg_table_name = 'wines' then new.id else new.wine_id end
  );
  return new;
end;
$$;

create trigger wines_refresh_drinking_guidance
after insert or update of name, vintage, non_vintage, blend_description, style, category, sweetness, region, appellation
on cellar.wines
for each row execute function cellar_private.refresh_wine_guidance_trigger();

create trigger wine_online_info_refresh_drinking_guidance
after insert or update of accepted_data, confidence, match_type, accepted_attempt_id
on cellar.wine_online_info
for each row execute function cellar_private.refresh_wine_guidance_trigger();

do $$
declare
  current_wine record;
begin
  for current_wine in select id from cellar.wines loop
    perform cellar_private.refresh_wine_guidance(current_wine.id);
  end loop;
end;
$$;

create or replace function cellar.set_wine_aging_quantity(
  p_household_id uuid,
  p_wine_id uuid,
  p_aging_count integer,
  p_user_hold_override_year integer default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_count integer;
  guidance cellar.wine_drinking_guidance%rowtype;
begin
  if not cellar_private.can_edit_household(p_household_id) then
    raise exception 'Not authorized to edit this household';
  end if;
  if p_aging_count < 0 then raise exception 'Aging bottle count cannot be negative'; end if;
  if p_user_hold_override_year is not null
     and p_user_hold_override_year not between extract(year from current_date)::integer and 2300 then
    raise exception 'Hold-until year must be this year or later';
  end if;

  perform 1
  from cellar.bottles
  where household_id = p_household_id and wine_id = p_wine_id and status = 'active'
  for update;

  select count(*) into active_count
  from cellar.bottles
  where household_id = p_household_id and wine_id = p_wine_id and status = 'active';

  if p_aging_count > active_count then
    raise exception 'Only % bottles are currently available', active_count;
  end if;

  perform cellar_private.refresh_wine_guidance(p_wine_id);
  select * into guidance
  from cellar.wine_drinking_guidance
  where household_id = p_household_id and wine_id = p_wine_id;

  if p_aging_count > 0 and guidance.wine_id is null then
    raise exception 'A drinking estimate is not available yet for this wine';
  end if;

  with ranked as (
    select id, row_number() over (order by is_aging desc, bottle_number, id) as rank
    from cellar.bottles
    where household_id = p_household_id and wine_id = p_wine_id and status = 'active'
  )
  update cellar.bottles bottle
  set is_aging = ranked.rank <= p_aging_count,
      suggested_hold_until_year = case when ranked.rank <= p_aging_count then guidance.suggested_hold_until_year else null end,
      user_hold_override_year = case when ranked.rank <= p_aging_count then p_user_hold_override_year else null end,
      aging_guidance_source = case when ranked.rank <= p_aging_count then guidance.guidance_source else null end,
      aging_started_at = case
        when ranked.rank <= p_aging_count then coalesce(bottle.aging_started_at, now())
        else null
      end
  from ranked
  where bottle.id = ranked.id;

  return p_aging_count;
end;
$$;

create or replace function cellar.open_bottle_v2(
  p_household_id uuid,
  p_purchase_item_id uuid,
  p_storage_location_id uuid,
  p_opened_by_person_id uuid,
  p_opened_at timestamptz,
  p_status text,
  p_enjoyed_with text,
  p_occasion text,
  p_memory_notes text,
  p_issue_type text,
  p_issue_notes text,
  p_confirm_aging boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_bottle cellar.bottles%rowtype;
  opening_id uuid;
begin
  if not cellar_private.can_edit_household(p_household_id) then
    raise exception 'Not authorized to edit this household';
  end if;

  select * into selected_bottle
  from cellar.bottles
  where household_id = p_household_id
    and purchase_item_id = p_purchase_item_id
    and storage_location_id = p_storage_location_id
    and status = 'active'
  order by is_aging, bottle_number, id
  for update skip locked
  limit 1;

  if selected_bottle.id is null then raise exception 'No bottle is available in that location'; end if;
  if selected_bottle.is_aging and not p_confirm_aging then
    raise exception 'AGING_CONFIRMATION_REQUIRED:%', coalesce(selected_bottle.effective_hold_until_year::text, 'later');
  end if;

  insert into cellar.openings (
    household_id, wine_id, bottle_id, bottle_was_aging, bottle_hold_until_year,
    opened_at, opened_by_person_id, status, enjoyed_with, occasion,
    memory_notes, issue_type, issue_notes, finished_at
  ) values (
    p_household_id, selected_bottle.wine_id, selected_bottle.id,
    selected_bottle.is_aging, selected_bottle.effective_hold_until_year,
    coalesce(p_opened_at, now()), p_opened_by_person_id, coalesce(p_status, 'finished'),
    nullif(trim(p_enjoyed_with), ''), nullif(trim(p_occasion), ''),
    nullif(trim(p_memory_notes), ''), p_issue_type, nullif(trim(p_issue_notes), ''),
    case when coalesce(p_status, 'finished') = 'finished' then coalesce(p_opened_at, now()) else null end
  ) returning id into opening_id;

  insert into cellar.inventory_movements (
    household_id, purchase_item_id, bottle_id, movement_type, quantity,
    from_location_id, opening_id, occurred_at, reason, created_by
  ) values (
    p_household_id, selected_bottle.purchase_item_id, selected_bottle.id, 'open', 1,
    selected_bottle.storage_location_id, opening_id, coalesce(p_opened_at, now()),
    'Bottle opened', auth.uid()
  );

  update cellar.bottles set status = 'opened', departed_at = coalesce(p_opened_at, now())
  where id = selected_bottle.id and household_id = p_household_id;

  return opening_id;
end;
$$;

create or replace function cellar.open_bottle_with_reviews_v2(
  p_household_id uuid,
  p_purchase_item_id uuid,
  p_storage_location_id uuid,
  p_opened_by_person_id uuid,
  p_opened_at timestamptz,
  p_status text,
  p_enjoyed_with text,
  p_occasion text,
  p_memory_notes text,
  p_issue_type text,
  p_issue_notes text,
  p_reviews jsonb default '[]'::jsonb,
  p_confirm_aging boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  opening_id uuid;
  review jsonb;
begin
  if p_reviews is null or jsonb_typeof(p_reviews) <> 'array' then raise exception 'Reviews must be an array'; end if;
  opening_id := cellar.open_bottle_v2(
    p_household_id, p_purchase_item_id, p_storage_location_id,
    p_opened_by_person_id, p_opened_at, p_status, p_enjoyed_with,
    p_occasion, p_memory_notes, p_issue_type, p_issue_notes, p_confirm_aging
  );
  for review in select value from jsonb_array_elements(p_reviews) loop
    insert into cellar.tasting_reviews (
      household_id, opening_id, person_id, rating, buy_again, tasting_notes
    ) values (
      p_household_id, opening_id, (review->>'person_id')::uuid,
      nullif(review->>'rating', '')::numeric, nullif(review->>'buy_again', ''),
      nullif(trim(review->>'tasting_notes'), '')
    );
  end loop;
  return opening_id;
end;
$$;

create or replace function cellar.gift_bottle_v2(
  p_household_id uuid,
  p_purchase_item_id uuid,
  p_storage_location_id uuid,
  p_gifted_to text,
  p_gifted_on date,
  p_occasion_note text default null,
  p_confirm_aging boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_bottle cellar.bottles%rowtype;
  movement_id uuid;
  gift_id uuid;
  recipient text := nullif(trim(p_gifted_to), '');
begin
  if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household'; end if;
  if recipient is null then raise exception 'Gifted to is required'; end if;
  if p_gifted_on is null then raise exception 'Gift date is required'; end if;

  select * into selected_bottle
  from cellar.bottles
  where household_id = p_household_id
    and purchase_item_id = p_purchase_item_id
    and storage_location_id = p_storage_location_id
    and status = 'active'
  order by is_aging, bottle_number, id
  for update skip locked
  limit 1;

  if selected_bottle.id is null then raise exception 'No bottle is available in that location'; end if;
  if selected_bottle.is_aging and not p_confirm_aging then
    raise exception 'AGING_CONFIRMATION_REQUIRED:%', coalesce(selected_bottle.effective_hold_until_year::text, 'later');
  end if;

  insert into cellar.inventory_movements (
    household_id, purchase_item_id, bottle_id, movement_type, quantity,
    from_location_id, occurred_at, reason, created_by
  ) values (
    p_household_id, selected_bottle.purchase_item_id, selected_bottle.id,
    'adjust_out', 1, selected_bottle.storage_location_id,
    p_gifted_on::timestamptz, 'Gifted to ' || recipient, auth.uid()
  ) returning id into movement_id;

  insert into cellar.gifts_given (
    household_id, wine_id, purchase_item_id, storage_location_id,
    inventory_movement_id, bottle_id, bottle_was_aging, bottle_hold_until_year,
    gifted_to, gifted_on, occasion_note, created_by
  ) values (
    p_household_id, selected_bottle.wine_id, selected_bottle.purchase_item_id,
    selected_bottle.storage_location_id, movement_id, selected_bottle.id,
    selected_bottle.is_aging, selected_bottle.effective_hold_until_year,
    recipient, p_gifted_on, nullif(trim(p_occasion_note), ''), auth.uid()
  ) returning id into gift_id;

  update cellar.bottles set status = 'gifted', departed_at = p_gifted_on::timestamptz
  where id = selected_bottle.id and household_id = p_household_id;
  return gift_id;
end;
$$;

create or replace function cellar.open_bottle(
  p_household_id uuid,
  p_purchase_item_id uuid,
  p_storage_location_id uuid,
  p_opened_by_person_id uuid,
  p_opened_at timestamptz,
  p_status text,
  p_enjoyed_with text,
  p_occasion text,
  p_memory_notes text,
  p_issue_type text,
  p_issue_notes text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select cellar.open_bottle_v2(
    p_household_id, p_purchase_item_id, p_storage_location_id,
    p_opened_by_person_id, p_opened_at, p_status, p_enjoyed_with,
    p_occasion, p_memory_notes, p_issue_type, p_issue_notes, false
  );
$$;

create or replace function cellar.gift_bottle(
  p_household_id uuid,
  p_purchase_item_id uuid,
  p_storage_location_id uuid,
  p_gifted_to text,
  p_gifted_on date,
  p_occasion_note text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select cellar.gift_bottle_v2(
    p_household_id, p_purchase_item_id, p_storage_location_id,
    p_gifted_to, p_gifted_on, p_occasion_note, false
  );
$$;

create or replace function cellar.record_purchase(
  p_household_id uuid,
  p_acquisition_date date,
  p_purchase_location text,
  p_selected_by_person_id uuid,
  p_purchased_by_person_id uuid,
  p_subtotal numeric,
  p_tax numeric,
  p_discount numeric,
  p_total_cost numeric,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  purchase_id uuid;
  purchase_item_id uuid;
  item jsonb;
  item_quantity integer;
  item_wine_id uuid;
  item_location_id uuid;
begin
  if not cellar_private.can_edit_household(p_household_id) then raise exception 'Not authorized to edit this household'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one purchase item is required';
  end if;

  insert into cellar.purchases (
    household_id, acquisition_date, purchase_location, selected_by_person_id,
    purchased_by_person_id, subtotal, tax, discount, total_cost, notes
  ) values (
    p_household_id, p_acquisition_date, nullif(trim(p_purchase_location), ''),
    p_selected_by_person_id, p_purchased_by_person_id, p_subtotal, p_tax,
    p_discount, p_total_cost, nullif(trim(p_notes), '')
  ) returning id into purchase_id;

  for item in select value from jsonb_array_elements(p_items) loop
    if (item->>'quantity')::numeric <> trunc((item->>'quantity')::numeric) then
      raise exception 'Bottle quantity must be a whole number';
    end if;
    item_quantity := (item->>'quantity')::integer;
    if item_quantity < 1 then raise exception 'Bottle quantity must be at least one'; end if;
    item_wine_id := (item->>'wine_id')::uuid;
    item_location_id := (item->>'storage_location_id')::uuid;

    insert into cellar.purchase_items (
      household_id, purchase_id, wine_id, quantity, unit_price,
      total_cost, current_value_per_bottle, notes
    ) values (
      p_household_id, purchase_id, item_wine_id, item_quantity,
      nullif(item->>'unit_price', '')::numeric,
      nullif(item->>'total_cost', '')::numeric,
      nullif(item->>'current_value_per_bottle', '')::numeric,
      nullif(trim(item->>'notes'), '')
    ) returning id into purchase_item_id;

    insert into cellar.inventory_movements (
      household_id, purchase_item_id, movement_type, quantity,
      to_location_id, occurred_at, reason, created_by
    ) values (
      p_household_id, purchase_item_id, 'receive', item_quantity,
      item_location_id, p_acquisition_date::timestamptz, 'Initial receipt', auth.uid()
    );

    insert into cellar.bottles (
      household_id, purchase_item_id, wine_id, storage_location_id, bottle_number
    )
    select p_household_id, purchase_item_id, item_wine_id, item_location_id, number
    from generate_series(1, item_quantity) number;
  end loop;
  return purchase_id;
end;
$$;

revoke all on function cellar.set_wine_aging_quantity(uuid, uuid, integer, integer) from public, anon;
grant execute on function cellar.set_wine_aging_quantity(uuid, uuid, integer, integer) to authenticated;
revoke all on function cellar.open_bottle_v2(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function cellar.open_bottle_v2(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, boolean) to authenticated;
revoke all on function cellar.open_bottle_with_reviews_v2(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, jsonb, boolean) from public, anon;
grant execute on function cellar.open_bottle_with_reviews_v2(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, jsonb, boolean) to authenticated;
revoke all on function cellar.gift_bottle_v2(uuid, uuid, uuid, text, date, text, boolean) from public, anon;
grant execute on function cellar.gift_bottle_v2(uuid, uuid, uuid, text, date, text, boolean) to authenticated;

commit;
