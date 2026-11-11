// One icon family for the whole UI: 24 px grid, 2 px round strokes, currentColor (DESIGN_SYSTEM_PROPOSAL.md section 6).
// Inline SVG, so no icon font or package. Arrows and chevrons are drawn pointing to the inline END in LTR ("next",
// "forward") and are mirrored in RTL automatically (DIRECTIONAL). Logos, play, check, phone and clock never mirror.
import type { CSSProperties, ReactNode } from 'react';

const P = (d: string) => <path d={d} />;
const C = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} />;
const R = (x: number, y: number, w: number, h: number, rx = 2) => <rect x={x} y={y} width={w} height={h} rx={rx} />;

const ICONS = {
  // ----- navigation and actions
  menu: <>{P('M4 6h16M4 12h16M4 18h16')}</>,
  x: <>{P('M18 6 6 18M6 6l12 12')}</>,
  'chevron-right': <>{P('m9 18 6-6-6-6')}</>,
  'chevron-left': <>{P('m15 18-6-6 6-6')}</>,
  'chevron-down': <>{P('m6 9 6 6 6-6')}</>,
  'chevron-up': <>{P('m18 15-6-6-6 6')}</>,
  'arrow-right': <>{P('M5 12h14M13 5l7 7-7 7')}</>,
  'arrow-left': <>{P('M19 12H5M11 19l-7-7 7-7')}</>,
  search: <>{C(11, 11, 7)}{P('m21 21-4.3-4.3')}</>,
  plus: <>{P('M12 5v14M5 12h14')}</>,
  minus: <>{P('M5 12h14')}</>,
  check: <>{P('M20 6 9 17l-5-5')}</>,
  refresh: <>{P('M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5')}</>,
  undo: <>{P('M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11')}</>,
  'log-out': <>{P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9')}</>,
  'log-in': <>{P('M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3')}</>,
  'external-link': <>{P('M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6')}</>,
  more: <>{P('M12 5.5h.01M12 12h.01M12 18.5h.01')}</>,
  filter: <>{P('M22 3H2l8 9.5V19l4 2v-8.5z')}</>,
  pencil: <>{P('M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z')}{P('m15 5 4 4')}</>,
  trash: <>{P('M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6')}</>,
  eye: <>{P('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z')}{C(12, 12, 3)}</>,
  'eye-off': <>{P('M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.16 3.19M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M14.12 14.12a3 3 0 1 1-4.24-4.24M2 2l20 20')}</>,
  printer: <>{P('M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2')}{R(6, 14, 12, 8, 1)}</>,
  download: <>{P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3')}</>,
  upload: <>{P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12')}</>,
  ban: <>{C(12, 12, 10)}{P('m4.9 4.9 14.2 14.2')}</>,
  'switch-horizontal': <>{P('M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4')}</>,
  copy: <>{R(8, 8, 14, 14)}{P('M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2')}</>,
  // ----- status
  info: <>{C(12, 12, 10)}{P('M12 16v-4M12 8h.01')}</>,
  'alert-circle': <>{C(12, 12, 10)}{P('M12 8v4M12 16h.01')}</>,
  'alert-triangle': <>{P('M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01')}</>,
  'check-circle': <>{C(12, 12, 10)}{P('m8 12 3 3 5-6')}</>,
  'x-circle': <>{C(12, 12, 10)}{P('m15 9-6 6M9 9l6 6')}</>,
  clock: <>{C(12, 12, 10)}{P('M12 6v6l4 2')}</>,
  lock: <>{R(3, 11, 18, 11)}{P('M7 11V7a5 5 0 0 1 10 0v4')}</>,
  // ----- people
  user: <>{C(12, 8, 4)}{P('M20 21a8 8 0 0 0-16 0')}</>,
  users: <>{C(9, 7, 4)}{P('M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.13a4 4 0 0 1 0 7.75M22 21v-1a6 6 0 0 0-4-5.65')}</>,
  'user-plus': <>{C(9, 7, 4)}{P('M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M19 8v6M16 11h6')}</>,
  'user-check': <>{C(9, 7, 4)}{P('M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 11l2 2 4-4')}</>,
  'user-x': <>{C(9, 7, 4)}{P('M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M17 8l5 5M22 8l-5 5')}</>,
  'id-card': <>{R(2, 5, 20, 14)}{C(8, 12, 2.5)}{P('M14 10h4M14 14h4')}</>,
  stethoscope: <>{P('M4 3v6a5 5 0 0 0 10 0V3M9 14v1a6 6 0 0 0 12 0v-3')}{C(21, 10, 2)}</>,
  share: <>{C(18, 5, 3)}{C(6, 12, 3)}{C(18, 19, 3)}{P('m8.6 13.5 6.8 4M15.4 6.5l-6.8 4')}</>,
  // ----- calendar and work
  calendar: <>{R(3, 4, 18, 18)}{P('M16 2v4M8 2v4M3 10h18')}</>,
  'calendar-plus': <>{R(3, 4, 18, 18)}{P('M16 2v4M8 2v4M3 10h18M12 14v5M9.5 16.5h5')}</>,
  'calendar-check': <>{R(3, 4, 18, 18)}{P('M16 2v4M8 2v4M3 10h18m-12 6 2 2 4-4')}</>,
  'calendar-days': <>{R(3, 4, 18, 18)}{P('M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01')}</>,
  clipboard: <>{R(8, 2, 8, 4, 1)}{P('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2')}</>,
  'clipboard-check': <>{R(8, 2, 8, 4, 1)}{P('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2m1 10 2 2 4-4')}</>,
  'note-pen': <>{P('M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z')}</>,
  file: <>{P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6')}</>,
  'file-text': <>{P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5')}</>,
  paperclip: <>{P('m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5')}</>,
  image: <>{R(3, 3, 18, 18)}{C(9, 9, 2)}{P('m21 15-5-5L5 21')}</>,
  history: <>{P('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2')}</>,
  list: <>{P('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01')}</>,
  layout: <>{R(3, 3, 7, 9, 1)}{R(14, 3, 7, 5, 1)}{R(14, 12, 7, 9, 1)}{R(3, 16, 7, 5, 1)}</>,
  // ----- money
  receipt: <>{P('M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3zM9 9h6M9 13h6')}</>,
  wallet: <>{P('M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v3h-4a2 2 0 0 0 0 4h4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5')}</>,
  banknote: <>{R(2, 6, 20, 12)}{C(12, 12, 2.5)}{P('M6 12h.01M18 12h.01')}</>,
  'credit-card': <>{R(2, 5, 20, 14)}{P('M2 10h20')}</>,
  percent: <>{P('M19 5 5 19')}{C(6.5, 6.5, 2.5)}{C(17.5, 17.5, 2.5)}</>,
  tag: <>{P('M12 2H2v10l9.3 9.3a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z')}{C(7, 7, 1.5)}</>,
  package: <>{P('M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5')}</>,
  // ----- insights
  chart: <>{P('M3 3v18h18M7 16v-4M12 16V8M17 16v-7')}</>,
  'trending-up': <>{P('m22 7-8.5 8.5-5-5L2 17M16 7h6v6')}</>,
  megaphone: <>{P('M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM16 9a3 3 0 0 1 0 6M19 6a7 7 0 0 1 0 12')}</>,
  // ----- places and contact
  home: <>{P('M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z')}</>,
  globe: <>{C(12, 12, 10)}{P('M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20')}</>,
  phone: <>{P('M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z')}</>,
  mail: <>{R(2, 4, 20, 16)}{P('m22 7-10 6L2 7')}</>,
  'map-pin': <>{P('M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z')}{C(12, 10, 3)}</>,
  message: <>{P('M7.9 20A9 9 0 1 0 4 16.1L2 22z')}</>,
  // ----- clinic (services and statistics)
  bed: <>{P('M2 20V5M2 14h20v6M22 14v-3a3 3 0 0 0-3-3h-8v6')}{C(6.5, 10.5, 2)}</>,
  'briefcase-medical': <>{R(2, 7, 20, 14)}{P('M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M12 11v6M9 14h6')}</>,
  'heart-pulse': <>{P('M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7zM3.2 12H9l1-2 2 4 1-2h7.8')}</>,
  activity: <>{P('M22 12h-4l-3 9L9 3l-3 9H2')}</>,
  award: <>{C(12, 8, 6)}{P('M15.5 13.5 17 22l-5-3-5 3 1.5-8.5')}</>,
  accessibility: <>{C(16, 4, 1.5)}{P('m18 19 1-7-6 1M5 8l3-3 5.5 3-2.4 3.5M4.2 14.5a5 5 0 0 0 6.9 6M13.8 17.5a5 5 0 0 0-6.9-6')}</>,
  laptop: <>{R(4, 4, 16, 11)}{P('M2 20h20')}</>,
  apple: <>{P('M12 7c-2-2-6-2-7 2s0 9 3 11c1.5 1 2.5 0 4 0s2.5 1 4 0c3-2 4-8 3-11s-5-4-7-2zM12 7c0-2 1-4 3-5')}</>,
  // ----- social (simplified marks, used only for links to the clinic's pages)
  facebook: <>{P('M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z')}</>,
  instagram: <>{R(2, 2, 20, 20, 5)}{C(12, 12, 4)}{P('M17.5 6.5h.01')}</>,
  tiktok: <>{P('M16 3c.4 2.3 1.8 3.7 4 4v3.2a8 8 0 0 1-4-1.2V15a6 6 0 1 1-6-6v3.3a2.7 2.7 0 1 0 2.7 2.7V3z')}</>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

const DIRECTIONAL = new Set<IconName>(['chevron-right', 'chevron-left', 'arrow-right', 'arrow-left', 'undo', 'log-out', 'log-in']);

export function Icon({ name, size, className, label, style }: {
  name: IconName; size?: number; className?: string; label?: string; style?: CSSProperties;
}) {
  const classes = ['icon', DIRECTIONAL.has(name) && 'icon-directional', className].filter(Boolean).join(' ');
  return (
    <svg
      className={classes} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={size ? { ...style, ['--icon-size' as string]: `${size}px` } : style}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
