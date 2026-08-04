import { createFileRoute } from "@tanstack/react-router";
import { verifyDiscordKey } from "@/lib/discord/verify";
import {
  adjustBalance,
  calculateSlotsPayout,
  getLeaderboard,
  getOrCreatePlayer,
  playUpgrader,
  spinSlots,
} from "@/lib/discord/games";
import {
  handleGameComponent,
  startBlackjack,
  startMines,
  startTowers,
  TOWERS,
  type TowersDifficulty,
} from "@/lib/discord/interactive";
import { animateUpgrader } from "@/lib/discord/upgrader";
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
  setDepositIntentAmount,
  settleWithdrawal,
} from "@/lib/discord/banking";
import { makeChannelResponse, makeEphemeralResponse, mention } from "@/lib/discord/commands";

export const Route = createFileRoute("/api/public/discord/interactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publicKey = process.env["DISCORD_PUBLIC_KEY"]?.trim();
        if (!publicKey) {
          return new Response("Missing Discord public key", { status: 500 });
        }

        const signature = request.headers.get("X-Signature-Ed25519") ?? "";
        const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
        const body = await request.text();

        try {
          const isValid = await verifyDiscordKey(body, signature, timestamp, publicKey);
          if (!isValid) {
            return new Response("Invalid signature", { status: 401 });
          }

          const interaction = JSON.parse(body);
          if (interaction.type === 1) return Response.json({ type: 1 });
          if (interaction.type === 2) return await handleApplicationCommand(interaction);
          if (interaction.type === 3) return await handleComponent(interaction);
          if (interaction.type === 5) return await handleModalSubmit(interaction);
          return Response.json({ type: 4, data: { content: "Unknown interaction type" } });
        } catch (error) {
          console.error("Discord interaction handler failed", error);
          // Never bubble up: an HTML 500 shows as "The application did not respond".
          return Response.json({
            type: 4,
            data: { content: "Something went wrong handling that command.", flags: 64 },
          });
        }
      },
    },
  },
});

type Option = { name: string; value: string | number };

async function handleComponent(interaction: any) {
  const caller = interaction.user ?? interaction.member?.user;
  if (!caller) return makeEphemeralResponse("Could not identify the caller.");
  const customId: string = interaction.data?.custom_id ?? "";
  const [prefix, id, action] = customId.split(":");
  if (!prefix || !id || !action) return Response.json({ type: 6 });

  if (prefix === "dep" && action === "amount") {
    if (!isCoin(id)) return makeEphemeralResponse("Unsupported coin.");
    return Response.json({
      type: 9,
      data: {
        custom_id: `depamt:${id}`,
        title: `Deposit ${COINS[id].label}`,
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: "amount",
                label: "Amount in EUR you will send",
                style: 1,
                min_length: 1,
                max_length: 12,
                placeholder: "25.00",
                required: true,
              },
            ],
          },
        ],
      },
    });
  }

  if (prefix === "w") {
    if (!isAdmin(caller.id)) return makeEphemeralResponse("Admins only.");
    const row = await settleWithdrawal(id, action === "paid" ? "paid" : "reject");
    if (!row) return makeEphemeralResponse("No pending payout with that id.");
    return makeEphemeralResponse(
      action === "paid"
        ? `Marked ${formatEur(row.eur_cents)} to ${row.discord_username} as paid.`
        : `Refunded ${formatEur(row.eur_cents)} back to ${row.discord_username}.`,
    );
  }

  return await handleGameComponent(prefix, id, action, caller.id);
}

async function handleModalSubmit(interaction: any) {
  const caller = interaction.user ?? interaction.member?.user;
  if (!caller) return makeEphemeralResponse("Could not identify the caller.");
  const customId: string = interaction.data?.custom_id ?? "";
  const [prefix, coinRaw] = customId.split(":");
  if (prefix !== "depamt" || !coinRaw || !isCoin(coinRaw)) return Response.json({ type: 6 });

  const rows: any[] = interaction.data?.components ?? [];
  const raw = rows[0]?.components?.[0]?.value ?? "";
  const cents = toCents(Number(String(raw).replace(",", ".")));
  if (cents === null || cents <= 0) return makeEphemeralResponse("Enter a valid EUR amount.");

  const username: string = caller.username ?? caller.global_name ?? "Unknown";
  const result = await setDepositIntentAmount(caller.id, username, coinRaw, cents);
  if (!result) return makeEphemeralResponse("Could not lock that amount. Try again.");

  return makeEphemeralResponse(
    `**Send exactly \`${result.cryptoAmount.toFixed(result.decimals)} ${coinRaw}\`** (${formatEur(cents)})\n` +
      `To:\n\`${result.wallet.address}\`\n\n` +
      `The exact amount is reserved for you for the next 2 hours — once it lands with ${result.wallet.min_confirmations} confirmation(s) it is credited to your balance automatically.`,
  );
}

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
      case "changecoin":
        return await handleSetWallet(interaction, userId);
      case "addbalance":
        return await handleAdjustBalance(interaction, userId, 1);
      case "removebalance":
        return await handleAdjustBalance(interaction, userId, -1);
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
    `Account ready. Balance: **${formatEur(player.balance_cents)}**\nUse \`/deposit\` to top up with crypto.`,
  );
}

