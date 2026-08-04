import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { formatEur } from "./money";

type PlayerRow = Database["public"]["Tables"]["player_balances"]["Row"];

const DEFAULT_BALANCE_CENTS = 0; // new players start empty and must deposit
const DAILY_REWARD_CENTS = 50000; // €500.00
const HOUSE_EDGE = 0.02;

export function getAdminClient() {
  return createClient<Database>(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function getOrCreatePlayer(
  discordUserId: string,
  discordUsername: string,
): Promise<PlayerRow> {
  const supabase = getAdminClient();
  const { data: existing } = await supabase
    .from("player_balances")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("player_balances")
    .insert({
      discord_user_id: discordUserId,
      discord_username: discordUsername,
      balance_cents: DEFAULT_BALANCE_CENTS,
    })
    .select("*")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Failed to create player");
  }
  return created;
}

/** Atomically applies a delta in cents. Throws when it would go negative. */
export async function adjustBalance(discordUserId: string, deltaCents: number): Promise<number> {
  const supabase = getAdminClient();
  const { data, error } = await supabase.rpc("adjust_balance", {
    _discord_user_id: discordUserId,
    _delta_cents: Math.round(deltaCents),
  });
  if (error) {
    if (error.message.includes("insufficient_funds")) {
      throw new Error("insufficient_funds");
    }
    throw new Error(error.message);
  }
  return data as number;
}

export async function claimDaily(
  discordUserId: string,
  discordUsername: string,
): Promise<
  | { success: true; balanceCents: number; rewardCents: number }
  | { success: false; remainingHours: number }
> {
  const player = await getOrCreatePlayer(discordUserId, discordUsername);
  const now = new Date();

  if (player.daily_claimed_at) {
    const hoursSince = (now.getTime() - new Date(player.daily_claimed_at).getTime()) / 3_600_000;
    if (hoursSince < 24) {
      return { success: false, remainingHours: Math.ceil(24 - hoursSince) };
    }
  }

  const balanceCents = await adjustBalance(discordUserId, DAILY_REWARD_CENTS);
  await getAdminClient()
    .from("player_balances")
    .update({ daily_claimed_at: now.toISOString() })
    .eq("discord_user_id", discordUserId);

  return { success: true, balanceCents, rewardCents: DAILY_REWARD_CENTS };
}

export async function getLeaderboard(limit = 10) {
  const { data, error } = await getAdminClient()
    .from("player_balances")
    .select("*")
    .order("balance_cents", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ------------------------------ Slots ------------------------------ */

const SLOTS_SYMBOLS = ["🍒", "🍋", "🍇", "🍀", "💎", "7️⃣"];

export function spinSlots() {
  const symbol = () => SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)]!;
  return [symbol(), symbol(), symbol()];
}

export function calculateSlotsPayout(bet: number, result: string[]) {
  const [a, b, c] = result;
  if (a === b && b === c) {
    if (a === "💎") return bet * 10;
    if (a === "7️⃣") return bet * 5;
    if (a === "🍀") return bet * 3;
    return bet * 2;
  }
  if (a === b || b === c || a === c) {
    const pair = a === b ? a : c;
    if (pair === "💎" || pair === "7️⃣") return Math.floor(bet * 1.5);
    return Math.floor(bet * 1.2);
  }
  return 0;
}

/* ---------------------------- Blackjack ---------------------------- */

export function dealBlackjack() {
  const deck = createDeck();
  shuffle(deck);
  const player = [deck.pop()!, deck.pop()!];
  const dealer = [deck.pop()!, deck.pop()!];
  return { player, dealer, deck };
}

function createDeck(): string[] {
  const suits = ["♠️", "♥️", "♣️", "♦️"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  return suits.flatMap((suit) => ranks.map((rank) => `${rank}${suit}`));
}

function shuffle<T>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = array[i]!;
    array[i] = array[j]!;
    array[j] = a;
  }
}

export function cardValue(card: string): number {
  const rank = card.slice(0, -2);
  if (rank === "A") return 11;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return Number.parseInt(rank, 10);
}

