import { create } from 'zustand';
import { calendarApi } from '../api/calendar';
import { authApi } from '../api/auth';
import type { CalendarDeadline, CalendarEvent, CalendarLayers, CalendarViewMode, GoogleStatus } from '../types/calendar';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
} from 'date-fns';
import { WEEK_STARTS_ON } from '../utils/week';

const LAYERS_KEY = 'mailviz.calendar.layers';
const ALL_LAYERS: CalendarLayers = { meetings: true, deadlines: true, tasks: true };

/** Remembered per browser — a viewing preference, not data. */
function loadLayers(): CalendarLayers {
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    return raw ? { ...ALL_LAYERS, ...(JSON.parse(raw) as Partial<CalendarLayers>) } : ALL_LAYERS;
  } catch {
    return ALL_LAYERS;
  }
}

interface CalendarState {
  events: CalendarEvent[];
  /** Tender deadlines, question cut-offs, pieces and tasks due in the range. */
  deadlines: CalendarDeadline[];
  layers: CalendarLayers;
  toggleLayer: (layer: keyof CalendarLayers) => void;
  loading: boolean;
  syncing: boolean;
  viewMode: CalendarViewMode;
  currentDate: Date;
  googleStatus: GoogleStatus | null;

  fetchEvents: (silent?: boolean) => Promise<void>;
  syncEvents: () => Promise<{ synced: number }>;
  setViewMode: (mode: CalendarViewMode) => void;
  navigate: (direction: 'prev' | 'next' | 'today') => void;
  goToDay: (date: Date) => void;
  fetchGoogleStatus: () => Promise<void>;
}

function getDateRange(date: Date, mode: CalendarViewMode) {
  if (mode === 'month') {
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    return {
      start: startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON }).toISOString(),
      end: endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON }).toISOString(),
    };
  }
  if (mode === 'day') {
    return {
      start: startOfDay(date).toISOString(),
      end: endOfDay(date).toISOString(),
    };
  }
  return {
    start: startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }).toISOString(),
    end: endOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }).toISOString(),
  };
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  events: [],
  deadlines: [],
  layers: loadLayers(),
  loading: false,
  syncing: false,
  // A week, not a month: in a month every title is cut to a dozen letters.
  viewMode: 'week',

  toggleLayer: (layer) => {
    const layers = { ...get().layers, [layer]: !get().layers[layer] };
    set({ layers });
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
    } catch {
      /* private window — the choice lasts for this page */
    }
  },
  currentDate: new Date(),
  googleStatus: null,

  fetchEvents: async (silent = false) => {
    const { currentDate, viewMode } = get();
    const { start, end } = getDateRange(currentDate, viewMode);
    if (!silent) set({ loading: true });
    // Deadlines alongside, and never in the way: if they fail, the meetings
    // still show.
    calendarApi
      .getDeadlines(start, end)
      .then(({ data: res }) => set({ deadlines: res.data }))
      .catch(() => set({ deadlines: [] }));
    try {
      const { data: response } = await calendarApi.getAll(start, end);
      set({ events: response.data });
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      if (!silent) set({ loading: false });
    }
  },

  syncEvents: async () => {
    set({ syncing: true });
    try {
      const { data: response } = await calendarApi.sync();
      await get().fetchEvents();
      return response.data;
    } finally {
      set({ syncing: false });
    }
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
    get().fetchEvents();
  },

  navigate: (direction) => {
    const { currentDate, viewMode } = get();
    let newDate: Date;

    if (direction === 'today') {
      newDate = new Date();
    } else if (viewMode === 'month') {
      newDate = direction === 'prev' ? subMonths(currentDate, 1) : addMonths(currentDate, 1);
    } else if (viewMode === 'week') {
      newDate = direction === 'prev' ? subWeeks(currentDate, 1) : addWeeks(currentDate, 1);
    } else {
      newDate = direction === 'prev' ? subDays(currentDate, 1) : addDays(currentDate, 1);
    }

    set({ currentDate: newDate });
    get().fetchEvents();
  },

  goToDay: (date) => {
    set({ currentDate: date, viewMode: 'day' });
    get().fetchEvents();
  },

  fetchGoogleStatus: async () => {
    try {
      const { data: response } = await authApi.getGoogleStatus();
      set({ googleStatus: response.data });
    } catch {
      set({ googleStatus: { connected: false } });
    }
  },
}));

/** The meetings the layers let through. */
export function visibleEvents(state: Pick<CalendarState, 'events' | 'layers'>): CalendarEvent[] {
  return state.layers.meetings ? state.events : [];
}

/** Tender dates under Deadlines; tasks and pieces under Tasks. */
export function visibleDeadlines(state: Pick<CalendarState, 'deadlines' | 'layers'>): CalendarDeadline[] {
  return state.deadlines.filter((d) =>
    d.kind === 'RFP_DEADLINE' || d.kind === 'RFP_QUESTIONS' ? state.layers.deadlines : state.layers.tasks,
  );
}
