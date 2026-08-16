import { api } from './client';
import type { ApiResponse } from '../types/api';
import type { DraftDetail, DraftListItem, DraftSaveInput, DraftSummary } from '../types/email';

/**
 * Gmail drafts. Every one of these hits Gmail on the server side except
 * `list`, which reads the local mirror — so listing is cheap and saving is not.
 * That asymmetry is why the compose window saves on an explicit action rather
 * than on a timer.
 */
export const draftsApi = {
  list() {
    return api.get<ApiResponse<DraftListItem[]>>('/emails/drafts');
  },

  sync() {
    return api.post<ApiResponse<{ synced: number; removed: number }>>('/emails/drafts/sync');
  },

  /** Load a draft back into the compose window, attachment bytes included. */
  open(id: string) {
    return api.get<ApiResponse<DraftDetail>>(`/emails/drafts/${id}`);
  },

  create(data: DraftSaveInput) {
    return api.post<ApiResponse<DraftSummary>>('/emails/drafts', data);
  },

  update(id: string, data: DraftSaveInput) {
    return api.put<ApiResponse<DraftSummary>>(`/emails/drafts/${id}`, data);
  },

  /** Sends via Gmail's drafts.send, which consumes the draft atomically. */
  send(id: string, data: DraftSaveInput) {
    return api.post<ApiResponse<{ messageId: string | null; threadId: string | null }>>(
      `/emails/drafts/${id}/send`,
      data
    );
  },

  remove(id: string) {
    return api.delete(`/emails/drafts/${id}`);
  },
};
