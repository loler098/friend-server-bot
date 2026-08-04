import { DISCORD_API } from "./commands";

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

const FRAMES = ["🎰 |", "🎰 /", "🎰 —", "🎰 \\"];

/** ACKs the interaction ourselves, animates a spin, then shows the result. */
export async function animateUpgrader(
  interactionId: string,
  interactionToken: string,
  header: string,
  finalContent: string,
  applicationId?: string,
) {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const appId = applicationId ?? (token ? appIdFromToken(token) : null);
  if (!appId) return false;

  const ack = await fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: 4, data: { content: `${header}\n${FRAMES[0]} spinning…` } }),
  });
  if (!ack.ok) return false;

  // Webhook edits are authenticated by the interaction token itself.
  const editUrl = `${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`;
  const edit = (content: string) =>
    fetch(editUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

  for (let i = 1; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 350));
    await edit(`${header}\n${FRAMES[i % FRAMES.length]} spinning…`).catch(() => null);
  }
  await new Promise((r) => setTimeout(r, 350));
  await edit(finalContent).catch(() => null);
  return true;
}