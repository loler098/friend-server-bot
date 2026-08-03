import { DISCORD_API } from "./commands";

function appId(token: string) {
  return atob(token.split(".")[0]!);
}

const FRAMES = ["🎰 |", "🎰 /", "🎰 —", "🎰 \\"];

/** ACKs the interaction ourselves, animates a spin, then shows the result. */
export async function animateUpgrader(
  interactionId: string,
  interactionToken: string,
  header: string,
  finalContent: string,
) {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) return false;

  const ack = await fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: 4, data: { content: `${header}\n${FRAMES[0]} spinning…` } }),
  });
  if (!ack.ok) return false;

  const editUrl = `${DISCORD_API}/webhooks/${appId(token)}/${interactionToken}/messages/@original`;
  const edit = (content: string) =>
    fetch(editUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${token}` },
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