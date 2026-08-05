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
import { getRound, getRtpStats, recordGame } from "@/lib/discord/feed";
import { claimPromo, createPromo } from "@/lib/discord/promo";
import {
  getRainConfig,
  joinRain,
  setRainConfig,
  settleDueRains,
  startRain,
  stopRain,
} from "@/lib/discord/rain";
import { addThreadMember, createThread, sendMessage } from "@/lib/discord/rest";
import {
  COLORS,
  IS_COMPONENTS_V2,
  button,
  container,
  notice,
  row,
  separator,
  stats,
  text,
  title,
  v2Reply,
  type Component,
} from "@/lib/discord/ui";

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
          void settleDueRains().catch(() => null);
          if (interaction.type === 2) return await handleApplicationCommand(interaction);
          if (interaction.type === 3) return await handleComponent(interaction);
          if (interaction.type === 5) return await handleModalSubmit(interaction);
          return Response.json({ type: 4, data: { content: "Unknown interaction type" } });
        } catch (error) {
          console.error("Discord interaction handler failed", error);
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

function err(message: string) {
  return notice(`⚠️ ${message}`, COLORS.loss, true);
}

function ok(message: string, accent: number = COLORS.win) {
  return notice(message, accent, true);
}

/* ------------------------------ Components ------------------------------ */

async function handleComponent(interaction: any) {
  const caller = interaction.user ?? interaction.member?.user;
  if (!caller) return err("Could not identify the caller.");
  const customId: string = interaction.data?.custom_id ?? "";
  const parts = customId.split(":");
  const prefix = parts[0] ?? "";
  const id = parts[1] ?? "";
  const action = parts[2] ?? "";

  if (prefix === "verify") return await handleVerify(id);

  if (prefix === "rain" && action === "join") {
    const username: string = caller.username ?? caller.global_name ?? "Unknown";
    const result = await joinRain(id, caller.id, username);
    if (!result.ok) {
      return result.reason === "already"
        ? err("You already joined this rain.")
        : err("This rain is closed.");
    }
    return ok(`🌧️ You joined the rain! **${result.joined}** players are in so far.`, COLORS.rain);
  }

  if (prefix === "again") {
    return await handlePlayAgain(interaction, id, parts.slice(2));
  }

  if (prefix === "dep" && action === "amount") {
    if (!isCoin(id)) return err("Unsupported coin.");
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
    if (!isAdmin(caller.id)) return err("Admins only.");
    const rowData = await settleWithdrawal(id, action === "paid" ? "paid" : "reject");
    if (!rowData) return err("No pending payout with that id.");
    return ok(
      action === "paid"
        ? `✅ Marked ${formatEur(rowData.eur_cents)} to ${rowData.discord_username} as paid.`
        : `↩️ Refunded ${formatEur(rowData.eur_cents)} back to ${rowData.discord_username}.`,
    );
  }

  return await handleGameComponent(prefix, id, action, caller.id);
}

async function handleVerify(roundId: string) {
  const round = await getRound(roundId);
  if (!round) return err("That round could not be found.");
  return v2Reply(
    [
      container(COLORS.info, [
        title("✅", "Round verification", `Round \`${round.round_id}\``),
        text(
          stats([
            ["Game", round.game],
            ["Player", round.discord_username],
            ["Bet", formatEur(round.bet_cents)],
            ["Payout", formatEur(round.payout_cents)],
            ["Multiplier", `${Number(round.multiplier).toFixed(2)}x`],
            ["Result", round.result],
            ["Played", `<t:${Math.floor(new Date(round.created_at).getTime() / 1000)}:f>`],
          ]),
        ),
        separator(),
        text(
          `**Server seed**\n\`${round.server_seed}\`\n**SHA-256**\n\`${round.server_seed_hash}\`\n` +
            "-# Hash the seed together with the round id to confirm this round was not altered.",
        ),
      ]),
    ],
    true,
  );
}

async function handlePlayAgain(interaction: any, game: string, args: string[]) {
  const caller = interaction.user ?? interaction.member?.user;
  const userId: string = caller.id;
  const username: string = caller.username ?? caller.global_name ?? "Unknown";
  const bet = Number(args[0]);
  if (!Number.isFinite(bet) || bet <= 0) return err("Could not repeat that bet.");

  const player = await getOrCreatePlayer(userId, username);
  if (player.balance_cents < bet) return err(`Not enough balance. You have ${formatEur(player.balance_cents)}.`);

  const guildId: string | undefined = interaction.guild_id;
  let components: Component[];
  if (game === "mines") {
    components = await startMines(userId, username, bet, Number(args[1] ?? 3), { guildId });
  } else if (game === "towers") {
    const difficulty = (args[1] ?? "easy") as TowersDifficulty;
    components = await startTowers(userId, username, bet, difficulty in TOWERS ? difficulty : "easy", {
      guildId,
    });
  } else if (game === "blackjack") {
    components = await startBlackjack(userId, username, bet, { guildId });
  } else if (game === "coinflip") {
    components = await runCoinflip(userId, username, bet, args[1] === "tails" ? "tails" : "heads", guildId);
  } else if (game === "slots") {
    components = await runSlots(userId, username, bet, guildId);
  } else {
    return err("Unknown game.");
  }
  return v2Reply(components);
}

async function handleModalSubmit(interaction: any) {
  const caller = interaction.user ?? interaction.member?.user;
  if (!caller) return err("Could not identify the caller.");
  const customId: string = interaction.data?.custom_id ?? "";
  const [prefix, coinRaw] = customId.split(":");
  if (prefix !== "depamt" || !coinRaw || !isCoin(coinRaw)) return Response.json({ type: 6 });

  const rows: any[] = interaction.data?.components ?? [];
  const raw = rows[0]?.components?.[0]?.value ?? "";
  const cents = toCents(Number(String(raw).replace(",", ".")));
  if (cents === null || cents <= 0) return err("Enter a valid EUR amount.");

  const username: string = caller.username ?? caller.global_name ?? "Unknown";
  const result = await setDepositIntentAmount(caller.id, username, coinRaw, cents);
  if (!result) return err("Could not lock that amount. Try again.");

  return v2Reply(
    [
      container(COLORS.gold, [
        title("💸", `Deposit ${COINS[coinRaw].label}`, "Send the exact amount below"),
        text(
          stats([
            ["Amount", `\`${result.cryptoAmount.toFixed(result.decimals)} ${coinRaw}\``],
            ["Value", formatEur(cents)],
            ["Confirmations", `${result.wallet.min_confirmations}`],
          ]) + `\n\n**Address**\n\`${result.wallet.address}\``,
        ),
        separator(),
        text("-# Reserved for 2 hours. Once it lands it is credited automatically."),
      ]),
    ],
    true,
  );
}

/* -------------------------------- Helpers -------------------------------- */

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

/** Sends the game either in-channel or inside a fresh public/private thread. */
async function deliver(interaction: any, gameName: string, betLabel: string, components: Component[]) {
  const visibility = String(opt(interaction, "visibility") ?? "channel");
  if (visibility !== "public" && visibility !== "private") return v2Reply(components);

  const caller = interaction.user ?? interaction.member?.user;
  const channelId: string | undefined = interaction.channel_id;
  if (!channelId) return v2Reply(components);

  const threadId = await createThread(
    channelId,
    `${gameName} · ${caller.username ?? "player"} · ${betLabel}`,
    visibility === "private",
  );
  if (!threadId) return v2Reply(components);
  await addThreadMember(threadId, caller.id);
  await sendMessage(threadId, { flags: IS_COMPONENTS_V2, components }).catch(() => null);

  return v2Reply(
    [
      container(COLORS.neutral, [
        title("🎮", `${gameName} table ready`, visibility === "private" ? "Private thread" : "Public thread"),
        text(`Your ${betLabel} game is waiting in <#${threadId}>.`),
      ]),
    ],
    true,
  );
}

async function handleApplicationCommand(interaction: any) {
  const caller = interaction.user ?? interaction.member?.user;
  if (!caller) return err("Could not identify the caller.");

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
      case "rtp":
        return await handleRtp();
      case "tip":
        return await handleTip(interaction, userId, username);
      case "claim":
        return await handleClaim(interaction, userId, username);
      case "createpromo":
        return await handleCreatePromo(interaction, userId);
      case "startrain":
        return await handleStartRain(interaction, userId);
      case "stoprain":
        return await handleStopRain(interaction, userId);
      case "amoutrain":
        return await handleRainConfig(interaction, userId);
      case "payouts":
        return await handlePayouts(interaction, userId);
      case "setwallet":
      case "changecoin":
        return await handleSetWallet(interaction, userId);
      case "addbalance":
        return await handleAdjustBalance(interaction, userId, 1);
      case "removebalance":
        return await handleAdjustBalance(interaction, userId, -1);
      default:
        return err("Unknown command.");
    }
  } catch (error) {
    console.error("Command failed", name, error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message === "insufficient_funds") return err("You do not have enough balance for that.");
    return err(`Something went wrong: ${message}`);
  }
}

