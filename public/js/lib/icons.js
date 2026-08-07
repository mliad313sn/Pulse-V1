"use strict";
// PULSE icon set.
//
// One stroked, 24-grid, currentColor icon family — replacing the glyph
// characters (▦ ⚑ ◷ ✎ ⬇ …) the UI used to lean on. Glyphs render differently
// on every platform, cannot be sized or aligned reliably, and are announced by
// screen readers as whatever Unicode calls them. These are inline SVG: no
// network request, no font file, no CSP exception, and they inherit text
// colour so a button's icon can never drift from its label.
//
// Conventions: 1.6px stroke, round caps and joins, optically balanced at 16px.

const PATHS = {
  // navigation
  grid:      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  layers:    '<path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"/><path d="M3 12.5 12 17l9-4.5"/><path d="M3 17.5 12 22l9-4.5"/>',
  lightbulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8.9.9 1.5l.1.7h5.2l.1-.7c.1-.6.4-1.1.9-1.5A6 6 0 0 0 12 3Z"/>',
  presentation: '<path d="M2 4h20"/><path d="M3 4v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V4"/><path d="m9 21 3-5 3 5"/>',
  pin:       '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  checkSquare: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',
  flag:      '<path d="M4 21V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
  clock:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gauge:     '<path d="M12 21a9 9 0 1 1 9-9"/><path d="m12 12 5-3"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  diamond:   '<path d="m12 2 10 10-10 10L2 12 12 2Z"/>',
  chart:     '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',

  // actions
  pencil:    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
  download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  plus:      '<path d="M12 5v14"/><path d="M5 12h14"/>',
  search:    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell:      '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  broadcast: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/><path d="M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  stop:      '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  sparkle:   '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m6.3 6.3 2.9 2.9"/><path d="m14.8 14.8 2.9 2.9"/><path d="m17.7 6.3-2.9 2.9"/><path d="m9.2 14.8-2.9 2.9"/>',
  beaker:    '<path d="M9 3v6.5L4.2 18A2 2 0 0 0 6 21h12a2 2 0 0 0 1.8-3L15 9.5V3"/><path d="M8 3h8"/><path d="M6.5 15h11"/>',
  printer:   '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 17h12v4H6z"/>',
  copy:      '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  list:      '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  gantt:     '<path d="M3 5h8"/><path d="M7 10h10"/><path d="M5 15h7"/><path d="M10 20h9"/>',
  board:     '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="8" rx="1"/>',
  refresh:   '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  link:      '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  arrowRight:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevronLeft:'<path d="m15 18-6-6 6-6"/>',
  close:     '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  check:     '<path d="M20 6 9 17l-5-5"/>',
  alert:     '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  info:      '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  lock:      '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
  users:     '<path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="9" cy="7" r="3.5"/><path d="M22 20v-1.5a4 4 0 0 0-3-3.9"/><path d="M16 3.6a4 4 0 0 1 0 7"/>',
  swap:      '<path d="M7 4v13"/><path d="m4 14 3 3 3-3"/><path d="M17 20V7"/><path d="m14 10 3-3 3 3"/>',
};

// aria-hidden by default: an icon beside a label is decoration, and a
// screen reader announcing "grid" before "Portfolio" is noise. Pass a label
// only when the icon carries the meaning on its own.
export function icon(name, { size = 16, label = null, className = "" } = {}) {
  const d = PATHS[name];
  if (!d) return "";
  const a11y = label
    ? `role="img" aria-label="${String(label).replace(/"/g, "&quot;")}"`
    : 'aria-hidden="true" focusable="false"';
  return `<svg class="ic ${className}" width="${size}" height="${size}" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
    stroke-linejoin="round" ${a11y}>${d}</svg>`;
}

export const ICON_NAMES = Object.keys(PATHS);
