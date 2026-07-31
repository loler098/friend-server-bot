export const CENTS = 100;

export function formatEur(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / CENTS);
  const rest = abs % CENTS;
  return `${sign}€${whole.toLocaleString("en-US")}.${rest.toString().padStart(2, "0")}`;
}

/** Parses a euro string/number ("12.5", 12.5) into integer cents. */
export function toCents(value: string | number): number | null {
  const num = typeof value === "number" ? value : Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(num)) return null;
  return Math.round(num * CENTS);
}