export function handValue(hand: string[]): number {
  let value = 0;
  let aces = 0;
  for (const card of hand) {
    value += cardValue(card);
    if (card.startsWith("A")) aces++;
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

export function dealerPlay(deck: string[], hand: string[]) {
  while (handValue(hand) < 17) hand.push(deck.pop()!);
  return hand;
}

export function blackjackResult(
  playerHand: string[],
  dealerHand: string[],
  betCents: number,
): { message: string; payout: number; playerValue: number; dealerValue: number } {
  const playerValue = handValue(playerHand);
  const dealerValue = handValue(dealerHand);
  const blackjackWin = Math.floor(betCents * 1.5);

  if (playerValue > 21) {
    return { message: `Bust! You lose ${formatEur(betCents)}.`, payout: -betCents, playerValue, dealerValue };
  }
  if (playerValue === 21 && playerHand.length === 2) {
    if (dealerValue !== 21) {
      return { message: `Blackjack! You win ${formatEur(blackjackWin)}!`, payout: blackjackWin, playerValue, dealerValue };
    }
    return { message: "Blackjack tie! Push.", payout: 0, playerValue, dealerValue };
  }
  if (dealerValue > 21) {
    return { message: `Dealer busts! You win ${formatEur(betCents)}!`, payout: betCents, playerValue, dealerValue };
  }
  if (playerValue > dealerValue) {
    return { message: `You win ${formatEur(betCents)}!`, payout: betCents, playerValue, dealerValue };
  }
  if (playerValue === dealerValue) {
    return { message: "Push! Your bet is returned.", payout: 0, playerValue, dealerValue };
  }
  return { message: `Dealer wins! You lose ${formatEur(betCents)}.`, payout: -betCents, playerValue, dealerValue };
}

/* ------------------------------ Mines ------------------------------ */

const GRID = 25;

export function playMines(mines: number, picks: number) {
  const bombs = new Set<number>();
  while (bombs.size < mines) bombs.add(Math.floor(Math.random() * GRID));

  const order = Array.from({ length: GRID }, (_, i) => i);
  shuffle(order);

  const revealed: number[] = [];
  let hitBomb = -1;
  for (const tile of order.slice(0, picks)) {
    revealed.push(tile);
    if (bombs.has(tile)) {
      hitBomb = tile;
      break;
    }
  }

  const safeCleared = hitBomb >= 0 ? revealed.length - 1 : revealed.length;
  let multiplier = 1;
  for (let i = 0; i < safeCleared; i++) {
    multiplier *= (GRID - i) / (GRID - mines - i);
  }
  multiplier *= 1 - HOUSE_EDGE;

  return {
    bombs,
    revealed,
    hitBomb,
    safeCleared,
    multiplier: hitBomb >= 0 ? 0 : Number(multiplier.toFixed(2)),
  };
}

export function renderMinesGrid(bombs: Set<number>, revealed: number[], lost: boolean) {
  const rows: string[] = [];
  for (let r = 0; r < 5; r++) {
    const cells: string[] = [];
    for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      if (revealed.includes(i)) cells.push(bombs.has(i) ? "💣" : "💎");
      else if (lost && bombs.has(i)) cells.push("🔻");
      else cells.push("⬛");
    }
    rows.push(cells.join(""));
  }
  return rows.join("\n");
}

/* ------------------------------ Towers ------------------------------ */

export const TOWER_DIFFICULTY = {
  easy: { tiles: 4, safe: 3 },
  medium: { tiles: 3, safe: 2 },
  hard: { tiles: 3, safe: 1 },
} as const;

export type TowerDifficulty = keyof typeof TOWER_DIFFICULTY;

export function playTowers(difficulty: TowerDifficulty, floors: number) {
  const { tiles, safe } = TOWER_DIFFICULTY[difficulty];
  const chance = safe / tiles;
  const rows: string[] = [];
  let cleared = 0;
  let alive = true;

  for (let f = 0; f < floors; f++) {
    if (!alive) break;
    const pick = Math.floor(Math.random() * tiles);
    const bad = new Set<number>();
    while (bad.size < tiles - safe) bad.add(Math.floor(Math.random() * tiles));
    const survived = !bad.has(pick);
    const row = Array.from({ length: tiles }, (_, i) =>
      i === pick ? (survived ? "🟩" : "🟥") : bad.has(i) ? "💀" : "⬜",
    ).join("");
    rows.unshift(`Floor ${f + 1}: ${row}`);
    if (survived) cleared++;
    else alive = false;
  }

  const multiplier = alive ? Number((Math.pow(1 / chance, cleared) * (1 - HOUSE_EDGE)).toFixed(2)) : 0;
  return { rows, cleared, alive, multiplier };
}

/* ----------------------------- Upgrader ----------------------------- */

export const UPGRADER_MULTIPLIERS = [1.5, 2, 5, 10, 50] as const;

export function playUpgrader(multiplier: number) {
  const chance = (1 / multiplier) * (1 - HOUSE_EDGE);
  const roll = Math.random();
  return { won: roll < chance, chance, roll: Number((roll * 100).toFixed(2)) };
}