/* ------------------------------ Account ------------------------------ */

async function handleRegister(userId: string, username: string) {
  const player = await getOrCreatePlayer(userId, username);
  return v2Reply(
    [
      container(COLORS.win, [
        title("🎟️", "Account ready", `Welcome, ${username}`),
        text(stats([["Balance", formatEur(player.balance_cents)]])),
        separator(),
        text("-# Use `/deposit` to top up with crypto, or `/claim` a promo code."),
      ]),
    ],
    true,
  );
}

async function handleBalance(userId: string, username: string) {
  const player = await getOrCreatePlayer(userId, username);
  return v2Reply(
    [
      container(COLORS.gold, [
        title("💰", "Your wallet", `<@${userId}>`),
        text(stats([["Balance", formatEur(player.balance_cents)]])),
        separator(),
        row(
          button({ style: 3, label: "Deposit", custom_id: "dep:BTC:amount" }),
          button({ style: 2, label: "Leaderboard", custom_id: "nav:board:open", disabled: true }),
        ),
      ]),
    ],
    true,
  );
}

async function handleLeaderboard() {
  const players = await getLeaderboard();
  if (players.length === 0) return err("No players yet.");
  const medals = ["🥇", "🥈", "🥉"];
  const lines = players
    .map((p, i) => `> ${medals[i] ?? `\`#${i + 1}\``} **${p.discord_username}** · ${formatEur(p.balance_cents)}`)
    .join("\n");
  return v2Reply(
    [
      container(COLORS.gold, [
        title("🏆", "Leaderboard", "Richest players right now"),
        text(lines),
      ]),
    ],
    true,
  );
}

async function handleRtp() {
  const s = await getRtpStats();
  return v2Reply([
    container(COLORS.info, [
      title("📊", "Live RTP tracker", "Across every game played"),
      text(
        stats([
          ["Total bets", s.bets.toLocaleString("en-US")],
          ["Total wagered", formatEur(s.wageredCents)],
          ["Total payouts", formatEur(s.payoutCents)],
          ["Current RTP", `${s.rtp.toFixed(2)}%`],
          ["Target RTP", "98.00%"],
        ]),
      ),
    ]),
  ]);
}

async function handleTip(interaction: any, userId: string, username: string) {
  const targetId = String(opt(interaction, "user") ?? "");
  if (!targetId) return err("Pick someone to tip.");
  if (targetId === userId) return err("You cannot tip yourself.");
  const cents = toCents(Number(opt(interaction, "amount")));
  if (cents === null || cents <= 0) return err("Invalid amount.");

  const sender = await getOrCreatePlayer(userId, username);
  if (sender.balance_cents < cents) return err(`Not enough balance. You have ${formatEur(sender.balance_cents)}.`);

  const resolved = interaction.data?.resolved?.users?.[targetId];
  const targetName: string = resolved?.global_name ?? resolved?.username ?? "Unknown";
  await getOrCreatePlayer(targetId, targetName);

  const balance = await adjustBalance(userId, -cents);
  await adjustBalance(targetId, cents);

  return v2Reply([
    container(COLORS.win, [
      title("🤝", "Tip sent"),
      text(
        stats([
          ["From", `<@${userId}>`],
          ["To", `<@${targetId}>`],
          ["Amount", formatEur(cents)],
          ["Your balance", formatEur(balance)],
        ]),
      ),
    ]),
  ]);
}

/* ------------------------------- Promos ------------------------------- */

async function handleCreatePromo(interaction: any, userId: string) {
  if (!isAdmin(userId)) return err("Owners only.");
  const cents = toCents(Number(opt(interaction, "amount")));
  const uses = Number(opt(interaction, "uses") ?? 1);
  if (cents === null || cents <= 0) return err("Invalid amount.");
  if (!Number.isInteger(uses) || uses < 1) return err("Invalid number of uses.");

  const promo = await createPromo(cents, uses, userId);
  return v2Reply(
    [
      container(COLORS.gold, [
        title("🎁", "Promo code created"),
        text(
          stats([
            ["Code", `\`${promo.code}\``],
            ["Reward", formatEur(cents)],
            ["Uses", `${uses}`],
          ]) + "\n\n-# Players redeem it with `/claim`.",
        ),
      ]),
    ],
    true,
  );
}

