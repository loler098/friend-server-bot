function toHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomSeed(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

export function roundId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(4))).toUpperCase();
}
