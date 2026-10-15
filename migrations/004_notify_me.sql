-- "Notify me" on shows without a date yet: a one-time Telegram alert when the date or tickets are announced.
alter table radar.events add column if not exists notify_me boolean not null default false;
