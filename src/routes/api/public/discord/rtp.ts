import { createFileRoute } from "@tanstack/react-router";
import { refreshRtpMessage } from "@/lib/discord/feed";

async function run() {
  try {
    const result = await refreshRtpMessage();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("rtp refresh failed", error);
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/discord/rtp")({
  server: { handlers: { GET: run, POST: run } },
});
