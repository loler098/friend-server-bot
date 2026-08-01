import { createServerFn } from "@tanstack/react-start";
import { startGateway, stopGateway } from "./gateway";
import { acquireGatewayLock, getLastHeartbeat } from "./gateway-status";

function isHeartbeatAlive(heartbeat: { connected: boolean | null; last_heartbeat_at: string | null } | null) {
  if (!heartbeat?.connected || !heartbeat.last_heartbeat_at) return false;
  return new Date(heartbeat.last_heartbeat_at).getTime() > Date.now() - 90_000;
}

export const connectDiscordGateway = createServerFn({ method: "POST" }).handler(async () => {
  const heartbeat = await getLastHeartbeat();
  if (isHeartbeatAlive(heartbeat)) {
    return {
      status: "already_connected",
      connected: true,
      sessionId: heartbeat?.session_id ?? null,
    };
  }

  const lock = await acquireGatewayLock(60);
  if (!lock) {
    return {
      status: "already_active",
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
