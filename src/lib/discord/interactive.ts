import { adjustBalance } from "./games";
import { formatEur } from "./money";
import { createSession, getSession, saveSession, type GameSession } from "./sessions";
import { mention } from "./commands";

const HOUSE_EDGE = 0.03;

/* ----------------------------- Discord payloads ---------------------------- */

export type Button = {
  type: 2;
  style: 1 | 2 | 3 | 4;
  label: string;
  custom_id: string;
  disabled?: boolean;
};

export function row(buttons: Button[]) {
  return { type: 1, components: buttons };
}

export function reply(content: string, components: unknown[] = [], ephemeral = false) {
  return Response.json({
    type: 4,
    data: { content, components, ...(ephemeral ? { flags: 64 } : {}) },
  });
}

export function updateMessage(content: string, components: unknown[] = []) {
  return Response.json({ type: 7, data: { content, components } });
}

/* --------------------------------- Mines --------------------------------- */

const MINES_TILES = 20; // 5 columns x 4 rows of buttons

type MinesState = { mines: number; bombs: number[]; revealed: number[]; lost: boolean };

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

function minesComponents(session: GameSession, state: MinesState, finished: boolean) {
  const rows: unknown[] = [];
  for (let r = 0; r < 4; r++) {
    const buttons: Button[] = [];
    for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      const isRevealed = state.revealed.includes(i);
      const isBomb = state.bombs.includes(i);
      let label = "❔";
      let style: Button["style"] = 2;
      if (isRevealed) {
        label = isBomb ? "💣" : "💎";
        style = isBomb ? 4 : 3;
      } else if (finished && isBomb) {
        label = "🔻";
        style = 4;
      }
      buttons.push({
        type: 2,
        style,
        label,
        custom_id: `m:${session.id}:${i}`,
        disabled: finished || isRevealed,
      });
    }
    rows.push(row(buttons));
  }
  const safe = state.revealed.length;
  if (!finished) {
    rows.push(
      row([
        {
          type: 2,
          style: 1,
          label:
            safe === 0
              ? "Cash out"
              : `Cash out ${minesMultiplier(state.mines, safe)}x (${formatEur(
                  Math.floor(session.bet_cents * minesMultiplier(state.mines, safe)),
                )})`,
          custom_id: `m:${session.id}:cash`,
          disabled: safe === 0,
        },
      ]),
    );
  }
  return rows;
}

export async function startMines(
  userId: string,
  username: string,
  betCents: number,
  mines: number,
) {
  await adjustBalance(userId, -betCents);
  const state = newMinesState(mines);
  const session = await createSession(userId, username, "mines", betCents, state);
  return reply(
    `💣 ${mention(userId)} started **mines** for ${formatEur(betCents)} with ${mines} mines.\n` +
      `Pick tiles one by one, then cash out.`,
    minesComponents(session, state, false),
  );
}

async function handleMinesClick(session: GameSession, action: string) {
  const state = session.state as MinesState;

  if (action === "cash") {
    const mult = minesMultiplier(state.mines, state.revealed.length);
    const payout = Math.floor(session.bet_cents * mult);
    const balance = await adjustBalance(session.discord_user_id, payout);
    await saveSession(session.id, state, "done");
    return updateMessage(
      `💣 ${mention(session.discord_user_id)} cashed out mines at **${mult}x**\n` +
        `Bet ${formatEur(session.bet_cents)} → won **${formatEur(payout)}** ` +
        `(profit ${formatEur(payout - session.bet_cents)}) — balance ${formatEur(balance)}`,
      minesComponents(session, state, true),
    );
  }

  const tile = Number(action);
  if (!Number.isInteger(tile) || tile < 0 || tile >= MINES_TILES) {
    return updateMessage("Invalid tile.", []);
  }
  if (state.revealed.includes(tile)) return Response.json({ type: 6 });

  state.revealed.push(tile);

  if (state.bombs.includes(tile)) {
    state.lost = true;
    await saveSession(session.id, state, "done");
    return updateMessage(
      `💣 ${mention(session.discord_user_id)} hit a mine after ${state.revealed.length - 1} safe tiles.\n` +
        `Lost **${formatEur(session.bet_cents)}**`,
      minesComponents(session, state, true),
    );
  }

  const safe = state.revealed.length;
  if (safe >= MINES_TILES - state.mines) {
    const mult = minesMultiplier(state.mines, safe);
    const payout = Math.floor(session.bet_cents * mult);
    const balance = await adjustBalance(session.discord_user_id, payout);
    await saveSession(session.id, state, "done");
    return updateMessage(
      `💣 ${mention(session.discord_user_id)} cleared the whole board at **${mult}x** — won **${formatEur(payout)}** — balance ${formatEur(balance)}`,
      minesComponents(session, state, true),
    );
  }

  await saveSession(session.id, state, "active");
  const mult = minesMultiplier(state.mines, safe);
  return updateMessage(
    `💣 ${mention(session.discord_user_id)} — mines for ${formatEur(session.bet_cents)} (${state.mines} mines)\n` +
      `Safe tiles: **${safe}** · Current multiplier **${mult}x** (${formatEur(
        Math.floor(session.bet_cents * mult),
      )})`,
    minesComponents(session, state, false),
  );
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
};

