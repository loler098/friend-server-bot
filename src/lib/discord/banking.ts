import { adjustBalance, getAdminClient, getOrCreatePlayer } from "./games";
import {
  COINS,
  INTENT_WINDOW_MINUTES,
  MIN_WITHDRAW_CENTS,
  WITHDRAW_FEE_BPS,
  fetchIncoming,
  getDepositAddress,
  getEurPrice,
  isCoin,
  type Coin,
} from "./crypto";

/** Opens a deposit intent so the scanner can attribute the next incoming tx. */
export async function createDepositIntent(
  discordUserId: string,
  discordUsername: string,
  coin: Coin,
) {
  await getOrCreatePlayer(discordUserId, discordUsername);
  const wallet = await getDepositAddress(coin);
  if (!wallet) return null;

  const supabase = getAdminClient();
  await supabase
    .from("deposits")
    .update({ status: "expired" })
    .eq("discord_user_id", discordUserId)
    .eq("coin", coin)
    .eq("status", "intent");

  const { error } = await supabase.from("deposits").insert({
    discord_user_id: discordUserId,
    coin,
    tx_hash: `intent:${crypto.randomUUID()}`,
    address: wallet.address,
    status: "intent",
  });
  if (error) throw new Error(error.message);
  return wallet;
}

/**
 * Locks an exact crypto amount to the user's open intent so the scanner can
 * match the incoming transaction by amount.
 */
export async function setDepositIntentAmount(
  discordUserId: string,
  discordUsername: string,
  coin: Coin,
  eurCents: number,
) {
  const wallet = await getDepositAddress(coin);
  if (!wallet) return null;
  await getOrCreatePlayer(discordUserId, discordUsername);

  const price = await getEurPrice(coin);
  const decimals = Math.min(8, COINS[coin].decimals);
  const cryptoAmount = Number(((eurCents / 100) / price).toFixed(decimals));
  if (!(cryptoAmount > 0)) return null;

  const supabase = getAdminClient();
  await supabase
    .from("deposits")
    .update({ status: "expired" })
    .eq("discord_user_id", discordUserId)
    .eq("coin", coin)
    .eq("status", "intent");

  const { error } = await supabase.from("deposits").insert({
    discord_user_id: discordUserId,
    coin,
    tx_hash: `intent:${crypto.randomUUID()}`,
    address: wallet.address,
    crypto_amount: cryptoAmount,
    eur_cents: eurCents,
    status: "intent",
  });
  if (error) throw new Error(error.message);

  return { wallet, cryptoAmount, decimals };
}

export type ScanResult = {
  credited: Array<{ discordUserId: string; coin: Coin; eurCents: number; hash: string }>;
  seen: number;
};

