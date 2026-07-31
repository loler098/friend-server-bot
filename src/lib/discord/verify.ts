/**
 * Discord Ed25519 signature verification using the Web Crypto API.
 * Works in Cloudflare Workers and Node.js.
 */

function hexToBuffer(hex: string): Uint8Array {
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
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBuffer(publicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(timestamp + body);
  return crypto.subtle.verify("Ed25519", key, hexToBuffer(signature), data);
}
