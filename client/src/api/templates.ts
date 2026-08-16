import { api } from './client';
import type { ApiResponse } from '../types/api';
import type {
  EmailTemplate,
  RenderedTemplate,
  TemplateKind,
  TemplateRenderContext,
  TemplateSaveInput,
  TemplateVariable,
} from '../types/template';

export const templatesApi = {
  getAll(params: { kind?: TemplateKind; search?: string } = {}) {
    return api.get<ApiResponse<EmailTemplate[]>>('/templates', { params });
  },

  /** The catalogue of `{{placeholders}}` the server can fill, for the Settings help. */
  getVariables() {
    return api.get<ApiResponse<TemplateVariable[]>>('/templates/variables');
  },

  create(data: TemplateSaveInput) {
    return api.post<ApiResponse<EmailTemplate>>('/templates', data);
  },

  update(id: string, data: Partial<TemplateSaveInput>) {
    return api.patch<ApiResponse<EmailTemplate>>(`/templates/${id}`, data);
  },

  remove(id: string) {
    return api.delete(`/templates/${id}`);
  },

  /**
   * Substitute variables for a given recipient and bump the template's usage
   * count. Substitution lives on the server because most of the values are
   * database lookups (the recipient's contact record, their company).
   */
  render(id: string, context: TemplateRenderContext = {}) {
    return api.post<ApiResponse<RenderedTemplate>>(`/templates/${id}/render`, context);
  },
};
