import { api } from './client';
import type { ApiResponse } from '../types/api';
import type { ClientReference, ClientReferenceInput, ReferenceFacets } from '../types/clientReference';

export const clientReferencesApi = {
  getAll(params?: Record<string, string>) {
    return api.get<ApiResponse<ClientReference[]>>('/client-references', { params });
  },

  /** Every id the query matches, in the list's order — for Previous / Next. */
  getIds(params?: Record<string, string>) {
    return api.get<ApiResponse<string[]>>('/client-references/ids', { params });
  },

  getFacets() {
    return api.get<ApiResponse<ReferenceFacets>>('/client-references/facets');
  },

  getById(id: string) {
    return api.get<ApiResponse<ClientReference>>(`/client-references/${id}`);
  },

  create(data: ClientReferenceInput) {
    return api.post<ApiResponse<ClientReference>>('/client-references', data);
  },

  update(id: string, data: ClientReferenceInput) {
    return api.patch<ApiResponse<ClientReference>>(`/client-references/${id}`, data);
  },

  delete(id: string) {
    return api.delete(`/client-references/${id}`);
  },

  /** The document, replacing any before it. */
  uploadDocument(id: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    // Multipart, not the client's JSON default — see `rfpsApi.uploadDocument`.
    return api.put<ApiResponse<ClientReference>>(`/client-references/${id}/document`, form, {
      headers: { 'Content-Type': undefined },
    });
  },

  documentUrl(id: string) {
    return `/api/v1/client-references/${id}/document`;
  },

  /**
   * Inline, for the preview beside the form. `v` busts the frame's cache after
   * a replace; the fragment opens Chrome's viewer at the page's width without
   * its thumbnail pane, which took a third of a half-screen preview.
   */
  documentInlineUrl(id: string, version?: string | null) {
    return `/api/v1/client-references/${id}/document?inline=true${version ? `&v=${encodeURIComponent(version)}` : ''}#navpanes=0&view=FitH`;
  },
};
