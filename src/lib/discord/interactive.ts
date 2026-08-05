import { adjustBalance } from "./games";
import { formatEur } from "./money";
import { createSession, getSession, saveSession, type GameSession } from "./sessions";
import { recordGame } from "./feed";
import {
  COLORS,
  button,
  container,
  row,
  separator,
  stats,
  text,
  title,
  v2Reply,
  v2Update,
  type Component,
} from "./ui";

const HOUSE_EDGE = 0.02;

export type GameMeta = { guildId?: string };

function meta(state: any): GameMeta {
  return (state?._meta as GameMeta) ?? {};
}

export function reply(components: Component[], ephemeral = false) {
  return v2Reply(components, ephemeral);
}

export function updateMessage(components: Component[]) {
  return v2Update(components);
}

/* --------------------------------- Mines --------------------------------- */

const MINES_TILES = 20; // 5 columns x 4 rows of buttons

type MinesState = {
  mines: number;
  bombs: number[];
  revealed: number[];
  lost: boolean;
  _meta?: GameMeta;
};

export function minesMultiplier(mines: number, safeCleared: number) {
  let m = 1;
  for (let i = 0; i < safeCleared; i++) {
    m *= (MINES_TILES - i) / (MINES_TILES - mines - i);
  }
  return Number((m * (1 - HOUSE_EDGE)).toFixed(2));
}

export function newMinesState(mines: number): MinesState {
  const bombs = new Set<number>();
  while (bombs.size < mines) bombs.add(Math.floor(Math.random() * MINES_TILES));
  return { mines, bombs: [...bombs], revealed: [], lost: false };
}

function minesGrid(session: GameSession, state: MinesState, finished: boolean): Component[] {
  const rows: Component[] = [];
  for (let r = 0; r < 4; r++) {
    const buttons: Component[] = [];
    for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      const isRevealed = state.revealed.includes(i);
      const isBomb = state.bombs.includes(i);
      let label = "❔";
      let style: 1 | 2 | 3 | 4 = 2;
      if (isRevealed) {
        label = isBomb ? "💣" : "💎";
        style = isBomb ? 4 : 3;
      } else if (finished && isBomb) {
        label = "🔻";
        style = 4;
      }
      buttons.push(
        button({ style, label, custom_id: `m:${session.id}:${i}`, disabled: finished || isRevealed }),
      );
    }
    rows.push(row(...buttons));
  }
  return rows;
}

function minesCard(
  session: GameSession,
  state: MinesState,
  status: "active" | "won" | "lost",
  summary?: string,
): Component[] {
  const safe = state.revealed.filter((i) => !state.bombs.includes(i)).length;
  const mult = minesMultiplier(state.mines, safe);
  const finished = status !== "active";
  const accent = status === "won" ? COLORS.win : status === "lost" ? COLORS.loss : COLORS.neutral;

  const body: Component[] = [
    title("💣", `Mines · ${state.mines} bombs`, `<@${session.discord_user_id}>`),
    text(
      stats([
        ["Bet", formatEur(session.bet_cents)],
        ["Safe tiles", `${safe}`],
        ["Multiplier", `${mult.toFixed(2)}x`],
        ["Cash out value", formatEur(Math.floor(session.bet_cents * mult))],
      ]) + (summary ? `\n\n${summary}` : ""),
    ),
    separator(),
    ...minesGrid(session, state, finished),
  ];

  if (!finished) {
    body.push(
      row(
        button({
          style: 1,
          label: safe === 0 ? "Cash out" : `💰 Cash out ${mult.toFixed(2)}x`,
          custom_id: `m:${session.id}:cash`,
          disabled: safe === 0,
        }),
      ),
    );
  } else {
    body.push(
      row(
        button({
          style: 1,
          label: "🔁 Play again",
          custom_id: `again:mines:${session.bet_cents}:${state.mines}`,
        }),
      ),
    );
  }
  return [container(accent, body)];
}