export function towersMultiplier(difficulty: TowersDifficulty, cleared: number) {
  const { tiles, safe } = TOWERS[difficulty];
  return Number((Math.pow(tiles / safe, cleared) * (1 - HOUSE_EDGE)).toFixed(2));
}

function towersComponents(session: GameSession, state: TowersState, finished: boolean) {
  const { tiles } = TOWERS[state.difficulty];
  const rows: unknown[] = [];
  if (!finished) {
    rows.push(
      row(
        Array.from({ length: tiles }, (_, i) => ({
          type: 2 as const,
          style: 2 as const,
          label: `Tile ${i + 1}`,
          custom_id: `t:${session.id}:${i}`,
        })),
      ),
    );
    const mult = towersMultiplier(state.difficulty, state.cleared);
    rows.push(
      row([
        {
          type: 2,
          style: 1,
          label:
            state.cleared === 0
              ? "Cash out"
              : `Cash out ${mult}x (${formatEur(Math.floor(session.bet_cents * mult))})`,
          custom_id: `t:${session.id}:cash`,
          disabled: state.cleared === 0,
        },
      ]),
    );
  }
  return rows;
}

function towersBoard(state: TowersState) {
  return state.history.length ? `${state.history.join("\n")}\n` : "";
}

export async function startTowers(
  userId: string,
  username: string,
  betCents: number,
  difficulty: TowersDifficulty,
) {
  await adjustBalance(userId, -betCents);
  const state: TowersState = { difficulty, cleared: 0, lost: false, history: [] };
  const session = await createSession(userId, username, "towers", betCents, state);
  return reply(
    `🗼 ${mention(userId)} started **${difficulty} towers** for ${formatEur(betCents)}.\n` +
      `Pick a tile on floor 1.`,
    towersComponents(session, state, false),
  );
}

async function handleTowersClick(session: GameSession, action: string) {
  const state = session.state as TowersState;
  const { tiles, safe } = TOWERS[state.difficulty];

  if (action === "cash") {
    const mult = towersMultiplier(state.difficulty, state.cleared);
    const payout = Math.floor(session.bet_cents * mult);
    const balance = await adjustBalance(session.discord_user_id, payout);
    await saveSession(session.id, state, "done");
    return updateMessage(
      `🗼 ${mention(session.discord_user_id)} cashed out towers at **${mult}x**\n` +
        towersBoard(state) +
        `Won **${formatEur(payout)}** (profit ${formatEur(payout - session.bet_cents)}) — balance ${formatEur(balance)}`,
      [],
    );
  }

  const pick = Number(action);
  if (!Number.isInteger(pick) || pick < 0 || pick >= tiles) {
    return updateMessage("Invalid tile.", []);
  }

  const bad = new Set<number>();
  while (bad.size < tiles - safe) bad.add(Math.floor(Math.random() * tiles));
  const survived = !bad.has(pick);
  const line = Array.from({ length: tiles }, (_, i) =>
    i === pick ? (survived ? "🟩" : "🟥") : bad.has(i) ? "💀" : "⬜",
  ).join("");
  state.history.unshift(`Floor ${state.cleared + 1}: ${line}`);

  if (!survived) {
    state.lost = true;
    await saveSession(session.id, state, "done");
    return updateMessage(
      `🗼 ${mention(session.discord_user_id)} fell on floor ${state.cleared + 1}.\n` +
        towersBoard(state) +
        `Lost **${formatEur(session.bet_cents)}**`,
      [],
    );
  }

  state.cleared++;

  if (state.cleared >= MAX_FLOORS) {
    const mult = towersMultiplier(state.difficulty, state.cleared);
    const payout = Math.floor(session.bet_cents * mult);
    const balance = await adjustBalance(session.discord_user_id, payout);
    await saveSession(session.id, state, "done");
    return updateMessage(
      `🗼 ${mention(session.discord_user_id)} reached the top at **${mult}x**\n` +
        towersBoard(state) +
        `Won **${formatEur(payout)}** — balance ${formatEur(balance)}`,
      [],
    );
  }

  await saveSession(session.id, state, "active");
  const mult = towersMultiplier(state.difficulty, state.cleared);
  return updateMessage(
    `🗼 ${mention(session.discord_user_id)} — ${state.difficulty} towers for ${formatEur(session.bet_cents)}\n` +
      towersBoard(state) +
      `Floor ${state.cleared + 1} · Current multiplier **${mult}x** (${formatEur(
        Math.floor(session.bet_cents * mult),
      )})`,
    towersComponents(session, state, false),
  );
}

