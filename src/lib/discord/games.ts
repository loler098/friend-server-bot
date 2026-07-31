import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const DEFAULT_BALANCE = 1000;
const DAILY_REWARD = 500;

function getAdminClient() {
  return createClient<Database>(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export async function getOrCreatePlayer(
  discordUserId: string,
  discordUsername: string,
) {
  const supabase = getAdminClient();
  const { data: existing } = await supabase
    .from("player_balances")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .single();

  if (existing) {
    return existing;
  }

  const { data: created, error } = await supabase
    .from("player_balances")
    .insert({
      discord_user_id: discordUserId,
      discord_username: discordUsername,
      balance: DEFAULT_BALANCE,
    })
    .select("*")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Failed to create player");
  }

  return created;
}

export async function updateBalance(
  discordUserId: string,
  amount: number,
  dailyClaimed?: Date,
) {
  const supabase = getAdminClient();
  const update: {
    balance?: number;
    daily_claimed_at?: string;
    updated_at?: string;
  } = { balance: amount, updated_at: new Date().toISOString() };
  if (dailyClaimed) {
    update.daily_claimed_at = dailyClaimed.toISOString();
  }

  const { data, error } = await supabase
    .from("player_balances")
    .update(update)
    .eq("discord_user_id", discordUserId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update balance");
  }

  return data;
}

export async function claimDaily(discordUserId: string, discordUsername: string) {
  const player = await getOrCreatePlayer(discordUserId, discordUsername);
  const now = new Date();

  if (player.daily_claimed_at) {
    const lastClaim = new Date(player.daily_claimed_at);
    const hoursSince = (now.getTime() - lastClaim.getTime()) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      const remaining = Math.ceil(24 - hoursSince);
      return {
        success: false,
        player,
        remainingHours: remaining,
      };
    }
  }

  const updated = await updateBalance(
    discordUserId,
    player.balance + DAILY_REWARD,
    now,
  );

  return {
    success: true,
    player: updated,
    reward: DAILY_REWARD,
  };
}

export async function getLeaderboard(limit = 10) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("player_balances")
    .select("*")
    .order("balance", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

const SLOTS_SYMBOLS = ["🍒", "🍋", "🍇", "🍀", "💎", "7️⃣"];

export function spinSlots() {
  return [
    SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)],
    SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)],
    SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)],
  ];
}

export function calculateSlotsPayout(bet: number, result: string[]) {
  const [a, b, c] = result;

  // Three of a kind
  if (a === b && b === c) {
    if (a === "💎") return bet * 10;
    if (a === "7️⃣") return bet * 5;
    if (a === "🍀") return bet * 3;
    return bet * 2;
  }

  // Two matches
  if (a === b || b === c || a === c) {
    const pair = a === b ? a : c;
    if (pair === "💎") return Math.floor(bet * 1.5);
    if (pair === "7️⃣") return Math.floor(bet * 1.5);
    return Math.floor(bet * 1.2);
  }

  return 0;
}

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
    const b = array[j]!;
    array[i] = b;
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
    const v = cardValue(card);
    value += v;
    if (card.startsWith("A")) aces++;
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

export function dealerPlay(deck: string[], hand: string[]) {
  while (handValue(hand) < 17) {
    hand.push(deck.pop()!);
  }
  return hand;
}

export function blackjackResult(
  playerHand: string[],
  dealerHand: string[],
  bet: number,
): { message: string; payout: number; playerValue: number; dealerValue: number } {
  const playerValue = handValue(playerHand);
  const dealerValue = handValue(dealerHand);

  if (playerValue > 21) {
    return {
      message: `Bust! You lose **${bet}** coins.`,
      payout: -bet,
      playerValue,
      dealerValue,
    };
  }

  if (playerValue === 21 && playerHand.length === 2) {
    if (dealerValue !== 21) {
      return {
        message: `Blackjack! You win **${Math.floor(bet * 1.5)}** coins!`,
        payout: Math.floor(bet * 1.5),
        playerValue,
        dealerValue,
      };
    }
    return {
      message: "Blackjack tie! Push.",
      payout: 0,
      playerValue,
      dealerValue,
    };
  }

  if (dealerValue > 21) {
    return {
      message: `Dealer busts! You win **${bet}** coins!`,
      payout: bet,
      playerValue,
      dealerValue,
    };
  }

  if (playerValue > dealerValue) {
    return {
      message: `You win **${bet}** coins!`,
      payout: bet,
      playerValue,
      dealerValue,
    };
  }

  if (playerValue === dealerValue) {
    return {
      message: "Push! Your bet is returned.",
      payout: 0,
      playerValue,
      dealerValue,
    };
  }

  return {
    message: `Dealer wins! You lose **${bet}** coins.`,
    payout: -bet,
    playerValue,
    dealerValue,
  };
}

export function formatCoins(amount: number): string {
  return `**${amount.toLocaleString()}**`;
}
