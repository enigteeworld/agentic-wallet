export function shortAddr(a: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-6)}`;
}

export function formatSol(sol: number) {
  return sol.toFixed(4);
}

export function formatToken(raw: string | null, decimals: number) {
  if (!raw) return "—";
  const n = BigInt(raw);
  const base = BigInt(10) ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}
