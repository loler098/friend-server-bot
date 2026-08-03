/**
 * Discord Ed25519 signature verification.
 * Uses a pure-JS implementation so it behaves identically in the edge runtime
 * and in local dev (Web Crypto Ed25519 is not available everywhere).
 */
import { ed25519 } from "@noble/curves/ed25519.js";

function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export async function verifyDiscordKey(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
): Promise<boolean> {
  try {
    const key = hexToBytes(publicKey.trim());
    const sig = hexToBytes(signature.trim());
    if (!key || key.length !== 32 || !sig || sig.length !== 64) return false;
    const data = new TextEncoder().encode(timestamp + body);
    return ed25519.verify(sig, data, key);
  } catch (error) {
    console.error("Discord signature verification failed", error);
    return false;
  }
}

