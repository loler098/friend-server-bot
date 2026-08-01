CREATE TABLE public.bot_gateway_status (
  id integer PRIMARY KEY DEFAULT 1,
  connected boolean DEFAULT false,
  last_heartbeat_at timestamp with time zone,
  session_id text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_gateway_status TO authenticated;
GRANT ALL ON public.bot_gateway_status TO service_role;

ALTER TABLE public.bot_gateway_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service full access" ON public.bot_gateway_status
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read" ON public.bot_gateway_status
  FOR SELECT TO authenticated USING (true);
