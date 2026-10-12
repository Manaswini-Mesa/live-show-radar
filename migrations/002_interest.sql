-- Interested / Not interested responses (from Telegram buttons or the dashboard)
-- and a 'suppressed' alert state for alerts made unnecessary by a response.
alter table radar.events
  add column if not exists interest text check (interest in ('interested', 'not_interested')),
  add column if not exists interest_at timestamptz;

alter table radar.alerts drop constraint if exists alerts_status_check;
alter table radar.alerts add constraint alerts_status_check
  check (status in ('pending', 'sending', 'delivered', 'failed', 'suppressed'));

-- Only these alert kinds are sent from now on: new_show, tickets_live, test.
-- Any not-yet-sent 'update' alerts from the old rules are suppressed.
update radar.alerts set status = 'suppressed', last_error = 'Superseded by notification rules (new show / tickets live only)'
  where kind = 'update' and status in ('pending', 'failed');