/** Checks every configured wallet for new incoming transactions and credits them. */
export async function scanDeposits(): Promise<ScanResult> {
  const supabase = getAdminClient();
  const credited: ScanResult["credited"] = [];
  let seen = 0;

  const { data: wallets } = await supabase
    .from("deposit_addresses")
    .select("*")
    .eq("active", true);

  for (const wallet of wallets ?? []) {
    if (!isCoin(wallet.coin)) continue;
    const coin = wallet.coin;

    let txs;
    try {
      txs = await fetchIncoming(coin, wallet.address);
    } catch {
      continue;
    }
    if (txs.length === 0) continue;

    let price: number;
    try {
      price = await getEurPrice(coin);
    } catch {
      continue;
    }

    for (const tx of txs) {
      if (tx.amount <= 0) continue;
      seen++;

      const { data: existing } = await supabase
        .from("deposits")
        .select("*")
        .eq("coin", coin)
        .eq("tx_hash", tx.hash)
        .maybeSingle();

      let row = existing;

      if (!row) {
        const since = new Date(Date.now() - INTENT_WINDOW_MINUTES * 60_000).toISOString();
        const { data: intents } = await supabase
          .from("deposits")
          .select("*")
          .eq("coin", coin)
          .eq("status", "intent")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(50);

        // Prefer an intent whose declared amount matches this transaction.
        const open = intents ?? [];
        const matched = open.find(
          (i) =>
            Number(i.crypto_amount) > 0 &&
            Math.abs(Number(i.crypto_amount) - tx.amount) <=
              Math.max(Number(i.crypto_amount) * 0.01, 1e-8),
        );
        const intent = matched ?? open.find((i) => !(Number(i.crypto_amount) > 0)) ?? null;

        const eurCents = Math.round(tx.amount * price * 100);
        const { data: inserted } = await supabase
          .from("deposits")
          .insert({
            discord_user_id: intent?.discord_user_id ?? null,
            coin,
            tx_hash: tx.hash,
            address: wallet.address,
            crypto_amount: tx.amount,
            eur_cents: eurCents,
            confirmations: tx.confirmations,
            status: "pending",
          })
          .select("*")
          .maybeSingle();

        if (intent) {
          await supabase.from("deposits").update({ status: "matched" }).eq("id", intent.id);
        }
        row = inserted;
      } else if (row.confirmations !== tx.confirmations) {
        await supabase
          .from("deposits")
          .update({ confirmations: tx.confirmations })
          .eq("id", row.id);
        row = { ...row, confirmations: tx.confirmations };
      }

      if (
        row &&
        !row.credited &&
        row.discord_user_id &&
        tx.confirmations >= wallet.min_confirmations
      ) {
        await adjustBalance(row.discord_user_id, row.eur_cents);
        await supabase
          .from("deposits")
          .update({ credited: true, status: "credited" })
          .eq("id", row.id);
        credited.push({
          discordUserId: row.discord_user_id,
          coin,
          eurCents: row.eur_cents,
          hash: tx.hash,
        });
      }
    }
  }

  return { credited, seen };
}

export async function requestWithdrawal(
  discordUserId: string,
  discordUsername: string,
  coin: Coin,
  address: string,
  eurCents: number,
) {
  if (eurCents < MIN_WITHDRAW_CENTS) return { error: "min" as const };

  const supabase = getAdminClient();
  const { count } = await supabase
    .from("withdrawals")
    .select("id", { count: "exact", head: true })
    .eq("discord_user_id", discordUserId)
    .eq("status", "pending");
  if ((count ?? 0) >= 3) return { error: "too_many" as const };

  const fee = Math.round((eurCents * WITHDRAW_FEE_BPS) / 10000);

  try {
    await adjustBalance(discordUserId, -eurCents);
  } catch {
    return { error: "insufficient" as const };
  }

  const { data, error } = await supabase
    .from("withdrawals")
    .insert({
      discord_user_id: discordUserId,
      discord_username: discordUsername,
      coin,
      address,
      eur_cents: eurCents,
      fee_cents: fee,
      status: "pending",
    })
    .select("*")
    .single();

  if (error || !data) {
    await adjustBalance(discordUserId, eurCents);
    return { error: "failed" as const };
  }

  const price = await getEurPrice(coin).catch(() => null);
  const cryptoAmount = price ? (eurCents - fee) / 100 / price : null;
  return { withdrawal: data, feeCents: fee, cryptoAmount, decimals: COINS[coin].decimals };
}

export async function listPendingWithdrawals() {
  const { data } = await getAdminClient()
    .from("withdrawals")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(15);
  return data ?? [];
}

export async function settleWithdrawal(id: string, action: "paid" | "reject", txHash?: string) {
  const supabase = getAdminClient();
  const { data: row } = await supabase
    .from("withdrawals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status !== "pending") return null;

  if (action === "reject") {
    await adjustBalance(row.discord_user_id, row.eur_cents);
    await supabase.from("withdrawals").update({ status: "rejected" }).eq("id", id);
  } else {
    await supabase
      .from("withdrawals")
      .update({ status: "paid", tx_hash: txHash ?? null })
      .eq("id", id);
  }
  return row;
}