async function handleBalance(userId: string, username: string) {
  const player = await getOrCreatePlayer(userId, username);
  return makeEphemeralResponse(`Your balance: **${formatEur(player.balance_cents)}**`);
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
  return await startBlackjack(userId, username, bet);
}

async function handleMines(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;
  const mines = Number(opt(interaction, "mines"));
  if (!Number.isInteger(mines) || mines < 1 || mines > 19) {
    return makeEphemeralResponse("Pick between 1 and 19 mines.");
  }
  return await startMines(userId, username, bet, mines);
}

async function handleTowers(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;
  const difficulty = String(opt(interaction, "difficulty")) as TowersDifficulty;
  if (!(difficulty in TOWERS)) return makeEphemeralResponse("Unknown difficulty.");
  return await startTowers(userId, username, bet, difficulty);
}

async function handleUpgrader(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;

  const multiplier = Number(opt(interaction, "multiplier"));
  const game = playUpgrader(multiplier);
  const payout = game.won ? Math.floor(bet * multiplier) : 0;
  const balance = await adjustBalance(userId, payout - bet);

  const header =
    `⚡ ${mention(userId)} tries a **${multiplier}x** upgrade with ${formatEur(bet)}\n` +
    `Chance ${(game.chance * 100).toFixed(1)}%`;
  const final =
    `${header}\nRolled **${game.roll}**\n` +
    (game.won
      ? `✅ Upgraded! Won **${formatEur(payout - bet)}**`
      : `❌ Failed. Lost **${formatEur(bet)}**`) +
    ` — balance ${formatEur(balance)}`;

  const animated = await animateUpgrader(
    interaction.id,
    interaction.token,
    header,
    final,
    interaction.application_id,
  );
  if (animated) return new Response(null, { status: 202 });
  return makeChannelResponse(final);
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

  return Response.json({
    type: 4,
    data: {
      content:
        `**Deposit ${COINS[coin].label}**\n` +
        `Send to:\n\`${wallet.address}\`\n\n` +
        `Tap **Amount** to lock the exact amount you will send — it is then detected and credited automatically after ${wallet.min_confirmations} confirmation(s). Only send ${COINS[coin].label} to this address.`,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: "Amount", custom_id: `dep:${coin}:amount` },
          ],
        },
      ],
      flags: 64,
    },
  });
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
    const shown = rows.slice(0, 5);
    const lines = shown.map(
      (r) =>
        `\`${r.id}\` — ${r.discord_username} · ${formatEur(r.eur_cents)} ${r.coin} → \`${r.address}\``,
    );
    const components = shown.map((r) => ({
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: `Paid · ${r.discord_username} ${formatEur(r.eur_cents)}`,
          custom_id: `w:${r.id}:paid`,
        },
        { type: 2, style: 4, label: "Refund", custom_id: `w:${r.id}:refund` },
      ],
    }));
    return Response.json({
      type: 4,
      data: { content: `**Pending payouts**\n${lines.join("\n")}`, components, flags: 64 },
    });
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

async function handleAdjustBalance(interaction: any, userId: string, sign: 1 | -1) {
  if (!isAdmin(userId)) return makeEphemeralResponse("Owners only.");

  const targetId = String(opt(interaction, "user") ?? "");
  if (!targetId) return makeEphemeralResponse("Pick a player.");

  const cents = toCents(Number(opt(interaction, "amount")));
  if (cents === null || cents <= 0) return makeEphemeralResponse("Invalid amount.");

  const resolvedUser = interaction.data?.resolved?.users?.[targetId];
  const targetName: string = resolvedUser?.global_name ?? resolvedUser?.username ?? "Unknown";
  const player = await getOrCreatePlayer(targetId, targetName);

  const delta = sign === 1 ? cents : -Math.min(cents, player.balance_cents);
  const balance = await adjustBalance(targetId, delta);

  return makeEphemeralResponse(
    sign === 1
      ? `Added **${formatEur(cents)}** to ${mention(targetId)} — new balance ${formatEur(balance)}.`
      : `Removed **${formatEur(-delta)}** from ${mention(targetId)} — new balance ${formatEur(balance)}.`,
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
