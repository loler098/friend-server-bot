import { createFileRoute } from "@tanstack/react-router";
import { verifyDiscordKey } from "@/lib/discord/verify";
import {
  getOrCreatePlayer,
  claimDaily,
  getLeaderboard,
  spinSlots,
  calculateSlotsPayout,
  dealBlackjack,
  handValue,
  dealerPlay,
  blackjackResult,
  updateBalance,
  formatCoins,
} from "@/lib/discord/games";
import {
  makeChannelResponse,
  makeEphemeralResponse,
  mention,
} from "@/lib/discord/commands";

export const Route = createFileRoute("/api/public/discord/interactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publicKey = process.env["DISCORD_PUBLIC_KEY"];
        if (!publicKey) {
          return new Response("Missing Discord public key", { status: 500 });
        }

        const signature = request.headers.get("X-Signature-Ed25519") ?? "";
        const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
        const body = await request.text();

        const isValid = await verifyDiscordKey(body, signature, timestamp, publicKey);
        if (!isValid) {
          return new Response("Invalid signature", { status: 401 });
        }

        const interaction = JSON.parse(body);

        if (interaction.type === 1) {
          return Response.json({ type: 1 });
        }

        if (interaction.type === 2) {
          return handleApplicationCommand(interaction);
        }

        return Response.json({ type: 4, data: { content: "Unknown interaction type" } });
      },
    },
  },
});

