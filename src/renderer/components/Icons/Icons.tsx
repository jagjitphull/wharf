/**
 * A small, consistent inline-SVG icon set (stroke-based, currentColor,
 * 14x14) used in place of emoji glyphs across the action buttons in the
 * Sidebar and SFTP browser, matching the style already used in TitleBar.
 */
interface IconProps {
  size?: number;
}

const common = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconPlay({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common} fill="currentColor" stroke="none">
      <path d="M4 2.5v11l10-5.5-10-5.5z" />
    </svg>
  );
}

export function IconFolder({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M2 4.5c0-.55.45-1 1-1h3.2l1.2 1.5H13c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1v-8z" />
    </svg>
  );
}

export function IconPencil({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M11.5 2.5l2 2-8 8-2.6.6.6-2.6z" />
    </svg>
  );
}

export function IconTrash({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4" />
    </svg>
  );
}

export function IconPlus({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconFile({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M4 2h5.5L12 4.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M9.5 2v2.5H12" />
    </svg>
  );
}

export function IconDownload({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M8 2.5v7.5M4.5 7l3.5 3 3.5-3M3 13h10" />
    </svg>
  );
}