export async function startMines(
  userId: string,
  username: string,
  betCents: number,
  mines: number,
  gameMeta: GameMeta = {},
): Promise<Component[]> {
  await adjustBalance(userId, -betCents);
  const state = newMinesState(mines);
  state._meta = gameMeta;
  const session = await createSession(userId, username, "mines", betCents, state);
  return minesCard(session, state, "active");
}

async function handleMinesClick(session: GameSession, action: string) {
  const state = session.state as MinesState;

  if (action === "cash") {
    const safe = state.revealed.length;
    const mult = minesMultiplier(state.mines, safe);
    const payout = Math.floor(session.bet_cents * mult);
    const balance = await adjustBalance(session.discord_user_id, payout);
    await saveSession(session.id, state, "done");
    const roundId = await recordGame({
      userId: session.discord_user_id,
      username: session.discord_username,
      game: "mines",
      betCents: session.bet_cents,
      payoutCents: payout,
      detail: `${safe} safe tiles · ${state.mines} mines`,
      guildId: meta(state).guildId,
    });
    return updateMessage(
      minesCard(
        session,
        state,
        "won",
        `✅ **Cashed out at ${mult.toFixed(2)}x** — won ${formatEur(payout)} (profit ${formatEur(
          payout - session.bet_cents,
        )})\nBalance ${formatEur(balance)} · Round \`${roundId}\``,
      ),
    );
  }

  const tile = Number(action);
  if (!Number.isInteger(tile) || tile < 0 || tile >= MINES_TILES) return Response.json({ type: 6 });
  if (state.revealed.includes(tile)) return Response.json({ type: 6 });

  state.revealed.push(tile);

  if (state.bombs.includes(tile)) {
    state.lost = true;
    await saveSession(session.id, state, "done");
    const roundId = await recordGame({
      userId: session.discord_user_id,
      username: session.discord_username,
      game: "mines",
      betCents: session.bet_cents,
      payoutCents: 0,
      detail: `hit a mine after ${state.revealed.length - 1} safe tiles`,
      guildId: meta(state).guildId,
    });
    return updateMessage(
      minesCard(
        session,
        state,
        "lost",
        `💥 **Boom!** Lost ${formatEur(session.bet_cents)} · Round \`${roundId}\``,
      ),
    );
  }

  const safe = state.revealed.length;
  if (safe >= MINES_TILES - state.mines) {
    const mult = minesMultiplier(state.mines, safe);
    const payout = Math.floor(session.bet_cents * mult);
    const balance = await adjustBalance(session.discord_user_id, payout);
    await saveSession(session.id, state, "done");
    const roundId = await recordGame({
      userId: session.discord_user_id,
      username: session.discord_username,
      game: "mines",
      betCents: session.bet_cents,
      payoutCents: payout,
      detail: "cleared the whole board",
      guildId: meta(state).guildId,
    });
    return updateMessage(
      minesCard(
        session,
        state,
        "won",
        `🏆 **Board cleared at ${mult.toFixed(2)}x** — won ${formatEur(payout)}\nBalance ${formatEur(
          balance,
        )} · Round \`${roundId}\``,
      ),
    );
  }

  await saveSession(session.id, state, "active");
  return updateMessage(minesCard(session, state, "active"));
}

/* --------------------------------- Towers --------------------------------- */

export const TOWERS = {
  easy: { tiles: 4, safe: 3 },
  medium: { tiles: 3, safe: 2 },
  hard: { tiles: 3, safe: 1 },
} as const;

export type TowersDifficulty = keyof typeof TOWERS;

const MAX_FLOORS = 8;

type TowersState = {
  difficulty: TowersDifficulty;
  cleared: number;
  lost: boolean;
  history: string[];
  _meta?: GameMeta;
};

export function towersMultiplier(difficulty: TowersDifficulty, cleared: number) {
  const { tiles, safe } = TOWERS[difficulty];
  return Number((Math.pow(tiles / safe, cleared) * (1 - HOUSE_EDGE)).toFixed(2));
}