async function handleClaim(interaction: any, userId: string, username: string) {
  const code = String(opt(interaction, "code") ?? "");
  if (!code) return err("Enter a promo code.");
  const result = await claimPromo(code, userId, username);
  if (!result.ok) {
    const messages = {
      unknown: "That promo code does not exist.",
      used_up: "That promo code has been fully claimed.",
      already: "You already claimed that promo code.",
      inactive: "That promo code is no longer active.",
    } as const;
    return err(messages[result.reason]);
  }
  return v2Reply([
    container(COLORS.win, [
      title("🎉", "Reward claimed!", `<@${userId}>`),
      text(
        stats([
          ["Code", `\`${result.code}\``],
          ["Reward", formatEur(result.amountCents)],
          ["New balance", formatEur(result.balanceCents)],
        ]),
      ),
    ]),
  ]);
}

/* --------------------------------- Rain --------------------------------- */

async function handleStartRain(interaction: any, userId: string) {
  if (!isAdmin(userId)) return err("Owners only.");
  const guildId: string | undefined = interaction.guild_id;
  if (!guildId) return err("Rain only works inside a server.");
  const result = await startRain(guildId, interaction.channel_id, userId);
  if ("error" in result) {
    return err(result.error === "running" ? "A rain is already running." : "Could not start the rain.");
  }
  return ok(`🌧️ Rain started in <#${result.channelId}>.`, COLORS.rain);
}

