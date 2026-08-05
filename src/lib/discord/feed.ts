import { getAdminClient } from "./games";
import { formatEur } from "./money";
import { randomSeed, roundId as makeRoundId, sha256 } from "./fair";
import { resolveChannel } from "./config";
import { sendMessage } from "./rest";
import { COLORS, IS_COMPONENTS_V2, button, container, row, separator, stats, text, title } from "./ui";

export const GAME_FEED_CHANNEL = "game-results";

export type GameRecord = {
  userId: string;
  username: string;
  game: string;
  betCents: number;
  payoutCents: number;
  detail?: string;
  guildId?: string;
};

/** Persists a finished round and posts it to the #game-results feed. */
export async function recordGame(rec: GameRecord): Promise<string> {
  const roundId = makeRoundId();
  const seed = randomSeed();
  const hash = await sha256(`${seed}:${roundId}`);
  const multiplier = rec.betCents > 0 ? Number((rec.payoutCents / rec.betCents).toFixed(4)) : 0;
  const result = rec.payoutCents > rec.betCents ? "win" : rec.payoutCents === rec.betCents ? "push" : "loss";

  try {
    await getAdminClient()
      .from("game_results")
      .insert({
        round_id: roundId,
        discord_user_id: rec.userId,
        discord_username: rec.username,
        game: rec.game,
        bet_cents: rec.betCents,
        payout_cents: rec.payoutCents,
        multiplier,
        result,
        server_seed: seed,
        server_seed_hash: hash,
        detail: rec.detail ?? null,
      });
  } catch (error) {
    console.error("recordGame insert failed", error);
  }

  void postToFeed(rec, roundId, multiplier, result).catch((e) =>
    console.error("feed post failed", e),
  );

  return roundId;
}

async function postToFeed(rec: GameRecord, roundId: string, multiplier: number, result: string) {
  const channelId = await resolveChannel(rec.guildId, GAME_FEED_CHANNEL);
  if (!channelId) return;

  const isWin = result === "win";
  const accent = isWin ? COLORS.win : result === "push" ? COLORS.neutral : COLORS.loss;
  const profit = rec.payoutCents - rec.betCents;

  await sendMessage(channelId, {
    flags: IS_COMPONENTS_V2,
    components: [
      container(accent, [
        title(
          isWin ? "🟢" : result === "push" ? "⚪" : "🔴",
          `${rec.game.toUpperCase()} · ${isWin ? "WIN" : result === "push" ? "PUSH" : "LOSS"}`,
          `<@${rec.userId}> · Round \`${roundId}\``,
        ),
        text(
          stats([
            ["Bet", formatEur(rec.betCents)],
            ["Multiplier", `${multiplier.toFixed(2)}x`],
            ["Payout", formatEur(rec.payoutCents)],
            [isWin ? "Profit" : "Net", `${profit >= 0 ? "+" : ""}${formatEur(profit)}`],
          ]) + (rec.detail ? `\n> **Detail** · ${rec.detail}` : ""),
        ),
        separator(),
        row(button({ style: 2, label: "✅ Verify", custom_id: `verify:${roundId}` })),
      ]),
    ],
  });
}

/* --------------------------------- RTP --------------------------------- */

export async function getRtpStats() {
  const { data } = await getAdminClient()
    .from("game_results")
    .select("bet_cents,payout_cents")
    .order("created_at", { ascending: false })
    .limit(10000);

  const rows = data ?? [];
  const wagered = rows.reduce((s, r) => s + (r.bet_cents ?? 0), 0);
  const paid = rows.reduce((s, r) => s + (r.payout_cents ?? 0), 0);
  return {
    bets: rows.length,
    wageredCents: wagered,
    payoutCents: paid,
    rtp: wagered > 0 ? (paid / wagered) * 100 : 0,
  };
}

export async function getRound(roundId: string) {
  const { data } = await getAdminClient()
    .from("game_results")
    .select("*")
    .eq("round_id", roundId)
    .maybeSingle();
  return data;
}
