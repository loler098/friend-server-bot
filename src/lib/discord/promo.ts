import { adjustBalance, getAdminClient, getOrCreatePlayer } from "./games";

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function createPromo(amountCents: number, maxUses: number, createdBy: string) {
  const code = randomCode();
  const { data, error } = await getAdminClient()
    .from("promo_codes")
    .insert({ code, amount_cents: amountCents, max_uses: maxUses, created_by: createdBy })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create promo code");
  return data;
}

export type ClaimResult =
  | { ok: true; amountCents: number; balanceCents: number; code: string }
  | { ok: false; reason: "unknown" | "used_up" | "already" | "inactive" };

export async function claimPromo(
  rawCode: string,
  userId: string,
  username: string,
): Promise<ClaimResult> {
  const supabase = getAdminClient();
  const code = rawCode.trim().toUpperCase();

  const { data: promo } = await supabase
    .from("promo_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (!promo) return { ok: false, reason: "unknown" };
  if (!promo.active) return { ok: false, reason: "inactive" };
  if (promo.uses >= promo.max_uses) return { ok: false, reason: "used_up" };

  await getOrCreatePlayer(userId, username);

  const { error: claimError } = await supabase.from("promo_claims").insert({
    promo_id: promo.id,
    discord_user_id: userId,
    discord_username: username,
    amount_cents: promo.amount_cents,
  });
  if (claimError) return { ok: false, reason: "already" };

  const { count } = await supabase
    .from("promo_claims")
    .select("id", { count: "exact", head: true })
    .eq("promo_id", promo.id);

  const uses = count ?? promo.uses + 1;
  if (uses > promo.max_uses) {
    await supabase.from("promo_claims").delete().eq("promo_id", promo.id).eq("discord_user_id", userId);
    return { ok: false, reason: "used_up" };
  }

  await supabase
    .from("promo_codes")
    .update({ uses, active: uses < promo.max_uses })
    .eq("id", promo.id);

  const balanceCents = await adjustBalance(userId, promo.amount_cents);
  return { ok: true, amountCents: promo.amount_cents, balanceCents, code };
}
