import { getAdminClient } from "./games";
import { findChannelByName } from "./rest";

export async function getConfig(key: string): Promise<string | null> {
  const { data } = await getAdminClient()
    .from("bot_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

export async function setConfig(key: string, value: string) {
  await getAdminClient()
    .from("bot_config")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/** Resolves (and caches) a channel id for a named feed channel in a guild. */
export async function resolveChannel(
  guildId: string | undefined,
  channelName: string,
): Promise<string | null> {
  if (!guildId) return null;
  const key = `channel:${channelName}:${guildId}`;
  const cached = await getConfig(key);
  if (cached) return cached;
  const found = await findChannelByName(guildId, channelName);
  if (found) await setConfig(key, found);
  return found;
}
