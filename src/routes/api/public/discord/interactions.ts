import { createFileRoute } from "@tanstack/react-router";
import { verifyDiscordKey } from "@/lib/discord/verify";
import {
  adjustBalance,
  blackjackResult,
  calculateSlotsPayout,
  claimDaily,
  dealBlackjack,
  dealerPlay,
  getLeaderboard,
  getOrCreatePlayer,
  handValue,
  playMines,
  playTowers,
  playUpgrader,
  renderMinesGrid,
  spinSlots,
  TOWER_DIFFICULTY,
  type TowerDifficulty,
} from "@/lib/discord/games";
import { formatEur, toCents } from "@/lib/discord/money";
import {
  COINS,
  MIN_WITHDRAW_CENTS,
  getDepositAddress,
  isAdmin,
  isCoin,
  setDepositAddress,
  validateAddress,
  type Coin,
} from "@/lib/discord/crypto";
import {
  createDepositIntent,
  listPendingWithdrawals,
  requestWithdrawal,
  settleWithdrawal,
} from "@/lib/discord/banking";
import { makeChannelResponse, makeEphemeralResponse, mention } from "@/lib/discord/commands";

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
        if (interaction.type === 1) return Response.json({ type: 1 });
        if (interaction.type === 2) return handleApplicationCommand(interaction);
        return Response.json({ type: 4, data: { content: "Unknown interaction type" } });
      },
    },
  },
});

type Option = { name: string; value: string | number };

function opt(interaction: any, name: string): string | number | undefined {
  const options: Option[] = interaction.data?.options ?? [];
  return options.find((o) => o.name === name)?.value;
}

function betCents(interaction: any): number | null {
  const raw = opt(interaction, "amount");
  if (raw === undefined) return null;
  const cents = toCents(raw as number);
  if (cents === null || cents < 10) return null;
  return cents;
}

async function handleApplicationCommand(interaction: any) {
  const caller = interaction.user ?? interaction.member?.user;
  if (!caller) return makeEphemeralResponse("Could not identify the caller.");

  const userId: string = caller.id;
  const username: string = caller.username ?? caller.global_name ?? "Unknown";
  const name: string = interaction.data.name;

  try {
    switch (name) {
      case "register":
        return await handleRegister(userId, username);
      case "balance":
        return await handleBalance(userId, username);
      case "daily":
        return await handleDaily(userId, username);
      case "coinflip":
        return await handleCoinflip(interaction, userId, username);
      case "slots":
        return await handleSlots(interaction, userId, username);
      case "blackjack":
        return await handleBlackjack(interaction, userId, username);
      case "mines":
        return await handleMines(interaction, userId, username);
      case "towers":
        return await handleTowers(interaction, userId, username);
      case "upgrader":
        return await handleUpgrader(interaction, userId, username);
      case "deposit":
        return await handleDeposit(interaction, userId, username);
      case "withdraw":
        return await handleWithdraw(interaction, userId, username);
      case "leaderboard":
        return await handleLeaderboard();
      case "payouts":
        return await handlePayouts(interaction, userId);
      case "setwallet":
        return await handleSetWallet(interaction, userId);
      default:
        return makeEphemeralResponse("Unknown command.");
    }
  } catch (error) {
    console.error("Command failed", name, error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message === "insufficient_funds") {
      return makeEphemeralResponse("You do not have enough balance for that.");
    }
    return makeEphemeralResponse(`Something went wrong: ${message}`);
  }
}

/* ------------------------------ Account ------------------------------ */

async function handleRegister(userId: string, username: string) {
  const player = await getOrCreatePlayer(userId, username);
  return makeEphemeralResponse(
    `Account ready. Balance: **${formatEur(player.balance_cents)}**\nUse \`/daily\` for a free bonus or \`/deposit\` to top up with crypto.`,
  );
}

async function handleBalance(userId: string, username: string) {
  const player = await getOrCreatePlayer(userId, username);
  return makeEphemeralResponse(`Your balance: **${formatEur(player.balance_cents)}**`);
}

async function handleDaily(userId: string, username: string) {
  const result = await claimDaily(userId, username);
  if (!result.success) {
    return makeEphemeralResponse(`Already claimed. Try again in ~${result.remainingHours}h.`);
  }
  return makeEphemeralResponse(
    `Claimed **${formatEur(result.rewardCents)}**! New balance: **${formatEur(result.balanceCents)}**`,
  );
}

async function handleLeaderboard() {
  const players = await getLeaderboard();
  if (players.length === 0) return makeEphemeralResponse("No players yet.");
  const lines = players.map(
    (p, i) => `**${i + 1}.** ${p.discord_username} — ${formatEur(p.balance_cents)}`,
  );
  return makeEphemeralResponse(`🏆 **Leaderboard**\n${lines.join("\n")}`);
}

/* -------------------------------- Games -------------------------------- */

