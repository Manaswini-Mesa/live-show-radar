-- Readers for public sites that have no API. robots.txt is checked before every fetch.
update radar.event_sources set
  name = 'SkillBox (public event sitemap)', source_type = 'sitemap', status = 'pending', enabled = true,
  coverage_notes = 'Pages are JavaScript-only, so the public event sitemap advertised in robots.txt is read instead. Recently updated listings matched to watched artists; dates are not in the sitemap (shown as TBA) and the link goes to the SkillBox page.',
  poll_interval_minutes = 120, supports_booking_url = true, config = '{"max_age_days":14}'
where id = 'skillbox';

insert into radar.event_sources (id, name, source_type, status, coverage_notes, requires_credentials, supports_booking_url, poll_interval_minutes, enabled, config) values
('music_press', 'Music press RSS', 'rss', 'pending',
 'Public RSS feeds of Indian music/entertainment press, checked against every watched artist. Reported announcements only (no dates guessed). BookMyShow, Bandsintown, Songkick, Sortmyscene and Firstpost block automated reading; HighApe and Townscript render only with JavaScript and publish no sitemap - none of these are read.',
 false, false, 60, true,
 '{"feeds":["https://rollingstoneindia.com/feed/","https://indianexpress.com/section/entertainment/music/feed/","https://www.thehindu.com/entertainment/music/feeder/default.rss","https://www.thehindu.com/entertainment/feeder/default.rss","https://www.news18.com/rss/entertainment.xml","https://www.mid-day.com/Resources/midday/rss/entertainment.xml","https://www.hindustantimes.com/feeds/rss/entertainment/music/rssfeed.xml","https://homegrown.co.in/feed"]}')
on conflict (id) do nothing;
