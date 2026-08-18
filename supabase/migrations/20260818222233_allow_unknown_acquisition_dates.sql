-- Historical imports may not include an acquisition date. Preserve that uncertainty
-- instead of inventing a date; newly recorded purchases still require one in the UI.
alter table public.purchases
  alter column acquisition_date drop not null;

