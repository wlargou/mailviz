import { api } from './client';
import type { EmailThread, EmailMessage, ConvertToTaskInput } from '../types/email';
import type { ApiResponse } from '../types/api';
import type { Task } from '../types/task';

export const emailsApi = {
  getThreads(params?: Record<string, string>) {
    return api.get<ApiResponse<EmailThread[]>>('/emails', { params });
  },

  getThread(threadId: string) {
    return api.get<ApiResponse<EmailMessage[]>>(`/emails/threads/${threadId}`);
  },

  getMessage(id: string) {
    return api.get<ApiResponse<EmailMessage>>(`/emails/${id}`);
  },

  getAttachmentUrl(emailId: string, attachmentId: string) {
    return `/api/v1/emails/${emailId}/attachments/${attachmentId}`;
  },

  getAttachmentInlineUrl(emailId: string, attachmentId: string) {
    return `/api/v1/emails/${emailId}/attachments/${attachmentId}?inline=true`;
  },

  sync() {
    return api.post<ApiResponse<{ synced: number; customersCreated: number; contactsCreated: number }>>('/emails/sync');
  },

  markAsRead(id: string) {
    return api.patch(`/emails/${id}/read`);
  },

  markAsUnread(id: string) {
    return api.patch(`/emails/${id}/unread`);
  },

  toggleStar(id: string) {
    return api.patch<ApiResponse<{ isStarred: boolean }>>(`/emails/${id}/star`);
  },

  archive(id: string) {
    return api.patch(`/emails/${id}/archive`);
  },

  unarchive(id: string) {
    return api.patch(`/emails/${id}/unarchive`);
  },

  trash(id: string) {
    return api.patch(`/emails/${id}/trash`);
  },

  untrash(id: string) {
    return api.patch(`/emails/${id}/untrash`);
  },

  convertToTask(id: string, data: ConvertToTaskInput) {
    return api.post<ApiResponse<Task>>(`/emails/${id}/convert-to-task`, data);
  },

  getUnreadCount() {
    return api.get<ApiResponse<{ count: number }>>('/emails/unread-count');
  },

  getSyncStatus() {
    return api.get<ApiResponse<{ syncing: boolean }>>('/emails/sync-status');
  },
};
