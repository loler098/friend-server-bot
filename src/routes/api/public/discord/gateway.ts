import { createFileRoute } from "@tanstack/react-router";
import { startGateway, stopGateway } from "@/lib/discord/gateway";
import { acquireGatewayLock } from "@/lib/discord/gateway-status";

export const Route = createFileRoute("/api/public/discord/gateway")({
  server: {
    handlers: {
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