async function handleStopRain(interaction: any, userId: string) {
  if (!isAdmin(userId)) return err("Owners only.");
  const guildId: string | undefined = interaction.guild_id;
  if (!guildId) return err("Rain only works inside a server.");
  const result = await stopRain(guildId);
  if (!result) return err("No rain is currently running.");
  return ok(`🌧️ Rain ended — ${result.winners.length} winner(s) paid ${formatEur(result.share)} each.`, COLORS.rain);
}

async function handleRainConfig(interaction: any, userId: string) {
  if (!isAdmin(userId)) return err("Owners only.");
  const guildId: string | undefined = interaction.guild_id;
  if (!guildId) return err("Rain only works inside a server.");

  const cents = toCents(Number(opt(interaction, "amount")));
  const winners = Number(opt(interaction, "winners") ?? 1);
  const duration = Number(opt(interaction, "duration") ?? 60);
  if (cents === null || cents <= 0) return err("Invalid prize amount.");

  await setRainConfig(guildId, { prizeCents: cents, winners, durationSeconds: duration });
  const config = await getRainConfig(guildId);
  return v2Reply(
    [
      container(COLORS.rain, [
        title("🌧️", "Rain settings saved"),
        text(
          stats([
            ["💰 Prize pool", formatEur(config.prizeCents)],
            ["👥 Winners", `${config.winners}`],
            ["⏳ Duration", `${config.durationSeconds}s`],
            ["Each wins", formatEur(Math.floor(config.prizeCents / Math.max(1, config.winners)))],
          ]) + "\n\n-# Run `/startrain` to launch it.",
        ),
      ]),
    ],
    true,
  );
}

/* -------------------------------- Games -------------------------------- */

async function requireBet(interaction: any, userId: string, username: string) {
  const bet = betCents(interaction);
  if (bet === null) return { error: err("Enter a bet of at least €0.10.") };
  const player = await getOrCreatePlayer(userId, username);
  if (player.balance_cents < bet) {
    return { error: err(`Not enough balance. You have ${formatEur(player.balance_cents)}.`) };
  }
  return { bet };
}

