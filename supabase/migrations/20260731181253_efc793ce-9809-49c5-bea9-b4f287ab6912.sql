REVOKE ALL ON FUNCTION public.adjust_balance(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_balance(text, integer) TO service_role;