async function requireBet(interaction: any, userId: string, username: string) {
  const bet = betCents(interaction);
  if (bet === null) return { error: makeEphemeralResponse("Enter a bet of at least €0.10.") };
  const player = await getOrCreatePlayer(userId, username);
  if (player.balance_cents < bet) {
    return {
      error: makeEphemeralResponse(
        `Not enough balance. You have ${formatEur(player.balance_cents)}.`,
      ),
    };
  }
  return { bet };
}

async function handleCoinflip(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;
  const side = String(opt(interaction, "side"));

  const flip = Math.random() < 0.5 ? "heads" : "tails";
  const won = flip === side;
  const balance = await adjustBalance(userId, won ? bet : -bet);

  return makeChannelResponse(
    `🪙 ${mention(userId)} flipped **${flip}** (called ${side})\n${
      won ? `Won **${formatEur(bet)}**` : `Lost **${formatEur(bet)}**`
    } — balance ${formatEur(balance)}`,
  );
}

async function handleSlots(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;

  const result = spinSlots();
  const payout = calculateSlotsPayout(bet, result);
  const delta = payout - bet;
  const balance = await adjustBalance(userId, delta);

  return makeChannelResponse(
    `🎰 ${mention(userId)} spun **${result.join(" | ")}**\n${
      payout > 0 ? `Won **${formatEur(payout)}**` : `Lost **${formatEur(bet)}**`
    } — balance ${formatEur(balance)}`,
  );
}

async function handleBlackjack(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;

  const { player, dealer, deck } = dealBlackjack();
  while (handValue(player) < 17) player.push(deck.pop()!);
  const finalDealer = handValue(player) > 21 ? dealer : dealerPlay(deck, dealer);
  const outcome = blackjackResult(player, finalDealer, bet);
  const balance = await adjustBalance(userId, outcome.payout);

  return makeChannelResponse(
    `🃏 ${mention(userId)} plays blackjack for ${formatEur(bet)}\n` +
      `Your hand: ${player.join(" ")} (**${outcome.playerValue}**)\n` +
      `Dealer: ${finalDealer.join(" ")} (**${outcome.dealerValue}**)\n` +
      `${outcome.message} — balance ${formatEur(balance)}`,
  );
}

async function handleMines(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;

  const mines = Number(opt(interaction, "mines"));
  const picks = Number(opt(interaction, "picks"));
  if (picks > 25 - mines) {
    return makeEphemeralResponse(`With ${mines} mines you can reveal at most ${25 - mines} tiles.`);
  }

  const game = playMines(mines, picks);
  const lost = game.hitBomb >= 0;
  const payout = lost ? 0 : Math.floor(bet * game.multiplier);
  const balance = await adjustBalance(userId, payout - bet);

  return makeChannelResponse(
    `💣 ${mention(userId)} plays mines for ${formatEur(bet)} (${mines} mines, ${picks} picks)\n` +
      `${renderMinesGrid(game.bombs, game.revealed, lost)}\n` +
      (lost
        ? `Hit a mine after ${game.safeCleared} safe tiles. Lost **${formatEur(bet)}**`
        : `Cleared ${game.safeCleared} tiles at **${game.multiplier}x** — won **${formatEur(payout - bet)}**`) +
      ` — balance ${formatEur(balance)}`,
  );
}

async function handleTowers(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;

  const difficulty = String(opt(interaction, "difficulty")) as TowerDifficulty;
  if (!(difficulty in TOWER_DIFFICULTY)) return makeEphemeralResponse("Unknown difficulty.");
  const floors = Number(opt(interaction, "floors"));

  const game = playTowers(difficulty, floors);
  const payout = game.alive ? Math.floor(bet * game.multiplier) : 0;
  const balance = await adjustBalance(userId, payout - bet);

  return makeChannelResponse(
    `🗼 ${mention(userId)} climbs the ${difficulty} tower for ${formatEur(bet)}\n` +
      `${game.rows.join("\n")}\n` +
      (game.alive
        ? `Reached the top at **${game.multiplier}x** — won **${formatEur(payout - bet)}**`
        : `Fell on floor ${game.cleared + 1}. Lost **${formatEur(bet)}**`) +
      ` — balance ${formatEur(balance)}`,
  );
}

async function handleUpgrader(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;

  const multiplier = Number(opt(interaction, "multiplier"));
  const game = playUpgrader(multiplier);
  const payout = game.won ? Math.floor(bet * multiplier) : 0;
  const balance = await adjustBalance(userId, payout - bet);

  return makeChannelResponse(
    `⚡ ${mention(userId)} tries a **${multiplier}x** upgrade with ${formatEur(bet)}\n` +
      `Chance ${(game.chance * 100).toFixed(1)}% — rolled ${game.roll}\n` +
      (game.won
        ? `Upgraded! Won **${formatEur(payout - bet)}**`
        : `Failed. Lost **${formatEur(bet)}**`) +
      ` — balance ${formatEur(balance)}`,
  );
}