function resultCard(
  emoji: string,
  game: string,
  userId: string,
  won: boolean,
  lines: Array<[string, string]>,
  extra: string,
  again: string,
): Component[] {
  return [
    container(won ? COLORS.win : COLORS.loss, [
      title(emoji, `${game} · ${won ? "WIN" : "LOSS"}`, `<@${userId}>`),
      text(extra),
      separator(),
      text(stats(lines)),
      separator(),
      row(button({ style: 1, label: "🔁 Play again", custom_id: again })),
    ]),
  ];
}

async function runCoinflip(
  userId: string,
  username: string,
  bet: number,
  side: "heads" | "tails",
  guildId?: string,
): Promise<Component[]> {
  const flip = Math.random() < 0.5 ? "heads" : "tails";
  const won = flip === side;
  const payout = won ? bet * 2 : 0;
  const balance = await adjustBalance(userId, won ? bet : -bet);
  const roundId = await recordGame({
    userId,
    username,
    game: "coinflip",
    betCents: bet,
    payoutCents: payout,
    detail: `called ${side}, landed ${flip}`,
    guildId,
  });

  return resultCard(
    "🪙",
    "Coinflip",
    userId,
    won,
    [
      ["Bet", formatEur(bet)],
      ["Multiplier", won ? "2.00x" : "0.00x"],
      [won ? "Winnings" : "Lost", formatEur(won ? bet : bet)],
      ["Balance", formatEur(balance)],
      ["Round", `\`${roundId}\``],
    ],
    `Called **${side}** · landed **${flip}** ${flip === "heads" ? "🪙" : "🌑"}`,
    `again:coinflip:${bet}:${side}`,
  );
}

async function handleCoinflip(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;
  const side = String(opt(interaction, "side")) === "tails" ? "tails" : "heads";
  const components = await runCoinflip(userId, username, bet, side, interaction.guild_id);
  return await deliver(interaction, "Coinflip", formatEur(bet), components);
}

async function runSlots(
  userId: string,
  username: string,
  bet: number,
  guildId?: string,
): Promise<Component[]> {
  const result = spinSlots();
  const payout = calculateSlotsPayout(bet, result);
  const balance = await adjustBalance(userId, payout - bet);
  const roundId = await recordGame({
    userId,
    username,
    game: "slots",
    betCents: bet,
    payoutCents: payout,
    detail: result.join(" "),
    guildId,
  });

  return resultCard(
    "🎰",
    "Slots",
    userId,
    payout > bet,
    [
      ["Bet", formatEur(bet)],
      ["Multiplier", `${(payout / bet).toFixed(2)}x`],
      [payout > 0 ? "Payout" : "Lost", formatEur(payout > 0 ? payout : bet)],
      ["Balance", formatEur(balance)],
      ["Round", `\`${roundId}\``],
    ],
    `## ${result.join(" │ ")}`,
    `again:slots:${bet}`,
  );
}

async function handleSlots(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;
  const components = await runSlots(userId, username, bet, interaction.guild_id);
  return await deliver(interaction, "Slots", formatEur(bet), components);
}

async function handleBlackjack(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;
  const components = await startBlackjack(userId, username, bet, { guildId: interaction.guild_id });
  return await deliver(interaction, "Blackjack", formatEur(bet), components);
}

async function handleMines(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;
  const mines = Number(opt(interaction, "mines"));
  if (!Number.isInteger(mines) || mines < 1 || mines > 19) return err("Pick between 1 and 19 mines.");
  const components = await startMines(userId, username, bet, mines, { guildId: interaction.guild_id });
  return await deliver(interaction, "Mines", formatEur(bet), components);
}

async function handleTowers(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;
  const difficulty = String(opt(interaction, "difficulty")) as TowersDifficulty;
  if (!(difficulty in TOWERS)) return err("Unknown difficulty.");
  const components = await startTowers(userId, username, bet, difficulty, {
    guildId: interaction.guild_id,
  });
  return await deliver(interaction, "Towers", formatEur(bet), components);
}

