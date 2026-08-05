import { adjustBalance, getAdminClient, getOrCreatePlayer } from "./games";
import { formatEur } from "./money";
import { getConfig, resolveChannel, setConfig } from "./config";
import { editMessage, sendMessage } from "./rest";
import { COLORS, IS_COMPONENTS_V2, button, container, row, separator, stats, text, title } from "./ui";

export const RAIN_CHANNEL = "rain";

export type RainConfig = { prizeCents: number; winners: number; durationSeconds: number };

const DEFAULTS: RainConfig = { prizeCents: 10000, winners: 3, durationSeconds: 120 };

export async function getRainConfig(guildId: string): Promise<RainConfig> {
  const raw = await getConfig(`rain:config:${guildId}`);
  if (!raw) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RainConfig>) };
  } catch {
    return DEFAULTS;
  }
}

export async function setRainConfig(guildId: string, config: RainConfig) {
  await setConfig(`rain:config:${guildId}`, JSON.stringify(config));
}

function rainCard(
  rain: { id: string; prize_cents: number; winners: number; ends_at: string | null },
  joined: number,
  closed: boolean,
) {
  const endsUnix = rain.ends_at ? Math.floor(new Date(rain.ends_at).getTime() / 1000) : null;
  return [
    container(closed ? COLORS.dark : COLORS.rain, [
      title("🌧️", closed ? "Rain ended" : "Rain incoming!", "Click join to enter the draw"),
      text(
        stats([
          ["💰 Prize pool", formatEur(rain.prize_cents)],
          ["👥 Winners", `${rain.winners}`],
          ["🎫 Each wins", formatEur(Math.floor(rain.prize_cents / Math.max(1, rain.winners)))],
          ["⏳ Time remaining", closed || !endsUnix ? "Closed" : `<t:${endsUnix}:R>`],
          ["🙋 Joined", `${joined}`],
        ]),
      ),
      separator(),
      row(
        button({
          style: closed ? 2 : 3,
          label: closed ? "Rain closed" : "🎉 Join Rain",
          custom_id: `rain:${rain.id}:join`,
          disabled: closed,
        }),
      ),
    ]),
  ];
}

export async function startRain(guildId: string, fallbackChannelId: string, createdBy: string) {
  const supabase = getAdminClient();
  const { data: running } = await supabase
    .from("rain_events")
    .select("*")
    .eq("guild_id", guildId)
    .eq("status", "active")
    .maybeSingle();
  if (running) return { error: "running" as const };

  const config = await getRainConfig(guildId);
  const channelId = (await resolveChannel(guildId, RAIN_CHANNEL)) ?? fallbackChannelId;
  const endsAt = new Date(Date.now() + config.durationSeconds * 1000).toISOString();

  const { data: rain, error } = await supabase
    .from("rain_events")
    .insert({
      guild_id: guildId,
      channel_id: channelId,
      prize_cents: config.prizeCents,
      winners: config.winners,
      duration_seconds: config.durationSeconds,
      ends_at: endsAt,
      status: "active",
      created_by: createdBy,
    })
    .select("*")
    .single();
  if (error || !rain) return { error: "db" as const };

  const message = (await sendMessage(channelId, {
    flags: IS_COMPONENTS_V2,
    components: rainCard(rain, 0, false),
  })) as { id: string };

  await supabase.from("rain_events").update({ message_id: message.id }).eq("id", rain.id);
  return { rain, channelId };
}

export async function joinRain(rainId: string, userId: string, username: string) {
  const supabase = getAdminClient();
  const { data: rain } = await supabase.from("rain_events").select("*").eq("id", rainId).maybeSingle();
  if (!rain || rain.status !== "active") return { ok: false as const, reason: "closed" as const };
  if (rain.ends_at && new Date(rain.ends_at).getTime() <= Date.now()) {
    await settleRain(rainId);
    return { ok: false as const, reason: "closed" as const };
  }

  await getOrCreatePlayer(userId, username);
  const { error } = await supabase
    .from("rain_entries")
    .insert({ rain_id: rainId, discord_user_id: userId, discord_username: username });
  if (error) return { ok: false as const, reason: "already" as const };

  const { count } = await supabase
    .from("rain_entries")
    .select("id", { count: "exact", head: true })
    .eq("rain_id", rainId);

  if (rain.channel_id && rain.message_id) {
    await editMessage(rain.channel_id, rain.message_id, {
      flags: IS_COMPONENTS_V2,
      components: rainCard(rain, count ?? 1, false),
    }).catch(() => null);
  }
  return { ok: true as const, joined: count ?? 1, rain };
}

export async function settleRain(rainId: string) {
  const supabase = getAdminClient();
  const { data: rain } = await supabase.from("rain_events").select("*").eq("id", rainId).maybeSingle();
  if (!rain || rain.status !== "active") return null;

  const { data: claimed } = await supabase
    .from("rain_events")
    .update({ status: "settling" })
    .eq("id", rainId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (!claimed) return null;

  const { data: entries } = await supabase
    .from("rain_entries")
    .select("*")
    .eq("rain_id", rainId);

  const pool = [...(entries ?? [])];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = a;
  }
  const winners = pool.slice(0, rain.winners);
  const share = winners.length > 0 ? Math.floor(rain.prize_cents / winners.length) : 0;

  for (const winner of winners) {
    await adjustBalance(winner.discord_user_id, share).catch(() => null);
  }

  await supabase.from("rain_events").update({ status: "ended" }).eq("id", rainId);

  if (rain.channel_id) {
    if (rain.message_id) {
      await editMessage(rain.channel_id, rain.message_id, {
        flags: IS_COMPONENTS_V2,
        components: rainCard(rain, entries?.length ?? 0, true),
      }).catch(() => null);
    }
    await sendMessage(rain.channel_id, {
      flags: IS_COMPONENTS_V2,
      components: [
        container(winners.length ? COLORS.win : COLORS.dark, [
          title("🎉", winners.length ? "Rain winners!" : "Rain ended with no entries"),
          text(
            winners.length
              ? `${winners.map((w) => `<@${w.discord_user_id}>`).join(" · ")}\n\n` +
                stats([
                  ["Each received", formatEur(share)],
                  ["Total paid", formatEur(share * winners.length)],
                  ["Entries", `${entries?.length ?? 0}`],
                ])
              : "Nobody joined this rain — the prize stays in the house.",
          ),
        ]),
      ],
    }).catch(() => null);
  }

  return { winners, share };
}

export async function stopRain(guildId: string) {
  const { data: rain } = await getAdminClient()
    .from("rain_events")
    .select("id")
    .eq("guild_id", guildId)
    .eq("status", "active")
    .maybeSingle();
  if (!rain) return null;
  return await settleRain(rain.id);
}

/** Settles every rain whose timer has expired. Safe to call often. */
export async function settleDueRains() {
  const { data } = await getAdminClient()
    .from("rain_events")
    .select("id")
    .eq("status", "active")
    .lte("ends_at", new Date().toISOString());
  for (const rain of data ?? []) {
    await settleRain(rain.id).catch(() => null);
  }
}

export { rainCard };
