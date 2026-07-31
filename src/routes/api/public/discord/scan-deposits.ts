import { createFileRoute } from "@tanstack/react-router";
import { scanDeposits } from "@/lib/discord/banking";

export const Route = createFileRoute("/api/public/discord/scan-deposits")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace("Bearer ", "");
        const expected =
          process.env["SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const result = await scanDeposits();
          return Response.json({ success: true, ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Scan failed";
          console.error("Deposit scan failed", error);
          return Response.json({ success: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
