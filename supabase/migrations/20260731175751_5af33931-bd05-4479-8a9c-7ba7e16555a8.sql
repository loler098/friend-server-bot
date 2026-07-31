CREATE TABLE public.player_balances (
    id uuid primary key default gen_random_uuid(),
    discord_user_id text not null unique,
    discord_username text not null,
    balance integer not null default 1000,
    daily_claimed_at timestamp with time zone,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_balances TO authenticated;
GRANT ALL ON public.player_balances TO service_role;
GRANT SELECT ON public.player_balances TO anon;

ALTER TABLE public.player_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read all balances"
ON public.player_balances
FOR SELECT
TO public
USING (true);