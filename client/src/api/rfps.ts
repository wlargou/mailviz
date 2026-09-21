import { api } from './client';
import type { ApiResponse } from '../types/api';
import type { CreateRfpInput, Rfp, RfpDocument, RfpDocumentKind, UpdateRfpInput } from '../types/rfp';

export const rfpsApi = {
  getAll(params?: Record<string, string>) {
    return api.get<ApiResponse<Rfp[]>>('/rfps', { params });
  },

  getById(id: string) {
    return api.get<ApiResponse<Rfp>>(`/rfps/${id}`);
  },

  create(data: CreateRfpInput) {
    return api.post<ApiResponse<Rfp>>('/rfps', data);
  },

  update(id: string, data: UpdateRfpInput) {
    return api.patch<ApiResponse<Rfp>>(`/rfps/${id}`, data);
  },

  delete(id: string) {
    return api.delete(`/rfps/${id}`);
  },

  uploadDocument(rfpId: string, file: File, kind: RfpDocumentKind) {
    const form = new FormData();
    // `kind` before `file`: multer parses the stream in order, and a text
    // field after the file part is not on `req.body` by the time the
    // controller reads it.
    form.append('kind', kind);
    form.append('file', file);
    // The shared client sets `Content-Type: application/json` for every
    // request. On a FormData body that is fatal and silent: the boundary is
    // never generated, multer parses no file, and the upload comes back 400
    // NO_FILE. Undefined here lets the browser write the multipart header
    // with its boundary.
    return api.post<ApiResponse<RfpDocument>>(`/rfps/${rfpId}/documents`, form, {
      headers: { 'Content-Type': undefined },
    });
  },

  deleteDocument(rfpId: string, documentId: string) {
    return api.delete(`/rfps/${rfpId}/documents/${documentId}`);
  },

  /** Served by the API with the session cookie; used as an href. */
  documentUrl(rfpId: string, documentId: string) {
    return `/api/v1/rfps/${rfpId}/documents/${documentId}`;
  },
};
