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

  batchMarkAsRead(ids: string[]) {
    return api.post('/emails/batch/read', { ids });
  },

  batchMarkAsUnread(ids: string[]) {
    return api.post('/emails/batch/unread', { ids });
  },

  batchArchive(ids: string[]) {
    return api.post('/emails/batch/archive', { ids });
  },

  batchTrash(ids: string[]) {
    return api.post('/emails/batch/trash', { ids });
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

  sendEmail(data: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; htmlBody: string; attachments?: Array<{ filename: string; content: string; contentType: string; size: number }> }) {
    return api.post<ApiResponse<{ messageId: string; threadId: string }>>('/emails/send', data);
  },

  replyToEmail(id: string, data: { htmlBody: string; replyAll?: boolean; cc?: string[]; bcc?: string[]; attachments?: Array<{ filename: string; content: string; contentType: string; size: number }> }) {
    return api.post<ApiResponse<{ messageId: string; threadId: string }>>(`/emails/${id}/reply`, data);
  },

  forwardEmail(id: string, data: { to: string[]; cc?: string[]; bcc?: string[]; htmlBody: string; attachments?: Array<{ filename: string; content: string; contentType: string; size: number }>; forwardExistingAttachments?: string[] }) {
    return api.post<ApiResponse<{ messageId: string; threadId: string }>>(`/emails/${id}/forward`, data);
  },

  // Sharing
  shareThread(threadId: string, userIds: string[]) {
    return api.post(`/emails/threads/${threadId}/share`, { userIds });
  },
  unshareThread(threadId: string, recipientId: string) {
    return api.delete(`/emails/threads/${threadId}/shares/${recipientId}`);
  },
  getThreadShares(threadId: string) {
    return api.get<{ data: Array<{ id: string; createdAt: string; sharedWith: { id: string; name: string | null; email: string; avatarUrl: string | null } }> }>(`/emails/threads/${threadId}/shares`);
  },
};
