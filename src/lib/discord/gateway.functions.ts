import { createServerFn } from "@tanstack/react-start";
import { startGateway, stopGateway } from "./gateway";
import { acquireGatewayLock, getLastHeartbeat } from "./gateway-status";
import { getAdminClient } from "./games";

function isHeartbeatAlive(heartbeat: { connected: boolean | null; last_heartbeat_at: string | null } | null) {
  if (!heartbeat?.connected || !heartbeat.last_heartbeat_at) return false;
  return new Date(heartbeat.last_heartbeat_at).getTime() > Date.now() - 90_000;
}

export const connectDiscordGateway = createServerFn({ method: "POST" }).handler(async () => {
  // Stop any local connection first, then force a fresh lock so a dead process
  // from another instance doesn't block a manual start.
  stopGateway();

  const supabase = getAdminClient();
  await supabase.from("bot_gateway_status").upsert({
    id: 1,
    connected: false,
    last_heartbeat_at: new Date(Date.now() - 120_000).toISOString(),
  });

  const lock = await acquireGatewayLock(60);
  if (!lock) {
    return {
      status: "lock_failed",
      connected: false,
      sessionId: null,
    };
  }

  const result = startGateway();
  return { ...result, sessionId: result.sessionId ?? null };
});

export const disconnectDiscordGateway = createServerFn({ method: "POST" }).handler(async () => {
  return stopGateway();
});

export const discordGatewayStatus = createServerFn({ method: "GET" }).handler(async () => {
  const heartbeat = await getLastHeartbeat();
  return {
    connected: isHeartbeatAlive(heartbeat),
    sessionId: heartbeat?.session_id ?? null,
    heartbeat,
  };
});
