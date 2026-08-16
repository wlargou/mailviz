/**
 * Reusable message bodies.
 *
 * A `template` is a whole message — it carries a subject as well as a body.
 * A `snippet` is a fragment (a closing line, a booking link) with no subject of
 * its own; the server forces `subject` to null for those.
 */
export type TemplateKind = 'template' | 'snippet';

export interface EmailTemplate {
  id: string;
  name: string;
  kind: TemplateKind;
  subject: string | null;
  body: string;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSaveInput {
  name: string;
  kind: TemplateKind;
  subject?: string | null;
  body: string;
}

/** One `{{placeholder}}` the server knows how to fill, with where its value comes from. */
export interface TemplateVariable {
  name: string;
  label: string;
  source: string;
}

/** What compose knows about the person being written to. */
export interface TemplateRenderContext {
  recipientEmail?: string;
  recipientName?: string;
}

export interface RenderedTemplate {
  id: string;
  name: string;
  kind: TemplateKind;
  subject: string | null;
  body: string;
  /**
   * Placeholders that could NOT be filled for this recipient. They are still
   * present verbatim in `body`/`subject`; compose refuses to send while any of
   * them survive, which is what stops "Hi {{firstName}}," reaching a customer.
   */
  missing: string[];
  variables: Record<string, string | undefined>;
}