async function handleUpgrader(interaction: any, userId: string, username: string) {
  const check = await requireBet(interaction, userId, username);
  if (check.error) return check.error;
  const bet = check.bet!;

  const multiplier = Number(opt(interaction, "multiplier"));
  const game = playUpgrader(multiplier);
  const payout = game.won ? Math.floor(bet * multiplier) : 0;
  const balance = await adjustBalance(userId, payout - bet);
  const roundId = await recordGame({
    userId,
    username,
    game: "upgrader",
    betCents: bet,
    payoutCents: payout,
    detail: `${multiplier}x target · rolled ${game.roll}`,
    guildId: interaction.guild_id,
  });

  const wheel = ["🔄", "⚡", "🌀", "✨", "🎯", "💫"];
  const frames = wheel.map((icon) => [
    container(COLORS.neutral, [
      title("⚡", `Upgrader · ${multiplier}x`, `<@${userId}>`),
      text(`## ${icon} spinning…`),
      text(
        stats([
          ["Bet", formatEur(bet)],
          ["Target", `${multiplier}x`],
          ["Chance", `${(game.chance * 100).toFixed(1)}%`],
        ]),
      ),
    ]),
  ]);

  const final = resultCard(
    "⚡",
    `Upgrader ${multiplier}x`,
    userId,
    game.won,
    [
      ["Bet", formatEur(bet)],
      ["Chance", `${(game.chance * 100).toFixed(1)}%`],
      ["Roll", `${game.roll}`],
      [game.won ? "Winnings" : "Lost", formatEur(game.won ? payout - bet : bet)],
      ["Balance", formatEur(balance)],
      ["Round", `\`${roundId}\``],
    ],
    game.won ? "## ✅ Upgraded!" : "## ❌ Failed",
    `again:upgrader:${bet}:${multiplier}`,
  );

  const visibility = String(opt(interaction, "visibility") ?? "channel");
  if (visibility === "channel") {
    const animated = await animateUpgrader(
      interaction.id,
      interaction.token,
      frames,
      final,
      interaction.application_id,
    );
    if (animated) return new Response(null, { status: 202 });
  }
  return await deliver(interaction, "Upgrader", formatEur(bet), final);
}

/* ------------------------------- Banking ------------------------------- */

async function handleDeposit(interaction: any, userId: string, username: string) {
  const coinRaw = String(opt(interaction, "coin"));
  if (!isCoin(coinRaw)) return err("Unsupported coin.");
  const coin: Coin = coinRaw;

  const wallet = await createDepositIntent(userId, username, coin);
  if (!wallet) {
    return err(`${COINS[coin].label} deposits are not configured yet. Ask an admin to run \`/setwallet\`.`);
  }

  return v2Reply(
    [
      container(COLORS.gold, [
        title("💸", `Deposit ${COINS[coin].label}`, "Private — only you can see this"),
        text(
          `**Address**\n\`${wallet.address}\`\n\n` +
            stats([["Confirmations", `${wallet.min_confirmations}`], ["Network", COINS[coin].label]]),
        ),
        separator(),
        text("-# Tap **Amount** to lock the exact amount you will send so it credits automatically."),
        row(button({ style: 1, label: "💶 Amount", custom_id: `dep:${coin}:amount` })),
      ]),
    ],
    true,
  );
}

async function handleWithdraw(interaction: any, userId: string, username: string) {
  const coinRaw = String(opt(interaction, "coin"));
  if (!isCoin(coinRaw)) return err("Unsupported coin.");
  const coin: Coin = coinRaw;

  const address = String(opt(interaction, "address") ?? "").trim();
  if (!validateAddress(coin, address)) {
    return err(`That does not look like a valid ${COINS[coin].label} address.`);
  }

  const cents = toCents(Number(opt(interaction, "amount")));
  if (cents === null) return err("Invalid amount.");

  const result = await requestWithdrawal(userId, username, coin, address, cents);
  if ("error" in result) {
    switch (result.error) {
      case "min":
        return err(`Minimum withdrawal is ${formatEur(MIN_WITHDRAW_CENTS)}.`);
      case "too_many":
        return err("You already have 3 pending payout requests.");
      case "insufficient":
        return err("Not enough balance for that withdrawal.");
      default:
        return err("Could not create the payout request. Try again.");
    }
  }

  const crypto =
    result.cryptoAmount !== null
      ? `${result.cryptoAmount.toFixed(Math.min(8, result.decimals))} ${coin}`
      : "—";

  return v2Reply(
    [
      container(COLORS.neutral, [
        title("🏧", "Payout requested", "Private — only you can see this"),
        text(
          stats([
            ["Amount", formatEur(cents)],
            ["In crypto", crypto],
            ["Fee", formatEur(result.feeCents)],
            ["Address", `\`${address}\``],
            ["Request id", `\`${result.withdrawal.id}\``],
          ]) + "\n\n-# Already reserved from your balance. An owner releases or refunds it.",
        ),
      ]),
    ],
    true,
  );
}

