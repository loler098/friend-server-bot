import { markDisconnected, touchHeartbeat } from "./gateway-status";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

let activeSocket: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let sessionId: string | null = null;

export function getGatewayStatus() {
  return {
    connected: activeSocket?.readyState === WebSocket.OPEN,
    sessionId,
  };
}

export function stopGateway() {
  if (activeSocket) {
    activeSocket.close();
    activeSocket = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  sessionId = null;
  void markDisconnected();
  return { status: "disconnected", connected: false, sessionId: null };
}

export function startGateway() {
  if (activeSocket?.readyState === WebSocket.OPEN) {
    return { status: "already_connected", connected: true, sessionId };
  }

  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) throw new Error("DISCORD_BOT_TOKEN not set");

  const socket = new WebSocket(GATEWAY_URL);
  activeSocket = socket;

  let lastSequence: number | null = null;

  socket.onopen = () => {
    console.log("Discord Gateway connected");
  };

  socket.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.s) lastSequence = payload.s;

    switch (payload.op) {
      case 10: {
        const interval = payload.d.heartbeat_interval;
        // Send initial heartbeat to avoid a timeout, then schedule the rest.
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ op: 1, d: lastSequence }));
        }
        void touchHeartbeat(sessionId);
        heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ op: 1, d: lastSequence }));
          }
          void touchHeartbeat(sessionId);
        }, interval);
        socket.send(
          JSON.stringify({
            op: 2,
            d: {
              token,
              intents: 0,
              properties: {
                os: "linux",
                browser: "lovable-bot",
                device: "lovable-bot",
              },
              presence: {
                status: "online",
                afk: false,
                activities: [],
                since: 0,
              },
            },
          }),
        );
        break;
      }
      case 11:
        // Heartbeat ACK
        break;
      case 7:
        // Reconnect requested
        console.log("Discord Gateway requested reconnect");
        socket.close();
        break;
      case 9:
        // Invalid session
        console.log("Discord Gateway invalid session");
        socket.close();
        break;
      case 0:
        if (payload.t === "READY") {
          sessionId = payload.d.session_id;
          console.log("Discord Gateway READY", sessionId);
          void touchHeartbeat(sessionId);
        }
        if (payload.t === "RESUMED") {
          console.log("Discord Gateway resumed");
        }
        break;
    }
  };

  socket.onerror = (error) => {
    console.error("Discord Gateway error", error);
  };

  socket.onclose = () => {
    console.log("Discord Gateway closed");
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    activeSocket = null;
    sessionId = null;
    void markDisconnected();
  };

  return { status: "connecting", connected: false, sessionId: null };
}
