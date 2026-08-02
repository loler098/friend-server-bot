import type { Database } from "@/integrations/supabase/types";

export const DISCORD_API = "https://discord.com/api/v10";

export const COMMANDS = [
  { name: "register", description: "Create a casino account", type: 1 },
  { name: "balance", description: "Check your euro balance (private)", type: 1 },
  {
    name: "coinflip",
    description: "Flip a coin for euros",
    type: 1,
    options: [
      { name: "amount", description: "Bet in euros, e.g. 12.50", type: 10, required: true, min_value: 0.1 },
      {
        name: "side",
        description: "Heads or tails",
        type: 3,
        required: true,
        choices: [
          { name: "Heads", value: "heads" },
          { name: "Tails", value: "tails" },
        ],
      },
    ],
  },
  {
    name: "slots",
    description: "Spin the slot machine",
    type: 1,
    options: [
      { name: "amount", description: "Bet in euros, e.g. 12.50", type: 10, required: true, min_value: 0.1 },
    ],
  },
  {
    name: "blackjack",
    description: "Play a hand of blackjack against the dealer",
    type: 1,
    options: [
      { name: "amount", description: "Bet in euros, e.g. 12.50", type: 10, required: true, min_value: 0.1 },
    ],
  },
  {
    name: "mines",
    description: "Reveal tiles without hitting a mine",
    type: 1,
    options: [
      { name: "amount", description: "Bet in euros", type: 10, required: true, min_value: 0.1 },
      { name: "mines", description: "Number of mines (1-24)", type: 4, required: true, min_value: 1, max_value: 24 },
      { name: "picks", description: "How many tiles to reveal", type: 4, required: true, min_value: 1, max_value: 24 },
    ],
  },
  {
    name: "towers",
    description: "Climb the tower without stepping on a trap",
    type: 1,
    options: [
      { name: "amount", description: "Bet in euros", type: 10, required: true, min_value: 0.1 },
      {
        name: "difficulty",
        description: "Difficulty",
        type: 3,
        required: true,
        choices: [
          { name: "Easy (3 of 4 safe)", value: "easy" },
          { name: "Medium (2 of 3 safe)", value: "medium" },
          { name: "Hard (1 of 3 safe)", value: "hard" },
        ],
      },
      { name: "floors", description: "Floors to climb (1-8)", type: 4, required: true, min_value: 1, max_value: 8 },
    ],
  },
  {
    name: "upgrader",
    description: "Gamble your stake for a chosen multiplier",
    type: 1,
    options: [
      { name: "amount", description: "Bet in euros", type: 10, required: true, min_value: 0.1 },
      {
        name: "multiplier",
        description: "Target multiplier",
        type: 10,
        required: true,
        choices: [
          { name: "1.5x", value: 1.5 },
          { name: "2x", value: 2 },
          { name: "5x", value: 5 },
          { name: "10x", value: 10 },
          { name: "50x", value: 50 },
        ],
      },
    ],
  },
  {
    name: "deposit",
    description: "Get a crypto deposit address (private)",
    type: 1,
    options: [
      {
        name: "coin",
        description: "Which coin you are sending",
        type: 3,
        required: true,
        choices: [
          { name: "Bitcoin (BTC)", value: "BTC" },
          { name: "Ethereum (ETH)", value: "ETH" },
          { name: "Litecoin (LTC)", value: "LTC" },
          { name: "USDT (TRC-20)", value: "USDT" },
        ],
      },
    ],
  },
  {
    name: "withdraw",
    description: "Request a crypto payout (private)",
    type: 1,
    options: [
      {
        name: "coin",
        description: "Coin to receive",
        type: 3,
        required: true,
        choices: [
          { name: "Bitcoin (BTC)", value: "BTC" },
          { name: "Ethereum (ETH)", value: "ETH" },
          { name: "Litecoin (LTC)", value: "LTC" },
          { name: "USDT (TRC-20)", value: "USDT" },
        ],
      },
      { name: "address", description: "Your wallet address", type: 3, required: true },
      { name: "amount", description: "Amount in euros", type: 10, required: true, min_value: 10 },
    ],
  },
  { name: "leaderboard", description: "Show the richest players (private)", type: 1 },
  {
    name: "payouts",
    description: "Admin: review pending withdrawals",
    type: 1,
    options: [
      {
        name: "action",
        description: "What to do",
        type: 3,
        required: false,
        choices: [
          { name: "List pending", value: "list" },
          { name: "Mark paid", value: "paid" },
          { name: "Reject and refund", value: "reject" },
        ],
      },
      { name: "id", description: "Withdrawal id", type: 3, required: false },
      { name: "tx", description: "Transaction hash (when marking paid)", type: 3, required: false },
    ],
  },
  {
    name: "addbalance",
    description: "Owner: add euros to a player's balance",
    type: 1,
    options: [
      { name: "user", description: "Player", type: 6, required: true },
      { name: "amount", description: "Amount in euros", type: 10, required: true, min_value: 0.01 },
    ],
  },
  {
    name: "removebalance",
    description: "Owner: remove euros from a player's balance",
    type: 1,
    options: [
      { name: "user", description: "Player", type: 6, required: true },
      { name: "amount", description: "Amount in euros", type: 10, required: true, min_value: 0.01 },
    ],
  },
  {
    name: "changecoin",
    description: "Owner: change the receiving address for a coin",
    type: 1,
    options: [
      {
        name: "coin",
        description: "Coin",
        type: 3,
        required: true,
        choices: [
          { name: "Bitcoin (BTC)", value: "BTC" },
          { name: "Ethereum (ETH)", value: "ETH" },
          { name: "Litecoin (LTC)", value: "LTC" },
          { name: "USDT (TRC-20)", value: "USDT" },
        ],
      },
      { name: "address", description: "New receiving address", type: 3, required: true },
      { name: "confirmations", description: "Confirmations required", type: 4, required: false, min_value: 1, max_value: 20 },
    ],
  },
  {
    name: "setwallet",
    description: "Admin: set the receiving wallet for a coin",
    type: 1,
    options: [
      {
        name: "coin",
        description: "Coin",
        type: 3,
        required: true,
        choices: [
          { name: "Bitcoin (BTC)", value: "BTC" },
          { name: "Ethereum (ETH)", value: "ETH" },
          { name: "Litecoin (LTC)", value: "LTC" },
          { name: "USDT (TRC-20)", value: "USDT" },
        ],
      },
      { name: "address", description: "Receiving address", type: 3, required: true },
      { name: "confirmations", description: "Confirmations required", type: 4, required: false, min_value: 1, max_value: 20 },
    ],
  },
] as const;

export async function registerDiscordCommands() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is not set");
  }

  const appId = atob(token.split(".")[0]!);
  const res = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify(COMMANDS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord command registration failed: ${res.status} ${text}`);
  }

  return res.json();
}


export function makeEphemeralResponse(content: string) {
  return Response.json({
    type: 4,
    data: {
      content,
      flags: 64,
    },
  });
}

export function makeChannelResponse(content: string) {
  return Response.json({
    type: 4,
    data: {
      content,
    },
  });
}

export function mention(discordUserId: string) {
  return `<@${discordUserId}>`;
}

export type PlayerRow = Database["public"]["Tables"]["player_balances"]["Row"];