function towersCard(
  session: GameSession,
  state: TowersState,
  status: "active" | "won" | "lost",
  summary?: string,
): Component[] {
  const { tiles } = TOWERS[state.difficulty];
  const mult = towersMultiplier(state.difficulty, state.cleared);
  const finished = status !== "active";
  const accent = status === "won" ? COLORS.win : status === "lost" ? COLORS.loss : COLORS.neutral;

  const body: Component[] = [
    title("🗼", `Towers · ${state.difficulty}`, `<@${session.discord_user_id}>`),
    text(
      stats([
        ["Bet", formatEur(session.bet_cents)],
        ["Floor", `${Math.min(state.cleared + 1, MAX_FLOORS)} / ${MAX_FLOORS}`],
        ["Multiplier", `${mult.toFixed(2)}x`],
        ["Cash out value", formatEur(Math.floor(session.bet_cents * mult))],
      ]) +
        (state.history.length ? `\n\n${state.history.join("\n")}` : "") +
        (summary ? `\n\n${summary}` : ""),
    ),
  ];

  if (!finished) {
    body.push(
      separator(),
      row(
        ...Array.from({ length: tiles }, (_, i) =>
          button({ style: 2, label: `Tile ${i + 1}`, custom_id: `t:${session.id}:${i}` }),
        ),
      ),
      row(
        button({
          style: 1,
          label: state.cleared === 0 ? "Cash out" : `💰 Cash out ${mult.toFixed(2)}x`,
          custom_id: `t:${session.id}:cash`,
          disabled: state.cleared === 0,
        }),
      ),
    );
  } else {
    body.push(
      separator(),
      row(
        button({
          style: 1,
          label: "🔁 Play again",
          custom_id: `again:towers:${session.bet_cents}:${state.difficulty}`,
        }),
      ),
    );
  }
  return [container(accent, body)];
}

export async function startTowers(
  userId: string,
  username: string,
  betCents: number,
  difficulty: TowersDifficulty,
  gameMeta: GameMeta = {},
): Promise<Component[]> {
  await adjustBalance(userId, -betCents);
  const state: TowersState = { difficulty, cleared: 0, lost: false, history: [], _meta: gameMeta };
  const session = await createSession(userId, username, "towers", betCents, state);
  return towersCard(session, state, "active");
}

