export function formatAmount(value: bigint, decimals: number, maxFractionDigits = 6): string {
  const negative = value < 0n
  const raw = (negative ? -value : value).toString().padStart(decimals + 1, '0')
  const whole = raw.slice(0, raw.length - decimals)
  const fraction = decimals === 0 ? '' : raw.slice(raw.length - decimals).replace(/0+$/, '').slice(0, maxFractionDigits)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
}

/** Parses a user-typed amount into base units. Returns 0n for empty or malformed input. */
export function parseAmount(input: string, decimals: number): bigint {
  const value = input.trim()
  if (!/^\d*\.?\d*$/.test(value) || value === '' || value === '.') return 0n
  const [whole = '0', fraction = ''] = value.split('.')
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')
}

/** Keeps digits and at most one decimal point, the only characters an amount field accepts. */
export function sanitizeAmountInput(value: string): string | undefined {
  const next = value.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  return (next.match(/\./g)?.length ?? 0) <= 1 ? next : undefined
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const named = error as Error & { shortMessage?: string; code?: number | string }
    const first = (named.shortMessage ?? error.message).split('\n')[0] ?? ''
    if (named.code === 4001 || /user rejected|denied|rejected the request/i.test(first)) return 'You cancelled that in your wallet.'
    return first || 'Something went wrong.'
  }
  return 'Something went wrong.'
}
