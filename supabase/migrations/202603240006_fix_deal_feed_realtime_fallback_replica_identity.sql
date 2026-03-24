-- Fix build 4 cleanup deletes for the realtime fallback table.

alter table public.deal_feed_realtime_fallback
  replica identity full;
