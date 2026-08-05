CREATE TABLE public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  amount_cents integer not null,
  max_uses integer not null default 1,
  uses integer not null default 0,
  created_by text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
GRANT ALL ON public.promo_codes TO service_role;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct client access to promo codes" ON public.promo_codes FOR SELECT USING (false);

CREATE TABLE public.promo_claims (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references public.promo_codes(id) on delete cascade,
  discord_user_id text not null,
  discord_username text not null,
  amount_cents integer not null,
  created_at timestamptz not null default now(),
  unique (promo_id, discord_user_id)
);
GRANT ALL ON public.promo_claims TO service_role;
ALTER TABLE public.promo_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct client access to promo claims" ON public.promo_claims FOR SELECT USING (false);

CREATE TABLE public.game_results (
  id uuid primary key default gen_random_uuid(),
  round_id text not null unique,
  discord_user_id text not null,
  discord_username text not null,
  game text not null,
  bet_cents integer not null,
  payout_cents integer not null,
  multiplier numeric not null default 0,
  result text not null,
  server_seed text not null,
  server_seed_hash text not null,
  detail text,
  created_at timestamptz not null default now()
);
GRANT ALL ON public.game_results TO service_role;
ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct client access to game results" ON public.game_results FOR SELECT USING (false);
CREATE INDEX game_results_created_idx ON public.game_results (created_at DESC);

CREATE TABLE public.rain_events (
  id uuid primary key default gen_random_uuid(),
  guild_id text,
  channel_id text,
  message_id text,
  prize_cents integer not null default 0,
  winners integer not null default 1,
  duration_seconds integer not null default 60,
  ends_at timestamptz,
  status text not null default 'pending',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT ALL ON public.rain_events TO service_role;
ALTER TABLE public.rain_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct client access to rain events" ON public.rain_events FOR SELECT USING (false);

CREATE TABLE public.rain_entries (
  id uuid primary key default gen_random_uuid(),
  rain_id uuid not null references public.rain_events(id) on delete cascade,
  discord_user_id text not null,
  discord_username text not null,
  created_at timestamptz not null default now(),
  unique (rain_id, discord_user_id)
);
GRANT ALL ON public.rain_entries TO service_role;
ALTER TABLE public.rain_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct client access to rain entries" ON public.rain_entries FOR SELECT USING (false);

CREATE TABLE public.bot_config (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
GRANT ALL ON public.bot_config TO service_role;
ALTER TABLE public.bot_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct client access to bot config" ON public.bot_config FOR SELECT USING (false);

CREATE TRIGGER update_rain_events_updated_at BEFORE UPDATE ON public.rain_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();