/* -------------------------------- Blackjack ------------------------------- */

type BlackjackState = { deck: string[]; player: string[]; dealer: string[] };

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

export function handTotal(hand: string[]): number {
  let value = 0;
  let aces = 0;
  for (const card of hand) {
    const rank = card.slice(0, -2);
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

function blackjackComponents(session: GameSession, finished: boolean) {
  if (finished) return [];
  return [
    row([
      { type: 2, style: 3, label: "Hit", custom_id: `b:${session.id}:hit` },
      { type: 2, style: 4, label: "Stand", custom_id: `b:${session.id}:stand` },
    ]),
  ];
}

function blackjackView(session: GameSession, state: BlackjackState, hideDealer: boolean) {
  const dealer = hideDealer
    ? `${state.dealer[0]} 🂠 (**${handTotal([state.dealer[0]!])}**+)`
    : `${state.dealer.join(" ")} (**${handTotal(state.dealer)}**)`;
  return (
    `🃏 ${mention(session.discord_user_id)} plays blackjack for ${formatEur(session.bet_cents)}\n` +
    `Your hand: ${state.player.join(" ")} (**${handTotal(state.player)}**)\n` +
    `Dealer: ${dealer}`
  );
}

export async function startBlackjack(userId: string, username: string, betCents: number) {
  await adjustBalance(userId, -betCents);
  const deck = createDeck();
  const state: BlackjackState = {
    deck,
    player: [deck.pop()!, deck.pop()!],
    dealer: [deck.pop()!, deck.pop()!],
  };
  const session = await createSession(userId, username, "blackjack", betCents, state);

  if (handTotal(state.player) === 21) {
    return await finishBlackjack(session, state, true);
  }
  await saveSession(session.id, state, "active");
  return reply(
    `${blackjackView(session, state, true)}\nHit or stand?`,
    blackjackComponents(session, false),
  );
}

async function finishBlackjack(
  session: GameSession,
  state: BlackjackState,
  natural: boolean,
  initial = true,
) {
  const playerValue = handTotal(state.player);
  let payout = 0;
  let message: string;

  if (playerValue > 21) {
    message = `Bust! Lost **${formatEur(session.bet_cents)}**`;
  } else {
    while (handTotal(state.dealer) < 17) state.dealer.push(state.deck.pop()!);
    const dealerValue = handTotal(state.dealer);
    if (natural && dealerValue !== 21) {
      payout = session.bet_cents + Math.floor(session.bet_cents * 1.5);
      message = `Blackjack! Won **${formatEur(payout - session.bet_cents)}**`;
    } else if (dealerValue > 21 || playerValue > dealerValue) {
      payout = session.bet_cents * 2;
      message = `You win **${formatEur(session.bet_cents)}**`;
    } else if (playerValue === dealerValue) {
      payout = session.bet_cents;
      message = "Push — your bet is returned.";
    } else {
      message = `Dealer wins. Lost **${formatEur(session.bet_cents)}**`;
    }
  }

  const balance = payout
    ? await adjustBalance(session.discord_user_id, payout)
    : await adjustBalance(session.discord_user_id, 0);
  await saveSession(session.id, state, "done");

  const content = `${blackjackView(session, state, false)}\n${message} — balance ${formatEur(balance)}`;
  return initial ? reply(content, []) : updateMessage(content, []);
}

async function handleBlackjackClick(session: GameSession, action: string) {
  const state = session.state as BlackjackState;

  if (action === "hit") {
    state.player.push(state.deck.pop()!);
    if (handTotal(state.player) >= 21) {
      return await finishBlackjack(session, state, false, false);
    }
    await saveSession(session.id, state, "active");
    return updateMessage(
      `${blackjackView(session, state, true)}\nHit or stand?`,
      blackjackComponents(session, false),
    );
  }

  return await finishBlackjack(session, state, false, false);
}

/* ---------------------------- Component routing ---------------------------- */

export async function handleGameComponent(
  kindPrefix: string,
  sessionId: string,
  action: string,
  clickerId: string,
) {
  const session = await getSession(sessionId);
  if (!session) {
    return Response.json({
      type: 4,
      data: { content: "That game has expired.", flags: 64 },
    });
  }
  if (session.discord_user_id !== clickerId) {
    return Response.json({
      type: 4,
      data: { content: "This is not your game.", flags: 64 },
    });
  }
  if (session.status !== "active") {
    return Response.json({
      type: 4,
      data: { content: "That game is already finished.", flags: 64 },
    });
  }

  if (kindPrefix === "m") return await handleMinesClick(session, action);
  if (kindPrefix === "t") return await handleTowersClick(session, action);
  if (kindPrefix === "b") return await handleBlackjackClick(session, action);
  return Response.json({ type: 6 });
}