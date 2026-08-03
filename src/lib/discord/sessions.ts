import { getAdminClient } from "./games";

export type SessionKind = "mines" | "towers" | "blackjack";

export type GameSession = {
  id: string;
  discord_user_id: string;
  discord_username: string;
  kind: string;
  bet_cents: number;
  state: any;
  status: string;
};

export async function createSession(
  discordUserId: string,
  discordUsername: string,
  kind: SessionKind,
  betCents: number,
  state: unknown,
): Promise<GameSession> {
  const { data, error } = await getAdminClient()
    .from("game_sessions")
    .insert({
      discord_user_id: discordUserId,
      discord_username: discordUsername,
      kind,
      bet_cents: betCents,
      state: state as never,
      status: "active",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not start the game");
  return data as unknown as GameSession;
}

export async function getSession(id: string): Promise<GameSession | null> {
  const { data } = await getAdminClient()
    .from("game_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as GameSession) ?? null;
}

export async function saveSession(id: string, state: unknown, status: "active" | "done") {
  await getAdminClient()
    .from("game_sessions")
    .update({ state: state as never, status })
    .eq("id", id);
}