/**
 * Event color system — maps Google Calendar colorId (1–11) to Carbon palette colors.
 * Each color provides shades for different calendar view contexts:
 *   - dot:    vivid color for month-view dots and accents
 *   - bg:     muted dark shade for week/day-view block backgrounds
 *   - accent: slightly brighter for left-border stripe
 *   - text:   light readable text on the bg
 *   - hover:  slightly lighter bg for hover state
 */

import {
  teal40, teal50, teal70, teal80, teal10, teal20,
  purple40, purple50, purple70, purple80, purple10,
  green40, green50, green70, green80, green10,
  red40, red50, red70, red80, red10,
  blue40, blue50, blue70, blue80, blue10,
  cyan40, cyan50, cyan70, cyan80, cyan10,
  magenta40, magenta50, magenta70, magenta80, magenta10,
  gray50, gray60, gray70, gray80, gray10,
  yellow10, yellow30, yellow40, yellow70, yellow80,
  orange10, orange40, orange50, orange80, orange90,
} from '@carbon/colors';

export interface EventColor {
  dot: string;      // vivid — month view dot, today indicator
  bg: string;       // dark muted — week/day block background
  accent: string;   // medium — left stripe on blocks
  text: string;     // light — text on bg
  textSub: string;  // slightly dimmed text for location/time
  hover: string;    // lighter bg on hover
}

/**
 * Google Calendar colorId mapping (1–11) + default.
 * Colors chosen for contrast on g100 dark theme.
 */
const EVENT_COLORS: Record<string, EventColor> = {
  // 1 - Lavender
  '1': { dot: purple40, bg: purple80, accent: purple50, text: purple10, textSub: purple40, hover: purple70 },
  // 2 - Sage
  '2': { dot: green40, bg: green80, accent: green50, text: green10, textSub: green40, hover: green70 },
  // 3 - Grape
  '3': { dot: magenta40, bg: magenta80, accent: magenta50, text: magenta10, textSub: magenta40, hover: magenta70 },
  // 4 - Flamingo
  '4': { dot: red40, bg: red80, accent: red50, text: red10, textSub: red40, hover: red70 },
  // 5 - Banana. Yellow's vivid step is 30 rather than 40, so dot/accent use it.
  '5': { dot: yellow30, bg: yellow80, accent: yellow30, text: yellow10, textSub: yellow40, hover: yellow70 },
  // 6 - Tangerine
  '6': { dot: orange40, bg: orange90, accent: orange40, text: orange10, textSub: orange50, hover: orange80 },
  // 7 - Peacock (default calendar)
  '7': { dot: teal40, bg: teal80, accent: teal50, text: teal10, textSub: teal40, hover: teal70 },
  // 8 - Graphite
  '8': { dot: gray50, bg: gray80, accent: gray60, text: gray10, textSub: gray50, hover: gray70 },
  // 9 - Blueberry
  '9': { dot: blue40, bg: blue80, accent: blue50, text: blue10, textSub: blue40, hover: blue70 },
  // 10 - Basil
  '10': { dot: green50, bg: green80, accent: green40, text: green10, textSub: green50, hover: green70 },
  // 11 - Tomato
  '11': { dot: red50, bg: red80, accent: red40, text: red10, textSub: red50, hover: red70 },
};

/** Default color when no colorId is set — teal (Peacock) */
const DEFAULT_COLOR: EventColor = {
  dot: teal50,
  bg: teal80,
  accent: teal50,
  text: teal10,
  textSub: teal20,
  hover: teal70,
};

/**
 * Get the color set for a calendar event.
 * Falls back to teal if colorId is null/undefined or not in the map.
 */
export function getEventColor(colorId: string | null | undefined): EventColor {
  if (colorId && EVENT_COLORS[colorId]) {
    return EVENT_COLORS[colorId];
  }
  return DEFAULT_COLOR;
}
