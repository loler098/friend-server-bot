select cron.unschedule('discord-gateway-keepalive');
select cron.schedule('discord-gateway-keepalive','* * * * *', $$
  select net.http_post(
    url:='https://friend-server-bot.lovable.app/api/public/discord/gateway?action=start',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable_AidU5L0V0uzDWxHEd7Jyig_IukHEEYH"}'::jsonb,
    body:='{}'::jsonb,
    timeout_milliseconds:=55000
  );
$$);