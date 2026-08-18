begin;

create or replace function public.open_bottle_with_reviews(
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
  p_reviews jsonb default '[]'::jsonb
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
  if p_reviews is null or jsonb_typeof(p_reviews) <> 'array' then
    raise exception 'Reviews must be an array';
  end if;

  opening_id := public.open_bottle(
    p_household_id, p_purchase_item_id, p_storage_location_id,
    p_opened_by_person_id, p_opened_at, p_status, p_enjoyed_with,
    p_occasion, p_memory_notes, p_issue_type, p_issue_notes
  );

  for review in select value from jsonb_array_elements(p_reviews)
  loop
    insert into public.tasting_reviews (
      household_id, opening_id, person_id, rating, buy_again, tasting_notes
    ) values (
      p_household_id,
      opening_id,
      (review->>'person_id')::uuid,
      nullif(review->>'rating', '')::numeric,
      nullif(review->>'buy_again', ''),
      nullif(trim(review->>'tasting_notes'), '')
    );
  end loop;

  return opening_id;
end;
$$;

revoke execute on function public.open_bottle_with_reviews(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.open_bottle_with_reviews(uuid, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, jsonb) to authenticated;

commit;
