import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { auditService } from './auditService.js';
import { extractDomain, normalizeDomain } from '../utils/domainResolver.js';
import type {
  CreateTemplateInput,
  RenderTemplateInput,
  UpdateTemplateInput,
} from '../validators/templateValidator.js';

/**
 * Reusable message bodies for compose.
 *
 * Two decisions are worth stating up front, because both were chosen against
 * the more obvious alternative:
 *
 * 1. **The variable catalogue is closed.** `{{…}}` names are validated against
 *    TEMPLATE_VARIABLES on every write, so saving a template containing
 *    `{{firstNmae}}` — or `{{company_size}}`, which this app has no idea about
 *    — is a 400. The failure mode a free-form placeholder syntax produces is a
 *    sent email that reads "Hi {{firstNmae}}", and that is worse than having no
 *    substitution at all.
 *
 * 2. **Rendering happens here, not in the browser.** Half the values come from
 *    the database (the recipient's Contact row, their company, the sender's own
 *    name), so the client cannot fill them anyway; putting the whole of it
 *    server-side keeps one implementation and lets `missing` — the names that
 *    could NOT be filled — come back as data the compose window can act on.
 */

interface TemplateVariable {
  /** The placeholder name, used as `{{name}}`. */
  name: string;
  label: string;
  /** Where the value comes from — shown in Settings so the list isn't magic. */
  source: string;
}

/**
 * Every placeholder the app can actually fill.
 *
 * Each entry is backed by something compose or the database genuinely knows.
 * Nothing aspirational belongs here: an unfillable variable is exactly the bug
 * this list exists to prevent.
 */
export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { name: 'firstName', label: 'Recipient first name', source: 'Their contact record, or the display name on the message you are replying to' },
  { name: 'lastName', label: 'Recipient last name', source: 'Their contact record, or the display name on the message you are replying to' },
  { name: 'fullName', label: 'Recipient full name', source: 'Their contact record, or the display name on the message you are replying to' },
  { name: 'email', label: 'Recipient email address', source: 'The first address in the To field' },
  { name: 'company', label: 'Recipient company', source: 'The company their contact record belongs to, or the one matching their email domain' },
  { name: 'myName', label: 'Your name', source: 'Your account name' },
  { name: 'myEmail', label: 'Your email address', source: 'Your account email' },
  { name: 'today', label: "Today's date", source: 'The date the template is inserted' },
] as const;

const KNOWN_VARIABLE_NAMES = new Set(TEMPLATE_VARIABLES.map((v) => v.name));

/**
 * Matches `{{name}}` with optional inner whitespace.
 *
 * Deliberately anchored to `[A-Za-z][A-Za-z0-9]*` — a placeholder is a bare
 * identifier, never an expression. Anything more expressive is a template
 * language, and a template language in an email body is a code path nobody
 * wants to have to reason about.
 */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/** Values escaped before going into an HTML body — a contact called "A & B" must not break the markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Every distinct placeholder name used in a string. */
export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    found.add(match[1]);
  }
  return [...found];
}

/**
 * Substitute the values we have and report the ones we do not.
 *
 * An unfillable placeholder is left in the text verbatim rather than blanked.
 * Blanking it produces "Hi ," — grammatical damage the user cannot see the
 * cause of; leaving `{{firstName}}` there is at least self-describing, and the
 * returned `missing` list is what compose uses to block the send.
 */
export function applyVariables(
  text: string,
  values: Record<string, string | undefined>,
  { escape }: { escape: boolean }
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const rendered = text.replace(PLACEHOLDER_PATTERN, (whole, name: string) => {
    const value = values[name];
    if (value === undefined || value === '') {
      missing.add(name);
      return whole;
    }
    return escape ? escapeHtml(value) : value;
  });
  return { text: rendered, missing: [...missing] };
}

