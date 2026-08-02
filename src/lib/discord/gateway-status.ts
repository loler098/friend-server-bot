import { getAdminClient } from "./games";

const STATUS_ID = 1;

export async function getLastHeartbeat() {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("bot_gateway_status")
    .select("last_heartbeat_at, connected, session_id")
    .eq("id", STATUS_ID)
    .maybeSingle();
  return data;
}

export async function acquireGatewayLock(maxAgeSeconds = 60) {
  const supabase = getAdminClient();
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - maxAgeSeconds * 1000).toISOString();

  const { data } = await supabase
    .from("bot_gateway_status")
    .select("last_heartbeat_at")
    .eq("id", STATUS_ID)
    .maybeSingle();

  if (data && data.last_heartbeat_at && data.last_heartbeat_at > cutoff) {
    return false;
  }

  void now;
  return true;
}

export async function touchHeartbeat(sessionId: string | null | undefined) {
  try {
    const supabase = getAdminClient();
    await supabase.from("bot_gateway_status").upsert({
      id: STATUS_ID,
      connected: true,
      last_heartbeat_at: new Date().toISOString(),
      session_id: sessionId ?? null,
    });
  } catch (e) {
    console.error("Failed to touch heartbeat", e);
  }
}


export async function markDisconnected() {
  try {
    const supabase = getAdminClient();
    await supabase
      .from("bot_gateway_status")
      .upsert({ id: STATUS_ID, connected: false, last_heartbeat_at: new Date().toISOString() });
  } catch (e) {
    console.error("Failed to mark disconnected", e);
  }
}