/* -------------------------------- Admin -------------------------------- */

async function handlePayouts(interaction: any, userId: string) {
  if (!isAdmin(userId)) return err("Admins only.");
  const action = String(opt(interaction, "action") ?? "list");

  if (action === "list") {
    const rows = await listPendingWithdrawals();
    if (rows.length === 0) return err("No pending payouts.");
    const shown = rows.slice(0, 4);
    const body: Component[] = [title("🏦", "Pending payouts", `${rows.length} waiting`)];
    for (const r of shown) {
      body.push(
        separator(),
        text(
          stats([
            ["Player", r.discord_username],
            ["Amount", `${formatEur(r.eur_cents)} ${r.coin}`],
            ["Address", `\`${r.address}\``],
            ["Id", `\`${r.id}\``],
          ]),
        ),
        row(
          button({ style: 3, label: "✅ Paid", custom_id: `w:${r.id}:paid` }),
          button({ style: 4, label: "↩️ Refund", custom_id: `w:${r.id}:refund` }),
        ),
      );
    }
    return v2Reply([container(COLORS.info, body)], true);
  }

  const id = String(opt(interaction, "id") ?? "");
  if (!id) return err("Provide the withdrawal id.");
  const tx = opt(interaction, "tx");
  const rowData = await settleWithdrawal(id, action === "paid" ? "paid" : "reject", tx as string);
  if (!rowData) return err("No pending payout with that id.");

  return ok(
    action === "paid"
      ? `✅ Marked ${formatEur(rowData.eur_cents)} to ${rowData.discord_username} as paid.`
      : `↩️ Refunded ${formatEur(rowData.eur_cents)} to ${rowData.discord_username}.`,
  );
}

async function handleAdjustBalance(interaction: any, userId: string, sign: 1 | -1) {
  if (!isAdmin(userId)) return err("Owners only.");

  const targetId = String(opt(interaction, "user") ?? "");
  if (!targetId) return err("Pick a player.");

  const cents = toCents(Number(opt(interaction, "amount")));
  if (cents === null || cents <= 0) return err("Invalid amount.");

  const resolvedUser = interaction.data?.resolved?.users?.[targetId];
  const targetName: string = resolvedUser?.global_name ?? resolvedUser?.username ?? "Unknown";
  const player = await getOrCreatePlayer(targetId, targetName);

  const delta = sign === 1 ? cents : -Math.min(cents, player.balance_cents);
  const balance = await adjustBalance(targetId, delta);

  return v2Reply(
    [
      container(sign === 1 ? COLORS.win : COLORS.loss, [
        title(sign === 1 ? "➕" : "➖", "Balance adjusted"),
        text(
          stats([
            ["Player", `<@${targetId}>`],
            ["Change", `${sign === 1 ? "+" : "-"}${formatEur(Math.abs(delta))}`],
            ["New balance", formatEur(balance)],
          ]),
        ),
      ]),
    ],
    true,
  );
}

async function handleSetWallet(interaction: any, userId: string) {
  if (!isAdmin(userId)) return err("Admins only.");
  const coinRaw = String(opt(interaction, "coin"));
  if (!isCoin(coinRaw)) return err("Unsupported coin.");
  const address = String(opt(interaction, "address") ?? "").trim();
  if (!validateAddress(coinRaw, address)) {
    return err(`That does not look like a valid ${coinRaw} address.`);
  }
  const confirmations = Number(opt(interaction, "confirmations") ?? (coinRaw === "BTC" ? 2 : 12));
  await setDepositAddress(coinRaw, address, confirmations);
  const existing = await getDepositAddress(coinRaw);
  return v2Reply(
    [
      container(COLORS.win, [
        title("🔐", `${coinRaw} wallet updated`),
        text(
          stats([
            ["Address", `\`${existing?.address}\``],
            ["Confirmations", `${existing?.min_confirmations}`],
          ]),
        ),
      ]),
    ],
    true,
  );
}
