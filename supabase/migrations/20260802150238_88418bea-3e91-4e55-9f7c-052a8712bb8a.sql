DROP POLICY IF EXISTS "Public read all balances" ON public.player_balances;
REVOKE SELECT ON public.player_balances FROM anon;
GRANT ALL ON public.player_balances TO service_role;
CREATE POLICY "No direct client access to balances" ON public.player_balances FOR SELECT USING (false);