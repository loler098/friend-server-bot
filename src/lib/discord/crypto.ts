import { getAdminClient } from "./games";

export const COINS = {
  BTC: { label: "Bitcoin", coingecko: "bitcoin", decimals: 8 },
  ETH: { label: "Ethereum", coingecko: "ethereum", decimals: 18 },
  LTC: { label: "Litecoin", coingecko: "litecoin", decimals: 8 },
  USDT: { label: "USDT (TRC-20)", coingecko: "tether", decimals: 6 },
} as const;

export type Coin = keyof typeof COINS;

export const MIN_DEPOSIT_CENTS = 500; // €5
export const MIN_WITHDRAW_CENTS = 1000; // €10
export const WITHDRAW_FEE_BPS = 100; // 1%
export const INTENT_WINDOW_MINUTES = 120;

export function isCoin(value: string): value is Coin {
  return value in COINS;
}

/** Live EUR price per unit of the coin. */
export async function getEurPrice(coin: Coin): Promise<number> {
  const id = COINS[coin].coingecko;
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=eur`,
  );
  if (!res.ok) throw new Error(`Price lookup failed for ${coin}`);
  const json = (await res.json()) as Record<string, { eur?: number }>;
  const price = json[id]?.eur;
  if (!price) throw new Error(`No EUR price for ${coin}`);
  return price;
}

export async function getDepositAddress(coin: Coin) {
  const { data } = await getAdminClient()
    .from("deposit_addresses")
    .select("*")
    .eq("coin", coin)
    .eq("active", true)
    .maybeSingle();
  return data;
}

export async function setDepositAddress(coin: Coin, address: string, minConfirmations: number) {
  const { error } = await getAdminClient()
    .from("deposit_addresses")
    .upsert(
      { coin, address, min_confirmations: minConfirmations, active: true },
      { onConflict: "coin" },
    );
  if (error) throw new Error(error.message);
}

export function validateAddress(coin: Coin, address: string): boolean {
  const a = address.trim();
  switch (coin) {
    case "BTC":
      return /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a);
    case "LTC":
      return /^(ltc1[a-z0-9]{25,62}|[LM3][a-km-zA-HJ-NP-Z1-9]{26,34})$/.test(a);
    case "ETH":
      return /^0x[a-fA-F0-9]{40}$/.test(a);
    case "USDT":
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
    default:
      return false;
  }
}

/** Incoming transaction as normalised by the chain adapters. */
export type ChainTx = {
  hash: string;
  amount: number; // in coin units
  confirmations: number;
};

async function fetchEsplora(base: string, address: string): Promise<ChainTx[]> {
  const [txsRes, tipRes] = await Promise.all([
    fetch(`${base}/address/${address}/txs`),
    fetch(`${base}/blocks/tip/height`),
  ]);
  if (!txsRes.ok || !tipRes.ok) throw new Error("Explorer request failed");
  const txs = (await txsRes.json()) as Array<{
    txid: string;
    status: { confirmed: boolean; block_height?: number };
    vout: Array<{ scriptpubkey_address?: string; value: number }>;
  }>;
  const tip = Number(await tipRes.text());
  return txs.map((tx) => {
    const received = tx.vout
      .filter((o) => o.scriptpubkey_address === address)
      .reduce((sum, o) => sum + o.value, 0);
    const confirmations =
      tx.status.confirmed && tx.status.block_height ? tip - tx.status.block_height + 1 : 0;
    return { hash: tx.txid, amount: received / 1e8, confirmations };
  });
}

async function fetchEth(address: string): Promise<ChainTx[]> {
  const res = await fetch(
    `https://eth.blockscout.com/api?module=account&action=txlist&address=${address}&sort=desc`,
  );
  if (!res.ok) throw new Error("Explorer request failed");
  const json = (await res.json()) as {
    result?: Array<{ hash: string; to: string; value: string; confirmations: string; isError: string }>;
  };
  return (json.result ?? [])
    .filter((tx) => tx.isError === "0" && tx.to?.toLowerCase() === address.toLowerCase())
    .map((tx) => ({
      hash: tx.hash,
      amount: Number(tx.value) / 1e18,
      confirmations: Number(tx.confirmations) || 0,
    }));
}

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

async function fetchTron(address: string): Promise<ChainTx[]> {
  const res = await fetch(
    `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=50&contract_address=${USDT_TRC20}`,
  );
  if (!res.ok) throw new Error("Explorer request failed");
  const json = (await res.json()) as {
    data?: Array<{ transaction_id: string; to: string; value: string; block_timestamp: number }>;
  };
  return (json.data ?? [])
    .filter((tx) => tx.to === address)
    .map((tx) => ({
      hash: tx.transaction_id,
      amount: Number(tx.value) / 1e6,
      // TronGrid does not return confirmations; treat >2min old as confirmed.
      confirmations: Date.now() - tx.block_timestamp > 120_000 ? 20 : 0,
    }));
}

export async function fetchIncoming(coin: Coin, address: string): Promise<ChainTx[]> {
  switch (coin) {
    case "BTC":
      return fetchEsplora("https://blockstream.info/api", address);
    case "LTC":
      return fetchEsplora("https://litecoinspace.org/api", address);
    case "ETH":
      return fetchEth(address);
    case "USDT":
      return fetchTron(address);
    default:
      return [];
  }
}

export function getAdminIds(): string[] {
  return (process.env["DISCORD_ADMIN_IDS"] ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAdmin(discordUserId: string) {
  return getAdminIds().includes(discordUserId);
}