async function handleTowersClick(session: GameSession, action: string) {
  const state = session.state as TowersState;
  const { tiles, safe } = TOWERS[state.difficulty];

  if (action === "cash") {
    const mult = towersMultiplier(state.difficulty, state.cleared);
    const payout = Math.floor(session.bet_cents * mult);
    const balance = await adjustBalance(session.discord_user_id, payout);
    await saveSession(session.id, state, "done");
    const roundId = await recordGame({
      userId: session.discord_user_id,
      username: session.discord_username,
      game: "towers",
      betCents: session.bet_cents,
      payoutCents: payout,
      detail: `${state.cleared} floors · ${state.difficulty}`,
      guildId: meta(state).guildId,
    });
    return updateMessage(
      towersCard(
        session,
        state,
        "won",
        `✅ **Cashed out at ${mult.toFixed(2)}x** — won ${formatEur(payout)} (profit ${formatEur(
          payout - session.bet_cents,
        )})\nBalance ${formatEur(balance)} · Round \`${roundId}\``,
      ),
    );
  }

  const pick = Number(action);
  if (!Number.isInteger(pick) || pick < 0 || pick >= tiles) return Response.json({ type: 6 });

  const bad = new Set<number>();
  while (bad.size < tiles - safe) bad.add(Math.floor(Math.random() * tiles));
  const survived = !bad.has(pick);
  const line = Array.from({ length: tiles }, (_, i) =>
    i === pick ? (survived ? "🟩" : "🟥") : bad.has(i) ? "💀" : "⬜",
  ).join("");
  state.history.unshift(`\`Floor ${state.cleared + 1}\` ${line}`);

  if (!survived) {
    state.lost = true;
    await saveSession(session.id, state, "done");
    const roundId = await recordGame({
      userId: session.discord_user_id,
      username: session.discord_username,
      game: "towers",
      betCents: session.bet_cents,
      payoutCents: 0,
      detail: `fell on floor ${state.cleared + 1}`,
      guildId: meta(state).guildId,
    });
    return updateMessage(
      towersCard(
        session,
        state,
        "lost",
        `💀 **Fell on floor ${state.cleared + 1}** — lost ${formatEur(
          session.bet_cents,
        )} · Round \`${roundId}\``,
      ),
    );
  }

  state.cleared++;

  if (state.cleared >= MAX_FLOORS) {
    const mult = towersMultiplier(state.difficulty, state.cleared);
    const payout = Math.floor(session.bet_cents * mult);
    const balance = await adjustBalance(session.discord_user_id, payout);
    await saveSession(session.id, state, "done");
    const roundId = await recordGame({
      userId: session.discord_user_id,
      username: session.discord_username,
      game: "towers",
      betCents: session.bet_cents,
      payoutCents: payout,
      detail: "reached the top",
      guildId: meta(state).guildId,
    });
    return updateMessage(
      towersCard(
        session,
        state,
        "won",
        `🏆 **Reached the top at ${mult.toFixed(2)}x** — won ${formatEur(payout)}\nBalance ${formatEur(
          balance,
        )} · Round \`${roundId}\``,
      ),
    );
  }

  await saveSession(session.id, state, "active");
  return updateMessage(towersCard(session, state, "active"));
}

/* -------------------------------- Blackjack ------------------------------- */

type Hand = { cards: string[]; bet: number; done: boolean; doubled: boolean };

type BlackjackState = {
  deck: string[];
  hands: Hand[];
  active: number;
  dealer: string[];
  split: boolean;
  finished?: boolean;
  _meta?: GameMeta;
};

function createDeck(): string[] {
  const suits = ["♠️", "♥️", "♣️", "♦️"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck = suits.flatMap((s) => ranks.map((r) => `${r}${s}`));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = a;
  }
  return deck;
}

function rankOf(card: string) {
  return card.slice(0, -2);
}

