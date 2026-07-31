import type { Database } from "@/integrations/supabase/types";

export const DISCORD_API = "https://discord.com/api/v10";

export const COMMANDS = [
  {
    name: "register",
    description: "Create a gambling account with a starting balance",
    type: 1,
  },
  {
    name: "balance",
    description: "Check your coin balance",
    type: 1,
  },
  {
    name: "daily",
    description: "Claim your daily coin reward (every 24 hours)",
    type: 1,
  },
  {
    name: "coinflip",
    description: "Flip a coin for coins",
    type: 1,
    options: [
      {
        name: "amount",
        description: "Amount to bet",
        type: 4,
        required: true,
        min_value: 1,
      },
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
      {
        name: "amount",
        description: "Amount to bet",
        type: 4,
        required: true,
        min_value: 1,
      },
    ],
  },
  {
    name: "blackjack",
    description: "Play a hand of blackjack against the dealer",
    type: 1,
    options: [
      {
        name: "amount",
        description: "Amount to bet",
        type: 4,
        required: true,
        min_value: 1,
      },
    ],
  },
  {
    name: "leaderboard",
    description: "Show the richest players",
    type: 1,
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
