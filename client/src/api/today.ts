import { api } from './client';
import type { Today } from '../types/today';

export const todayApi = {
  get() {
    return api.get<{ data: Today }>('/today');
  },
};
