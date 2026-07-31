ALTER TABLE public.player_balances RENAME COLUMN balance TO balance_cents;
ALTER TABLE public.player_balances ALTER COLUMN balance_cents SET DEFAULT 100000;
UPDATE public.player_balances SET balance_cents = balance_cents * 100;
ALTER TABLE public.player_balances ADD COLUMN deposit_tag integer;

CREATE SEQUENCE IF NOT EXISTS public.deposit_tag_seq START 1;
UPDATE public.player_balances SET deposit_tag = nextval('public.deposit_tag_seq') WHERE deposit_tag IS NULL;
ALTER TABLE public.player_balances ALTER COLUMN deposit_tag SET DEFAULT nextval('public.deposit_tag_seq');
ALTER TABLE public.player_balances ALTER COLUMN deposit_tag SET NOT NULL;
ALTER TABLE public.player_balances ADD CONSTRAINT player_balances_deposit_tag_key UNIQUE (deposit_tag);

CREATE TABLE public.deposit_addresses (
  id uuid primary key default gen_random_uuid(),
  coin text not null unique,
  address text not null,
  min_confirmations integer not null default 2,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT ALL ON public.deposit_addresses TO service_role;
ALTER TABLE public.deposit_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct client access to deposit addresses"
  ON public.deposit_addresses FOR SELECT USING (false);

CREATE TABLE public.deposits (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text,
  coin text not null,
  tx_hash text not null,
  address text not null,
  crypto_amount numeric not null default 0,
  eur_cents integer not null default 0,
  confirmations integer not null default 0,
  status text not null default 'pending',
  credited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (coin, tx_hash)
);
GRANT ALL ON public.deposits TO service_role;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct client access to deposits"
  ON public.deposits FOR SELECT USING (false);

CREATE TABLE public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null,
  discord_username text not null,
  coin text not null,
  address text not null,
  eur_cents integer not null,
  fee_cents integer not null default 0,
  status text not null default 'pending',
  tx_hash text,
  released_by text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT ALL ON public.withdrawals TO service_role;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct client access to withdrawals"
  ON public.withdrawals FOR SELECT USING (false);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_deposit_addresses_updated_at BEFORE UPDATE ON public.deposit_addresses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_deposits_updated_at BEFORE UPDATE ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_withdrawals_updated_at BEFORE UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.adjust_balance(_discord_user_id text, _delta_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_balance integer;
BEGIN
  UPDATE public.player_balances
    SET balance_cents = balance_cents + _delta_cents, updated_at = now()
  WHERE discord_user_id = _discord_user_id
    AND balance_cents + _delta_cents >= 0
  RETURNING balance_cents INTO new_balance;
  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'insufficient_funds';
  END IF;
  RETURN new_balance;
END;
$$;