/* ------------------------------- Banking ------------------------------- */

async function handleDeposit(interaction: any, userId: string, username: string) {
  const coinRaw = String(opt(interaction, "coin"));
  if (!isCoin(coinRaw)) return makeEphemeralResponse("Unsupported coin.");
  const coin: Coin = coinRaw;

  const wallet = await createDepositIntent(userId, username, coin);
  if (!wallet) {
    return makeEphemeralResponse(
      `${COINS[coin].label} deposits are not configured yet. Ask an admin to run \`/setwallet\`.`,
    );
  }

  return makeEphemeralResponse(
    `**Deposit ${COINS[coin].label}**\n` +
      `Send to:\n\`${wallet.address}\`\n\n` +
      `Your payment is matched to you for the next 2 hours, credited in euros at the live rate after ${wallet.min_confirmations} confirmation(s). Only send ${COINS[coin].label} to this address.`,
  );
}

async function handleWithdraw(interaction: any, userId: string, username: string) {
  const coinRaw = String(opt(interaction, "coin"));
  if (!isCoin(coinRaw)) return makeEphemeralResponse("Unsupported coin.");
  const coin: Coin = coinRaw;

  const address = String(opt(interaction, "address") ?? "").trim();
  if (!validateAddress(coin, address)) {
    return makeEphemeralResponse(`That does not look like a valid ${COINS[coin].label} address.`);
  }

  const cents = toCents(Number(opt(interaction, "amount")));
  if (cents === null) return makeEphemeralResponse("Invalid amount.");

  const result = await requestWithdrawal(userId, username, coin, address, cents);
  if ("error" in result) {
    switch (result.error) {
      case "min":
        return makeEphemeralResponse(`Minimum withdrawal is ${formatEur(MIN_WITHDRAW_CENTS)}.`);
      case "too_many":
        return makeEphemeralResponse("You already have 3 pending payout requests.");
      case "insufficient":
        return makeEphemeralResponse("Not enough balance for that withdrawal.");
      default:
        return makeEphemeralResponse("Could not create the payout request. Try again.");
    }
  }

  const crypto =
    result.cryptoAmount !== null
      ? ` (~${result.cryptoAmount.toFixed(Math.min(8, result.decimals))} ${coin})`
      : "";
  return makeEphemeralResponse(
    `Payout requested: **${formatEur(cents)}**${crypto} to \`${address}\`\n` +
      `Fee: ${formatEur(result.feeCents)} · Request id: \`${result.withdrawal.id}\`\n` +
      `An admin will release it shortly. The amount is already reserved from your balance.`,
  );
}

/* -------------------------------- Admin -------------------------------- */

async function handlePayouts(interaction: any, userId: string) {
  if (!isAdmin(userId)) return makeEphemeralResponse("Admins only.");
  const action = String(opt(interaction, "action") ?? "list");

  if (action === "list") {
    const rows = await listPendingWithdrawals();
    if (rows.length === 0) return makeEphemeralResponse("No pending payouts.");
    const lines = rows.map(
      (r) =>
        `\`${r.id}\` — ${r.discord_username} · ${formatEur(r.eur_cents)} ${r.coin} → \`${r.address}\``,
    );
    return makeEphemeralResponse(`**Pending payouts**\n${lines.join("\n")}`);
  }

  const id = String(opt(interaction, "id") ?? "");
  if (!id) return makeEphemeralResponse("Provide the withdrawal id.");
  const tx = opt(interaction, "tx");
  const row = await settleWithdrawal(id, action === "paid" ? "paid" : "reject", tx as string);
  if (!row) return makeEphemeralResponse("No pending payout with that id.");

  return makeEphemeralResponse(
    action === "paid"
      ? `Marked ${formatEur(row.eur_cents)} to ${row.discord_username} as paid.`
      : `Rejected and refunded ${formatEur(row.eur_cents)} to ${row.discord_username}.`,
  );
}

async function handleSetWallet(interaction: any, userId: string) {
  if (!isAdmin(userId)) return makeEphemeralResponse("Admins only.");
  const coinRaw = String(opt(interaction, "coin"));
  if (!isCoin(coinRaw)) return makeEphemeralResponse("Unsupported coin.");
  const address = String(opt(interaction, "address") ?? "").trim();
  if (!validateAddress(coinRaw, address)) {
    return makeEphemeralResponse(`That does not look like a valid ${coinRaw} address.`);
  }
  const confirmations = Number(opt(interaction, "confirmations") ?? (coinRaw === "BTC" ? 2 : 12));
  await setDepositAddress(coinRaw, address, confirmations);
  const existing = await getDepositAddress(coinRaw);
  return makeEphemeralResponse(
    `${coinRaw} deposits now go to \`${existing?.address}\` (${existing?.min_confirmations} confirmations).`,
  );
}