export function handTotal(hand: string[]): number {
  let value = 0;
  let aces = 0;
  for (const card of hand) {
    const rank = rankOf(card);
    if (rank === "A") {
      value += 11;
      aces++;
    } else if (["J", "Q", "K"].includes(rank)) value += 10;
    else value += Number.parseInt(rank, 10);
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

function isNatural(hand: Hand, split: boolean) {
  return !split && hand.cards.length === 2 && handTotal(hand.cards) === 21;
}

function blackjackCard(
  session: GameSession,
  state: BlackjackState,
  hideDealer: boolean,
  status: "active" | "win" | "loss" | "push",
  summary?: string,
  buttons: Component[] = [],
): Component[] {
  const accent =
    status === "win" ? COLORS.win : status === "loss" ? COLORS.loss : status === "push" ? COLORS.neutral : COLORS.dark;
  const dealerLine = hideDealer
    ? `${state.dealer[0]} 🂠 · **${handTotal([state.dealer[0]!])}+**`
    : `${state.dealer.join(" ")} · **${handTotal(state.dealer)}**`;

  const handLines = state.hands
    .map((h, i) => {
      const marker = state.hands.length > 1 ? (i === state.active && status === "active" ? "▶ " : "  ") : "";
      const label = state.hands.length > 1 ? `Hand ${i + 1}` : "Your hand";
      return `> **${marker}${label}** · ${h.cards.join(" ")} · **${handTotal(h.cards)}** ${
        h.doubled ? "(doubled)" : ""
      }\n> _Bet ${formatEur(h.bet)}_`;
    })
    .join("\n");

  const body: Component[] = [
    title("🃏", "Blackjack", `<@${session.discord_user_id}>`),
    text(`> **Dealer** · ${dealerLine}`),
    separator(),
    text(handLines),
  ];
  if (summary) body.push(separator(), text(summary));
  if (buttons.length) body.push(separator(), row(...buttons));
  else if (status !== "active") {
    body.push(
      separator(),
      row(button({ style: 1, label: "🔁 Play again", custom_id: `again:blackjack:${session.bet_cents}` })),
    );
  }
  return [container(accent, body)];
}

async function blackjackButtons(session: GameSession, state: BlackjackState): Promise<Component[]> {
  const hand = state.hands[state.active]!;
  const buttons: Component[] = [
    button({ style: 3, label: "Hit", custom_id: `b:${session.id}:hit` }),
    button({ style: 4, label: "Stand", custom_id: `b:${session.id}:stand` }),
  ];
  if (hand.cards.length === 2) {
    buttons.push(button({ style: 1, label: "⏫ Double", custom_id: `b:${session.id}:double` }));
    if (
      !state.split &&
      state.hands.length === 1 &&
      rankOf(hand.cards[0]!) === rankOf(hand.cards[1]!)
    ) {
      buttons.push(button({ style: 1, label: "✂️ Split", custom_id: `b:${session.id}:split` }));
    }
  }
  return buttons;
}

export async function startBlackjack(
  userId: string,
  username: string,
  betCents: number,
  gameMeta: GameMeta = {},
): Promise<Component[]> {
  await adjustBalance(userId, -betCents);
  const deck = createDeck();
  const state: BlackjackState = {
    deck,
    hands: [{ cards: [deck.pop()!, deck.pop()!], bet: betCents, done: false, doubled: false }],
    active: 0,
    dealer: [deck.pop()!, deck.pop()!],
    split: false,
    _meta: gameMeta,
  };
  const session = await createSession(userId, username, "blackjack", betCents, state);

  if (handTotal(state.hands[0]!.cards) === 21) {
    state.hands[0]!.done = true;
    return await settleBlackjack(session, state);
  }
  await saveSession(session.id, state, "active");
  return blackjackCard(session, state, true, "active", undefined, await blackjackButtons(session, state));
}

async function settleBlackjack(session: GameSession, state: BlackjackState): Promise<Component[]> {
  const anyAlive = state.hands.some((h) => handTotal(h.cards) <= 21);
  if (anyAlive) {
    while (handTotal(state.dealer) < 17) state.dealer.push(state.deck.pop()!);
  }
  const dealerValue = handTotal(state.dealer);

  let totalPayout = 0;
  let totalBet = 0;
  const lines: string[] = [];

  state.hands.forEach((hand, i) => {
    const value = handTotal(hand.cards);
    totalBet += hand.bet;
    let payout = 0;
    let label: string;
    if (value > 21) {
      label = `Bust — lost ${formatEur(hand.bet)}`;
    } else if (isNatural(hand, state.split) && dealerValue !== 21) {
      payout = hand.bet + Math.floor(hand.bet * 1.5);
      label = `Blackjack! +${formatEur(payout - hand.bet)}`;
    } else if (dealerValue > 21 || value > dealerValue) {
      payout = hand.bet * 2;
      label = `Win +${formatEur(hand.bet)}`;
    } else if (value === dealerValue) {
      payout = hand.bet;
      label = "Push — bet returned";
    } else {
      label = `Dealer wins — lost ${formatEur(hand.bet)}`;
    }
    totalPayout += payout;
    lines.push(state.hands.length > 1 ? `**Hand ${i + 1}** (${value}) · ${label}` : `**${value}** · ${label}`);
  });

  const balance = await adjustBalance(session.discord_user_id, totalPayout);
  state.finished = true;
  await saveSession(session.id, state, "done");

  const roundId = await recordGame({
    userId: session.discord_user_id,
    username: session.discord_username,
    game: "blackjack",
    betCents: totalBet,
    payoutCents: totalPayout,
    detail: `dealer ${dealerValue} · ${state.hands.length} hand(s)`,
    guildId: meta(state).guildId,
  });

  const status = totalPayout > totalBet ? "win" : totalPayout === totalBet ? "push" : "loss";
  const summary =
    `${lines.join("\n")}\n\n` +
    stats([
      ["Total bet", formatEur(totalBet)],
      ["Total payout", formatEur(totalPayout)],
      ["Net", `${totalPayout - totalBet >= 0 ? "+" : ""}${formatEur(totalPayout - totalBet)}`],
      ["Balance", formatEur(balance)],
      ["Round", `\`${roundId}\``],
    ]);

  return blackjackCard(session, state, false, status, summary);
}

async function advanceOrSettle(session: GameSession, state: BlackjackState) {
  const next = state.hands.findIndex((h) => !h.done);
  if (next === -1) return updateMessage(await settleBlackjack(session, state));
  state.active = next;
  await saveSession(session.id, state, "active");
  return updateMessage(
    blackjackCard(session, state, true, "active", undefined, await blackjackButtons(session, state)),
  );
}

async function handleBlackjackClick(session: GameSession, action: string) {
  const state = session.state as BlackjackState;
  const hand = state.hands[state.active];
  if (!hand) return Response.json({ type: 6 });

  if (action === "hit") {
    hand.cards.push(state.deck.pop()!);
    if (handTotal(hand.cards) >= 21) hand.done = true;
    return await advanceOrSettle(session, state);
  }

  if (action === "stand") {
    hand.done = true;
    return await advanceOrSettle(session, state);
  }

  if (action === "double") {
    if (hand.cards.length !== 2 || hand.doubled) return Response.json({ type: 6 });
    try {
      await adjustBalance(session.discord_user_id, -hand.bet);
    } catch {
      return Response.json({
        type: 4,
        data: { content: "Not enough balance to double.", flags: 64 },
      });
    }
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(state.deck.pop()!);
    hand.done = true;
    return await advanceOrSettle(session, state);
  }

  if (action === "split") {
    if (state.split || state.hands.length !== 1 || hand.cards.length !== 2) {
      return Response.json({ type: 6 });
    }
    if (rankOf(hand.cards[0]!) !== rankOf(hand.cards[1]!)) return Response.json({ type: 6 });
    try {
      await adjustBalance(session.discord_user_id, -hand.bet);
    } catch {
      return Response.json({
        type: 4,
        data: { content: "Not enough balance to split.", flags: 64 },
      });
    }
    const second = hand.cards.pop()!;
    hand.cards.push(state.deck.pop()!);
    state.hands.push({ cards: [second, state.deck.pop()!], bet: hand.bet, done: false, doubled: false });
    state.split = true;
    state.active = 0;
    await saveSession(session.id, state, "active");
    return updateMessage(
      blackjackCard(session, state, true, "active", undefined, await blackjackButtons(session, state)),
    );
  }

  return Response.json({ type: 6 });
}

/* ---------------------------- Component routing ---------------------------- */

function ephemeral(message: string) {
  return Response.json({ type: 4, data: { content: message, flags: 64 } });
}

export async function handleGameComponent(
  kindPrefix: string,
  sessionId: string,
  action: string,
  clickerId: string,
) {
  const session = await getSession(sessionId);
  if (!session) return ephemeral("That game has expired.");
  if (session.discord_user_id !== clickerId) return ephemeral("This is not your game.");
  if (session.status !== "active") return ephemeral("That game is already finished.");

  if (kindPrefix === "m") return await handleMinesClick(session, action);
  if (kindPrefix === "t") return await handleTowersClick(session, action);
  if (kindPrefix === "b") return await handleBlackjackClick(session, action);
  return Response.json({ type: 6 });
}
