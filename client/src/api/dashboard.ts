import { api } from './client';
import type { DashboardStats } from '../types/dashboard';
import type { ApiResponse } from '../types/api';

export const dashboardApi = {
  getStats() {
    return api.get<ApiResponse<DashboardStats>>('/dashboard/stats');
  },
};
