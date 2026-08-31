/**
 * Base-unit <-> human conversions.
 *
 * The Connect wire is base units as a string, always. Every float that reaches
 * an intent is a bug that silently sends the user 1/1_000_000th of what they
 * meant, so the conversion lives in exactly these two functions.
 */

/** '1.5' + 6 decimals -> '1500000'. Throws on anything that is not a plain decimal. */
export function toBaseUnits(human: string, decimals: number): string {
  const trimmed = human.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Not a decimal amount: "${human}"`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new Error(`Too many decimal places (max ${decimals})`);
  }
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')).toString();
}

/** '1500000' + 6 decimals -> '1.5'. Trailing zeros trimmed, never scientific notation. */
export function fromBaseUnits(base: string | bigint, decimals: number, maxFrac = 4): string {
  let n: bigint;
  try {
    n = BigInt(base);
  } catch {
    return '0';
  }
  const neg = n < 0n;
  if (neg) n = -n;

  const div = 10n ** BigInt(decimals);
  const whole = n / div;
  const frac = (n % div).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

/** 02ed95e9…4f21 — for chain pubkeys and token ids. */
export function shortHex(hex: string | undefined | null, head = 6, tail = 4): string {
  if (!hex) return '—';
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** How the user should be addressed: @nametag if they have one, else short pubkey. */
export function displayName(identity: { nametag?: string; chainPubkey?: string } | null): string {
  if (!identity) return 'not connected';
  return identity.nametag ? `@${identity.nametag}` : shortHex(identity.chainPubkey);
}
