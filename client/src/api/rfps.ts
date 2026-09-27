import { api } from './client';
import type { ApiResponse } from '../types/api';
import type {
  CreateRfpInput,
  LotInput,
  Rfp,
  RfpCatalogueEntry,
  RfpDetail,
  RfpDocument,
  RfpDocumentKind,
  RfpFolder,
  RfpFolderKind,
  RfpItem,
  RfpItemStatus,
  RfpItemVerification,
  RfpLot,
  RfpVerificationDecision,
  RfpVerifier,
  UpdateRfpInput,
} from '../types/rfp';

export const rfpsApi = {
  getAll(params?: Record<string, string>) {
    return api.get<ApiResponse<Rfp[]>>('/rfps', { params });
  },

  getById(id: string) {
    return api.get<ApiResponse<RfpDetail>>(`/rfps/${id}`);
  },

  create(data: CreateRfpInput) {
    return api.post<ApiResponse<RfpDetail>>('/rfps', data);
  },

  /** The dossier kinds and the pieces each starts with. */
  getCatalogue() {
    return api.get<ApiResponse<RfpCatalogueEntry[]>>('/rfps/catalogue');
  },

  // ── Lots ──────────────────────────────────────────────────────────────
  createLot(rfpId: string, data: LotInput) {
    return api.post<ApiResponse<RfpLot>>(`/rfps/${rfpId}/lots`, data);
  },
  updateLot(rfpId: string, lotId: string, data: Partial<LotInput>) {
    return api.patch<ApiResponse<RfpLot>>(`/rfps/${rfpId}/lots/${lotId}`, data);
  },
  deleteLot(rfpId: string, lotId: string) {
    return api.delete(`/rfps/${rfpId}/lots/${lotId}`);
  },

  // ── The response's dossiers and pieces ────────────────────────────────
  createFolder(rfpId: string, data: { kind: RfpFolderKind; lotId?: string | null; title?: string; prefill?: boolean }) {
    return api.post<ApiResponse<RfpFolder>>(`/rfps/${rfpId}/folders`, data);
  },
  deleteFolder(rfpId: string, folderId: string) {
    return api.delete(`/rfps/${rfpId}/folders/${folderId}`);
  },
  createItem(rfpId: string, folderId: string, title: string) {
    return api.post<ApiResponse<RfpItem>>(`/rfps/${rfpId}/folders/${folderId}/items`, { title });
  },
  updateItem(rfpId: string, itemId: string, data: { title?: string; status?: RfpItemStatus; notes?: string | null }) {
    return api.patch<ApiResponse<RfpItem>>(`/rfps/${rfpId}/items/${itemId}`, data);
  },
  deleteItem(rfpId: string, itemId: string) {
    return api.delete(`/rfps/${rfpId}/items/${itemId}`);
  },
  // ── Verification ──────────────────────────────────────────────────────
  /** The whole list — anyone left out stops being a verifier. Owner only. */
  setVerifiers(rfpId: string, userIds: string[]) {
    return api.put<ApiResponse<RfpVerifier[]>>(`/rfps/${rfpId}/verifiers`, { userIds });
  },
  /** The caller's decision on the piece's current version. */
  decide(rfpId: string, itemId: string, data: { decision: RfpVerificationDecision; comment?: string | null }) {
    return api.put<ApiResponse<RfpItemVerification>>(`/rfps/${rfpId}/items/${itemId}/verification`, data);
  },
  withdrawDecision(rfpId: string, itemId: string) {
    return api.delete(`/rfps/${rfpId}/items/${itemId}/verification`);
  },

  /** A new version of the piece. */
  uploadItemDocument(rfpId: string, itemId: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    // Multipart, not the client's JSON default — see `uploadDocument`.
    return api.post<ApiResponse<RfpDocument>>(`/rfps/${rfpId}/items/${itemId}/documents`, form, {
      headers: { 'Content-Type': undefined },
    });
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

  shareRfp(id: string, userIds: string[]) {
    return api.post(`/rfps/${id}/share`, { userIds });
  },

  unshareRfp(id: string, recipientId: string) {
    return api.delete(`/rfps/${id}/shares/${recipientId}`);
  },

  getRfpShares(id: string) {
    return api.get<{ data: Array<{ id: string; createdAt: string; sharedWith: { id: string; name: string | null; email: string; avatarUrl: string | null } }> }>(`/rfps/${id}/shares`);
  },

  /** Served by the API with the session cookie; used as an href. */
  documentUrl(rfpId: string, documentId: string) {
    return `/api/v1/rfps/${rfpId}/documents/${documentId}`;
  },

  /** The same bytes with `Content-Disposition: inline`, for the preview. */
  documentInlineUrl(rfpId: string, documentId: string) {
    return `/api/v1/rfps/${rfpId}/documents/${documentId}?inline=true`;
  },
};