/** Split a display name ("Jane Doe", "Doe, Jane") into first/last. */
function splitDisplayName(displayName: string): { firstName?: string; lastName?: string } {
  const cleaned = displayName.replace(/^["'\s]+|["'\s]+$/g, '');
  if (!cleaned || cleaned.includes('@')) return {};

  // "Doe, Jane" — the comma form is common in corporate directories.
  const comma = cleaned.indexOf(',');
  if (comma > 0) {
    const last = cleaned.slice(0, comma).trim();
    const first = cleaned.slice(comma + 1).trim();
    if (first && last) return { firstName: first, lastName: last };
  }

  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

interface TemplateQueryParams {
  kind?: string;
  search?: string;
}

export const templateService = {
  TEMPLATE_VARIABLES,

  async findAll(userId: string, query: TemplateQueryParams = {}) {
    // Ownership lives under AND so the search branch's `where.OR` below cannot
    // overwrite it. Two cross-tenant leaks in this codebase were exactly that.
    const where: Prisma.EmailTemplateWhereInput = { AND: [{ userId }] };

    if (query.kind === 'template' || query.kind === 'snippet') {
      where.kind = query.kind;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { subject: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    // Most-used first: the point of the feature is the handful of replies the
    // user sends constantly, and alphabetical order buries them.
    return prisma.emailTemplate.findMany({
      where,
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
    });
  },

  async findById(userId: string, id: string) {
    const template = await prisma.emailTemplate.findFirst({ where: { AND: [{ id }, { userId }] } });
    if (!template) {
      throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
    }
    return template;
  },

  async create(userId: string, data: CreateTemplateInput) {
    const subject = normaliseSubject(data.kind, data.subject);
    assertKnownPlaceholders(data.body, subject);

    const existing = await prisma.emailTemplate.findUnique({
      where: { userId_name: { userId, name: data.name } },
    });
    if (existing) {
      throw new AppError(409, 'TEMPLATE_EXISTS', `A template named "${data.name}" already exists`);
    }

    const template = await prisma.emailTemplate.create({
      data: { userId, name: data.name, kind: data.kind, subject, body: data.body },
    });
    auditService.log({
      userId,
      action: 'TEMPLATE_CREATED',
      entityType: 'email_template',
      entityId: template.id,
      details: { name: template.name, kind: template.kind },
    });
    return template;
  },

  async update(userId: string, id: string, data: UpdateTemplateInput) {
    const template = await this.findById(userId, id);

    const kind = data.kind ?? (template.kind as 'template' | 'snippet');
    const subject = normaliseSubject(
      kind,
      data.subject !== undefined ? data.subject : template.subject
    );
    const body = data.body ?? template.body;
    assertKnownPlaceholders(body, subject);

    if (data.name && data.name !== template.name) {
      const clash = await prisma.emailTemplate.findUnique({
        where: { userId_name: { userId, name: data.name } },
      });
      if (clash) {
        throw new AppError(409, 'TEMPLATE_EXISTS', `A template named "${data.name}" already exists`);
      }
    }

    // Scoped by userId as well as id: `update` on the primary key alone would
    // happily write another tenant's row if the ownership check above ever
    // regressed. updateMany is the only Prisma write that takes a filter.
    const updated = await prisma.emailTemplate.updateMany({
      where: { AND: [{ id }, { userId }] },
      data: { name: data.name ?? template.name, kind, subject, body },
    });
    if (updated.count === 0) {
      throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
    }

    auditService.log({
      userId,
      action: 'TEMPLATE_UPDATED',
      entityType: 'email_template',
      entityId: id,
      details: { name: data.name ?? template.name, previousName: template.name, kind },
    });
    return this.findById(userId, id);
  },

  async delete(userId: string, id: string) {
    const template = await this.findById(userId, id);
    await prisma.emailTemplate.deleteMany({ where: { AND: [{ id }, { userId }] } });
    // The body is gone for good and lives nowhere else, so the audit row keeps
    // enough to tell the user what they destroyed.
    auditService.log({
      userId,
      action: 'TEMPLATE_DELETED',
      entityType: 'email_template',
      entityId: id,
      details: { name: template.name, kind: template.kind, usageCount: template.usageCount },
    });
    return template;
  },

  /**
   * Resolve every variable this app can fill for a given recipient.
   *
   * Lookup order for the recipient's name is deliberate: a Contact row is
   * curated data and beats the display name scraped off a mail header, which is
   * whatever the sender happened to configure.
   */
  async resolveVariables(userId: string, context: RenderTemplateInput) {
    const recipientEmail = context.recipientEmail?.trim().toLowerCase() || undefined;

    const [user, contact] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
      recipientEmail
        ? prisma.contact.findFirst({
            // Contacts are user-scoped through their customer — there is no
            // user_id on the contact itself.
            where: {
              AND: [
                { customer: { userId } },
                {
                  OR: [
                    { email: { equals: recipientEmail, mode: 'insensitive' } },
                    { emailAliases: { some: { email: { equals: recipientEmail, mode: 'insensitive' } } } },
                  ],
                },
              ],
            },
            select: { firstName: true, lastName: true, customer: { select: { name: true } } },
          })
        : Promise.resolve(null),
    ]);

    const hinted = context.recipientName ? splitDisplayName(context.recipientName) : {};
    const firstName = contact?.firstName || hinted.firstName;
    const lastName = contact?.lastName || hinted.lastName;

    let company = contact?.customer?.name;
    if (!company && recipientEmail) {
      const domain = extractDomain(recipientEmail);
      if (domain) {
        const customer = await prisma.customer.findFirst({
          where: { AND: [{ userId }, { domain: { in: [domain, normalizeDomain(domain)] } }] },
          select: { name: true },
        });
        company = customer?.name;
      }
    }

    const fullName = [firstName, lastName].filter(Boolean).join(' ') || undefined;

    return {
      firstName,
      lastName,
      fullName,
      email: recipientEmail,
      company,
      myName: user?.name ?? undefined,
      myEmail: user?.email,
      today: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    } satisfies Record<string, string | undefined>;
  },

  /**
   * Produce the subject and body to drop into compose.
   *
   * Also bumps the usage counters, because "render" is the only moment we know
   * a template was actually reached for — listing it proves nothing.
   */
  async render(userId: string, id: string, context: RenderTemplateInput) {
    const template = await this.findById(userId, id);
    const values = await this.resolveVariables(userId, context);

    // The body is HTML and its values are escaped; the subject is a plain-text
    // header and must not be, or a recipient called "Ben & Co" reads
    // "Ben &amp; Co" in their inbox.
    const body = applyVariables(template.body, values, { escape: true });
    const subject = template.subject
      ? applyVariables(template.subject, values, { escape: false })
      : { text: '', missing: [] as string[] };

    await prisma.emailTemplate.updateMany({
      where: { AND: [{ id }, { userId }] },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });

    return {
      id: template.id,
      name: template.name,
      kind: template.kind,
      subject: template.subject ? subject.text : null,
      body: body.text,
      /** Placeholders that could not be filled — compose refuses to send while any remain. */
      missing: [...new Set([...body.missing, ...subject.missing])],
      variables: values,
    };
  },
};

/** Snippets have no subject of their own; a template with a blank one stores null. */
function normaliseSubject(kind: 'template' | 'snippet', subject: string | null | undefined): string | null {
  if (kind === 'snippet') return null;
  const trimmed = subject?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Reject placeholders the app cannot fill, at write time.
 *
 * This is the whole safety story for substitution: if it is in the database it
 * can be rendered, so the only way `{{something}}` survives into a sent message
 * is a variable whose *value* is missing for this particular recipient — which
 * compose catches separately and refuses to send on.
 */
function assertKnownPlaceholders(body: string, subject: string | null): void {
  const used = [...new Set([...extractPlaceholders(body), ...extractPlaceholders(subject ?? '')])];
  const unknown = used.filter((name) => !KNOWN_VARIABLE_NAMES.has(name));
  if (unknown.length > 0) {
    throw new AppError(
      400,
      'UNKNOWN_TEMPLATE_VARIABLE',
      `Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.map((n) => `{{${n}}}`).join(', ')}`,
      { unknown, allowed: TEMPLATE_VARIABLES.map((v) => v.name) }
    );
  }
}
