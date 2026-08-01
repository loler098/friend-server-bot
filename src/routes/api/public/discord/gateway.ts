import { createFileRoute } from "@tanstack/react-router";
import { startGateway, stopGateway } from "@/lib/discord/gateway";
import { acquireGatewayLock, getLastHeartbeat } from "@/lib/discord/gateway-status";

function isHeartbeatAlive(heartbeat: { connected: boolean | null; last_heartbeat_at: string | null } | null) {
  if (!heartbeat?.connected || !heartbeat.last_heartbeat_at) return false;
  return new Date(heartbeat.last_heartbeat_at).getTime() > Date.now() - 90_000;
}

export const Route = createFileRoute("/api/public/discord/gateway")({
  server: {
    handlers: {
      GET: async () => {
        const heartbeat = await getLastHeartbeat();
        return Response.json({
          connected: isHeartbeatAlive(heartbeat),
          sessionId: heartbeat?.session_id ?? null,
          heartbeat,
        });
      },
      POST: async ({ request }) => {
        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace("Bearer ", "");
        const accepted = [
          process.env["SUPABASE_ANON_KEY"],
          process.env["SUPABASE_PUBLISHABLE_KEY"],
        ].filter(Boolean);
        if (!apikey || !accepted.includes(apikey)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const action = new URL(request.url).searchParams.get("action") ?? "start";
        if (action === "stop") {
          return Response.json({ success: true, ...stopGateway() });
        }

        const heartbeat = await getLastHeartbeat();
        if (isHeartbeatAlive(heartbeat)) {
          return Response.json({
            success: true,
            status: "already_connected",
            connected: true,
            sessionId: heartbeat?.session_id ?? null,
          });
        }

        const lock = await acquireGatewayLock(60);
        if (!lock) {
          return Response.json({
            success: true,
            status: "already_active",
            connected: false,
          });
        }

        const result = startGateway();
        return Response.json({ success: true, ...result });
      },
    },
  },
});
