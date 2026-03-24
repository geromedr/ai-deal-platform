-- Build 3: smart notification filtering
-- Adds indexes used by per-user notification throttling and decision logging.

create index if not exists idx_ai_actions_notification_user_created_at
  on public.ai_actions (deal_id, action, ((payload ->> 'user_id')), created_at desc)
  where agent = 'notification-agent'
    and action in ('deal_alert', 'notification_decision');

create index if not exists idx_deal_feed_priority_score
  on public.deal_feed (priority_score desc, updated_at desc);
