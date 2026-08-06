import { DISCORD_API } from "./commands";

function token() {
  const t = process.env["DISCORD_BOT_TOKEN"];
  if (!t) throw new Error("DISCORD_BOT_TOKEN is not set");
  return t;
}

export async function botFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${token()}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord ${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.status === 204 ? null : await res.json();
}

export async function sendMessage(channelId: string, data: Record<string, unknown>) {
  return await botFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function editMessage(
  channelId: string,
  messageId: string,
  data: Record<string, unknown>,
) {
  return await botFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Finds a text channel by name in the guild (case-insensitive, ignores emoji prefixes). */
export async function findChannelByName(guildId: string, name: string): Promise<string | null> {
  try {
    const channels = (await botFetch(`/guilds/${guildId}/channels`)) as Array<{
      id: string;
      name: string;
      type: number;
    }>;
    // Normalise: drop emojis, separators and spaces so "🎲｜game results" matches "game-results".
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const wanted = norm(name);
    const textChannels = channels.filter((c) => c.type === 0 || c.type === 5);
    const hit =
      textChannels.find((c) => norm(c.name) === wanted) ??
      textChannels.find((c) => norm(c.name).includes(wanted));
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

/** Creates a thread on a channel and returns its id. */
export async function createThread(
  channelId: string,
  name: string,
  isPrivate: boolean,
): Promise<string | null> {
  try {
    const thread = (await botFetch(`/channels/${channelId}/threads`, {
      method: "POST",
      body: JSON.stringify({
        name: name.slice(0, 90),
        type: isPrivate ? 12 : 11,
        auto_archive_duration: 60,
        invitable: false,
      }),
    })) as { id: string };
    return thread.id;
  } catch {
    return null;
  }
}

export async function addThreadMember(threadId: string, userId: string) {
  try {
    await botFetch(`/channels/${threadId}/thread-members/${userId}`, { method: "PUT" });
  } catch {
    /* ignore */
  }
}
