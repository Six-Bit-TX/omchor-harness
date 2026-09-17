/**
 * Hand-authored pushpin glyphs for the Session row menu (the shared icon set
 * carries no pin). Both ride currentColor on the icon-set 16 grid.
 */
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** Pushpin: the Pin to top row. */
export function IconPinOutline16({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <path d="M6.4 2.4h3.2l-.5 3.1 2.2 2.3v1.1H4.7V7.8l2.2-2.3-.5-3.1Z" />
      <path d="M8 9.9v3.7" />
    </svg>
  )
}

/** Tilted pushpin: the Unpin row. */
export function IconUnpinOutline16({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <path d="M6.4 2.4h3.2l-.5 3.1 2.2 2.3v1.1H4.7V7.8l2.2-2.3-.5-3.1Z" />
      <path d="M8 9.9v3.7" />
      <path d="M2.6 2.6l10.8 10.8" />
    </svg>
  )
}
