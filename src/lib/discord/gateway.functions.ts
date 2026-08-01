import { createServerFn } from "@tanstack/react-start";
import { startGateway, stopGateway, getGatewayStatus } from "./gateway";
import { getLastHeartbeat } from "./gateway-status";

export const connectDiscordGateway = createServerFn({ method: "POST" }).handler(async () => {
  const result = startGateway();
  const heartbeat = await getLastHeartbeat();
  return { ...result, heartbeat };
});

export const disconnectDiscordGateway = createServerFn({ method: "POST" }).handler(async () => {
  return stopGateway();
});

export const discordGatewayStatus = createServerFn({ method: "GET" }).handler(async () => {
  const status = getGatewayStatus();
  const heartbeat = await getLastHeartbeat();
  return { ...status, heartbeat };
});
