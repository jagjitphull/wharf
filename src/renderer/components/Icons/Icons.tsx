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

/** Same folder silhouette as IconFolder but with the flap propped open —
 * used for an expanded group node in the sidebar's host tree. */
export function IconFolderOpen({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M2 5.5V4.5c0-.55.45-1 1-1h3.2l1.2 1.5H13c.55 0 1 .45 1 1v.5" />
      <path d="M2 5.5h11.5l-1 6a1 1 0 0 1-1 .8H4a1 1 0 0 1-1-.85L2 5.5z" />
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

export function IconCopy({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" />
      <path d="M10.5 5.5V3.9a1.4 1.4 0 0 0-1.4-1.4H3.9a1.4 1.4 0 0 0-1.4 1.4v5.2a1.4 1.4 0 0 0 1.4 1.4h1.6" />
    </svg>
  );
}

export function IconCheck({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M3.2 8.4l3 3 6.6-6.8" />
    </svg>
  );
}

export function IconMinus({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M3 8h10" />
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

export function IconUpload({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M8 13.5V6M4.5 9l3.5-3 3.5 3M3 13h10" />
    </svg>
  );
}

export function IconSearch({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M13 13l-2.7-2.7" />
    </svg>
  );
}

export function IconArrowRight({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M2.5 8h11M9.5 4l4 4-4 4" />
    </svg>
  );
}

export function IconArrowLeft({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M13.5 8h-11M6.5 4l-4 4 4 4" />
    </svg>
  );
}

export function IconTerminal({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.2" />
      <path d="M4 6l2.8 2.5L4 11M8.5 11h3.5" />
    </svg>
  );
}

export function IconClose({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}

export function IconRefresh({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6M13 6V3M13 6h-3M13 8a5 5 0 0 1-8.5 3.5L3 10M3 10v3M3 10h3" />
    </svg>
  );
}

export function IconMore({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common} fill="currentColor" stroke="none">
      <circle cx="3.2" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.8" cy="8" r="1.3" />
    </svg>
  );
}

export function IconStar({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common} fill="currentColor" stroke="none">
      <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  );
}

export function IconChevronUp({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M3.5 10l4.5-4.5 4.5 4.5" />
    </svg>
  );
}

export function IconChevronDown({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  );
}

export function IconAnchor({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <circle cx="8" cy="2.8" r="1.5" />
      <path d="M8 4.3v9.2M5 6.5h6M2.8 9a5.2 5.2 0 0 0 5.2 5.2A5.2 5.2 0 0 0 13.2 9" />
    </svg>
  );
}

export function IconDuplicate({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
      <path d="M10.5 5.5V3.7a1.2 1.2 0 0 0-1.2-1.2H3.2A1.2 1.2 0 0 0 2 3.7v6.1a1.2 1.2 0 0 0 1.2 1.2h1.8" />
    </svg>
  );
}

export function IconPin({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M9.6 2.2 13.8 6.4l-1.5.5-2.2 2.2.3 2.6-1 1-2.4-2.4-3.2 3.2-.7-.7 3.2-3.2-2.4-2.4 1-1 2.6.3 2.2-2.2z" />
    </svg>
  );
}

export function IconBroadcast({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <path d="M5.3 5.3a3.8 3.8 0 0 0 0 5.4M10.7 5.3a3.8 3.8 0 0 1 0 5.4" />
      <path d="M2.8 2.8a7.4 7.4 0 0 0 0 10.4M13.2 2.8a7.4 7.4 0 0 1 0 10.4" />
    </svg>
  );
}

// The icon-rail and Home set. Drawn on a 24px grid (the design's native size)
// with a slightly heavier stroke, since they're shown at 18–20px.
const grid = { ...common, strokeWidth: 1.7 };

export function IconHome({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <path d="M3 11l9-8 9 8M5 10v10h14V10" />
    </svg>
  );
}

export function IconServer({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6zM3 15a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3zM7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}

export function IconTunnel({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <path d="M3 8h14l-3-3M21 16H7l3 3" />
    </svg>
  );
}

export function IconCards({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconList({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function IconKey({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
    </svg>
  );
}

export function IconLayers({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />
    </svg>
  );
}

export function IconClock({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function IconSliders({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

export function IconKeyboard({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10" />
    </svg>
  );
}

export function IconSun({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7L5.3 5.3" />
    </svg>
  );
}

export function IconMoon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...grid}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
    </svg>
  );
}

export function IconChevronLeft({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  );
}

export function IconChevronRight({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...common}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}
