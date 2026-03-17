import { create } from 'zustand';
import { calendarApi } from '../api/calendar';
import { authApi } from '../api/auth';
import type { CalendarEvent, CalendarViewMode, GoogleStatus } from '../types/calendar';
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

interface CalendarState {
  events: CalendarEvent[];
  loading: boolean;
  syncing: boolean;
  viewMode: CalendarViewMode;
  currentDate: Date;
  googleStatus: GoogleStatus | null;

  fetchEvents: () => Promise<void>;
  syncEvents: () => Promise<{ synced: number }>;
  setViewMode: (mode: CalendarViewMode) => void;
  navigate: (direction: 'prev' | 'next' | 'today') => void;
  fetchGoogleStatus: () => Promise<void>;
}

function getDateRange(date: Date, mode: CalendarViewMode) {
  if (mode === 'month') {
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    return {
      start: startOfWeek(monthStart, { weekStartsOn: 0 }).toISOString(),
      end: endOfWeek(monthEnd, { weekStartsOn: 0 }).toISOString(),
    };
  }
  if (mode === 'day') {
    return {
      start: startOfDay(date).toISOString(),
      end: endOfDay(date).toISOString(),
    };
  }
  return {
    start: startOfWeek(date, { weekStartsOn: 0 }).toISOString(),
    end: endOfWeek(date, { weekStartsOn: 0 }).toISOString(),
  };
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  events: [],
  loading: false,
  syncing: false,
  viewMode: 'month',
  currentDate: new Date(),
  googleStatus: null,

  fetchEvents: async () => {
    const { currentDate, viewMode } = get();
    const { start, end } = getDateRange(currentDate, viewMode);
    set({ loading: true });
    try {
      const { data: response } = await calendarApi.getAll(start, end);
      set({ events: response.data });
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      set({ loading: false });
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

  fetchGoogleStatus: async () => {
    try {
      const { data: response } = await authApi.getGoogleStatus();
      set({ googleStatus: response.data });
    } catch {
      set({ googleStatus: { connected: false } });
    }
  },
}));
