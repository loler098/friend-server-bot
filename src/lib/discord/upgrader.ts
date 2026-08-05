import { DISCORD_API } from "./commands";
import { IS_COMPONENTS_V2, type Component } from "./ui";

function appIdFromToken(token: string): string | null {
  try {
    let seg = token.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/");
    while (seg.length % 4 !== 0) seg += "=";
    const id = atob(seg);
    return /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** ACKs the interaction ourselves, animates spin frames, then shows the final card. */
export async function animateUpgrader(
  interactionId: string,
  interactionToken: string,
  frames: Component[][],
  finalComponents: Component[],
  applicationId?: string,
) {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const appId = applicationId ?? (token ? appIdFromToken(token) : null);
  if (!appId || frames.length === 0) return false;

  const ack = await fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: 4, data: { flags: IS_COMPONENTS_V2, components: frames[0] } }),
  });
  if (!ack.ok) return false;

  const editUrl = `${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`;
  const edit = (components: Component[]) =>
    fetch(editUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flags: IS_COMPONENTS_V2, components }),
    });

  for (let i = 1; i < frames.length; i++) {
    await new Promise((r) => setTimeout(r, 400));
    await edit(frames[i]!).catch(() => null);
  }
  await new Promise((r) => setTimeout(r, 400));
  await edit(finalComponents).catch(() => null);
  return true;
}