async function handleApplicationCommand(interaction: any) {
  const { user, member } = interaction;
  const caller = user ?? member?.user;
  if (!caller) {
    return makeEphemeralResponse("Could not identify the caller.");
  }

  const discordUserId = caller.id;
  const discordUsername = caller.username ?? caller.global_name ?? "Unknown";
  const commandName = interaction.data.name;

  try {
    switch (commandName) {
      case "register":
        return handleRegister(discordUserId, discordUsername);

      case "balance":
        return handleBalance(discordUserId, discordUsername);

      case "daily":
        return handleDaily(discordUserId, discordUsername);

      case "coinflip": {
        const amount = interaction.data.options?.find((o: any) => o.name === "amount")?.value ?? 0;
        const side = interaction.data.options?.find((o: any) => o.name === "side")?.value ?? "heads";
        return handleCoinflip(discordUserId, discordUsername, amount, side);
      }

      case "slots": {
        const amount = interaction.data.options?.find((o: any) => o.name === "amount")?.value ?? 0;
        return handleSlots(discordUserId, discordUsername, amount);
      }

      case "blackjack": {
        const amount = interaction.data.options?.find((o: any) => o.name === "amount")?.value ?? 0;
        return handleBlackjack(discordUserId, discordUsername, amount);
      }

      case "leaderboard":
        return handleLeaderboard();

      default:
        return makeEphemeralResponse(`Unknown command: ${commandName}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return makeEphemeralResponse(`Error: ${message}`);
  }
}

async function handleRegister(discordUserId: string, discordUsername: string) {
  const player = await getOrCreatePlayer(discordUserId, discordUsername);
  return makeChannelResponse(
    `${mention(discordUserId)} registered! Your starting balance is ${formatCoins(
      player.balance,
    )} coins.`,
  );
}

async function handleBalance(discordUserId: string, discordUsername: string) {
  const player = await getOrCreatePlayer(discordUserId, discordUsername);
  return makeChannelResponse(
    `${mention(discordUserId)} has ${formatCoins(player.balance)} coins.`,
  );
}

async function handleDaily(discordUserId: string, discordUsername: string) {
  const result = await claimDaily(discordUserId, discordUsername);
  if (!result.success) {
    return makeEphemeralResponse(
      `You already claimed your daily reward. Come back in **${result.remainingHours}** hour(s).`,
    );
  }
  return makeChannelResponse(
    `${mention(discordUserId)} claimed their daily reward of ${formatCoins(
      result.reward,
    )} coins! Balance: ${formatCoins(result.player.balance)}.`,
  );
}

async function handleCoinflip(
  discordUserId: string,
  discordUsername: string,
  amount: number,
  side: string,
) {
  if (!Number.isInteger(amount) || amount < 1) {
    return makeEphemeralResponse("Bet amount must be a positive integer.");
  }

  const player = await getOrCreatePlayer(discordUserId, discordUsername);
  if (player.balance < amount) {
    return makeEphemeralResponse(
      `You only have ${formatCoins(player.balance)} coins. You can't bet ${formatCoins(
        amount,
      )}.`,
    );
  }

  const outcome = Math.random() < 0.5 ? "heads" : "tails";
  const won = outcome === side.toLowerCase();
  const newBalance = player.balance + (won ? amount : -amount);
  await updateBalance(discordUserId, newBalance);

  return makeChannelResponse(
    `${mention(discordUserId)} bet ${formatCoins(amount)} on **${side}**. The coin landed **${outcome}**. ${
      won ? `You won! Balance: ${formatCoins(newBalance)}.` : `You lost! Balance: ${formatCoins(newBalance)}.`
    }`,
  );
}

async function handleSlots(
  discordUserId: string,
  discordUsername: string,
  amount: number,
) {
  if (!Number.isInteger(amount) || amount < 1) {
    return makeEphemeralResponse("Bet amount must be a positive integer.");
  }

  const player = await getOrCreatePlayer(discordUserId, discordUsername);
  if (player.balance < amount) {
    return makeEphemeralResponse(
      `You only have ${formatCoins(player.balance)} coins. You can't bet ${formatCoins(
        amount,
      )}.`,
    );
  }

  const result = spinSlots();
  const payout = calculateSlotsPayout(amount, result);
  const newBalance = player.balance - amount + payout;
  await updateBalance(discordUserId, newBalance);

  const line = result.join(" | ");
  if (payout > 0) {
    return makeChannelResponse(
      `${mention(discordUserId)} spun: ${line}\nYou won ${formatCoins(
        payout,
      )} coins! Balance: ${formatCoins(newBalance)}.`,
    );
  }

  return makeChannelResponse(
    `${mention(discordUserId)} spun: ${line}\nNo match. You lost ${formatCoins(
      amount,
    )} coins. Balance: ${formatCoins(newBalance)}.`,
  );
}

async function handleBlackjack(
  discordUserId: string,
  discordUsername: string,
  amount: number,
) {
  if (!Number.isInteger(amount) || amount < 1) {
    return makeEphemeralResponse("Bet amount must be a positive integer.");
  }

  const player = await getOrCreatePlayer(discordUserId, discordUsername);
  if (player.balance < amount) {
    return makeEphemeralResponse(
      `You only have ${formatCoins(player.balance)} coins. You can't bet ${formatCoins(
        amount,
      )}.`,
    );
  }

  const { player: playerHand, dealer: dealerHand, deck } = dealBlackjack();
  const dealerFinalHand = dealerPlay(deck, dealerHand);
  const result = blackjackResult(playerHand, dealerFinalHand, amount);
  const newBalance = player.balance + result.payout;
  await updateBalance(discordUserId, newBalance);

  return makeChannelResponse(
    `${mention(discordUserId)} bet ${formatCoins(amount)} on Blackjack.\n` +
      `Your hand: ${playerHand.join(" ")} (${result.playerValue})\n` +
      `Dealer hand: ${dealerFinalHand.join(" ")} (${result.dealerValue})\n` +
      `${result.message}\n` +
      `Balance: ${formatCoins(newBalance)}.`,
  );
}

async function handleLeaderboard() {
  const leaders = await getLeaderboard(10);
  if (leaders.length === 0) {
    return makeChannelResponse("No players yet. Be the first to `/register`!");
  }

  const lines = leaders.map(
    (p, i) => `${i + 1}. **${p.discord_username}** — ${formatCoins(p.balance)} coins`,
  );
  return makeChannelResponse("🏆 **Leaderboard** 🏆\n" + lines.join("\n"));
}
