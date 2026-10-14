export type ThemeMode = 'light' | 'dark' | 'auto'

export type Theme = {
  /** `auto` follows the visitor's system setting. Default `light`. */
  mode?: ThemeMode
  /** Primary action color. Defaults to the ink color. */
  accent?: string
  /** Surface behind the views, or `transparent`. Defaults to Coven paper (light) or ink (dark). */
  bg?: string
  /** Corner radius for the modal and controls, in px. Default 20. */
  radius?: number
  /** Font stack. Defaults to Inter, falling back to the system UI font. */
  font?: string
  /** Tighter spacing and smaller headings, for sidebars and narrow columns. */
  compact?: boolean
}

export type ResolvedTheme = Required<Omit<Theme, 'mode' | 'accent' | 'bg'>> & {
  mode: 'light' | 'dark'
  accent?: string
  bg: string
  fg: string
}

const PAPER = '#EFECE4'
const INK = '#0E0E0D'
const DEFAULT_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
// Font stacks are plain names, quotes, commas and spaces. Anything else (a `;`, a `}`, a url())
// could escape the custom property it is written into, so it is refused.
const FONT_STACK = /^[\w\s"',.-]+$/

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX_COLOR.test(value.trim())

/** Fills defaults and drops unsafe values. `prefersDark` resolves `auto`. */
export function resolveTheme(theme: Theme = {}, prefersDark = false): ResolvedTheme {
  const mode = theme.mode === 'auto' ? (prefersDark ? 'dark' : 'light') : theme.mode === 'dark' ? 'dark' : 'light'
  const bg =
    theme.bg?.trim().toLowerCase() === 'transparent' ? 'transparent' : isHexColor(theme.bg) ? theme.bg.trim() : mode === 'dark' ? INK : PAPER
  return {
    mode,
    accent: isHexColor(theme.accent) ? theme.accent.trim() : undefined,
    bg,
    fg: mode === 'dark' ? PAPER : '#000000',
    radius: Number.isFinite(theme.radius) ? Math.min(Math.max(Math.round(theme.radius!), 0), 48) : 20,
    font: theme.font && FONT_STACK.test(theme.font) ? theme.font : DEFAULT_FONT,
    compact: Boolean(theme.compact),
  }
}

/** The design tokens every view reads. Applied to each element's host. */
export function themeVariables(theme: ResolvedTheme): Record<string, string> {
  return {
    '--coven-bg': theme.bg,
    '--coven-fg': theme.fg,
    '--coven-accent': theme.accent ?? theme.fg,
    '--coven-radius': `${theme.radius}px`,
    '--coven-font': theme.font,
    // The modal sits on the page, so it always needs an opaque surface even when inline views
    // are transparent.
    '--coven-surface': theme.bg === 'transparent' ? (theme.mode === 'dark' ? INK : PAPER) : theme.bg,
  }
}
