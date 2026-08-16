import { describe, it, expect } from 'vitest';
import { templateService, applyVariables, extractPlaceholders } from './templateService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser, createCustomer, createContact } from '../test/factories.js';

/**
 * Email templates and snippets.
 *
 * Two things are being defended here.
 *
 * **Tenant isolation.** Templates are user-scoped like everything else, and
 * every read and write filters on userId under `AND`. The regression case below
 * is the search path, which is where the same bug shipped twice already in this
 * codebase: an ownership filter spread into the where-clause and then erased by
 * `where.OR = [...]`.
 *
 * **Substitution that cannot go out wrong.** A template that sends "Hi
 * {{firstName}}," to a customer is worse than a template with no variables at
 * all, so there are two gates: unknown names are rejected at write time, and a
 * name whose *value* is missing for this recipient comes back in `missing` so
 * compose can refuse to send.
 */

async function createTemplate(
  userId: string,
  overrides: Partial<{ name: string; kind: 'template' | 'snippet'; subject: string | null; body: string }> = {}
) {
  return templateService.create(userId, {
    name: overrides.name ?? `Template ${Math.random().toString(36).slice(2, 8)}`,
    kind: overrides.kind ?? 'template',
    subject: overrides.subject === undefined ? 'Hello' : overrides.subject,
    body: overrides.body ?? '<p>Body</p>',
  });
}

describe('templateService — tenant isolation', () => {
  it('lists only the caller’s own templates', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTemplate(alice.id, { name: 'Alice intro' });
    await createTemplate(bob.id, { name: 'Bob intro' });

    const names = (await templateService.findAll(alice.id)).map((t) => t.name);

    expect(names).toEqual(['Alice intro']);
  });

  it('does not leak another user’s templates when searching — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTemplate(alice.id, { name: 'Alice pricing reply' });
    await createTemplate(bob.id, { name: 'Bob pricing reply' });

    const names = (await templateService.findAll(alice.id, { search: 'pricing' })).map((t) => t.name);

    expect(names).toEqual(['Alice pricing reply']);
  });

  it('cannot read another user’s template by id', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobs = await createTemplate(bob.id, { name: 'Bob only' });

    await expect(templateService.findById(alice.id, bobs.id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TEMPLATE_NOT_FOUND',
    });
  });

  it('cannot update another user’s template', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobs = await createTemplate(bob.id, { name: 'Bob only', body: '<p>Bob body</p>' });

    await expect(
      templateService.update(alice.id, bobs.id, { body: '<p>Hijacked</p>' })
    ).rejects.toMatchObject({ statusCode: 404 });

    const after = await prisma.emailTemplate.findUniqueOrThrow({ where: { id: bobs.id } });
    expect(after.body).toBe('<p>Bob body</p>');
  });

  it('cannot delete another user’s template', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobs = await createTemplate(bob.id, { name: 'Bob only' });

    await expect(templateService.delete(alice.id, bobs.id)).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.emailTemplate.count({ where: { id: bobs.id } })).toBe(1);
  });

  it('cannot render another user’s template', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobs = await createTemplate(bob.id, { name: 'Bob only' });

    await expect(templateService.render(alice.id, bobs.id, {})).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lets two users hold templates of the same name', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTemplate(alice.id, { name: 'Follow-up' });

    // The unique index is (user_id, name). A global unique here would let the
    // first tenant to save "Follow-up" block every other tenant from doing so.
    await expect(createTemplate(bob.id, { name: 'Follow-up' })).resolves.toMatchObject({ name: 'Follow-up' });
  });

  it('rejects a duplicate name for the same user', async () => {
    const user = await createUser();
    await createTemplate(user.id, { name: 'Follow-up' });

    await expect(createTemplate(user.id, { name: 'Follow-up' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'TEMPLATE_EXISTS',
    });
  });
});

describe('templateService — placeholder validation', () => {
  it('rejects a variable the app cannot fill', async () => {
    const user = await createUser();

    await expect(
      createTemplate(user.id, { body: '<p>Hi {{firstNmae}},</p>' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'UNKNOWN_TEMPLATE_VARIABLE' });
  });

  it('rejects an unknown variable in the subject too', async () => {
    const user = await createUser();

    await expect(
      createTemplate(user.id, { subject: 'Quote for {{accountManager}}', body: '<p>Hi</p>' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'UNKNOWN_TEMPLATE_VARIABLE' });
  });

  it('accepts every variable in the published catalogue', async () => {
    const user = await createUser();
    const body = templateService.TEMPLATE_VARIABLES.map((v) => `<p>{{${v.name}}}</p>`).join('');

    await expect(createTemplate(user.id, { body })).resolves.toBeTruthy();
  });

  it('rejects an unknown variable introduced by an update', async () => {
    const user = await createUser();
    const template = await createTemplate(user.id, { body: '<p>Hi {{firstName}},</p>' });

    await expect(
      templateService.update(user.id, template.id, { body: '<p>Hi {{nickname}},</p>' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'UNKNOWN_TEMPLATE_VARIABLE' });
  });
});

describe('templateService.render — variable substitution', () => {
  it('fills the recipient from their contact record', async () => {
    const user = await createUser({ name: 'Alice Owner', email: 'alice@mailviz.test' });
    const customer = await createCustomer(user.id, { name: 'Acme Corp', domain: 'acme.test' });
    await createContact(customer.id, { firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.test' });

    const template = await createTemplate(user.id, {
      subject: 'Following up, {{firstName}}',
      body: '<p>Hi {{firstName}} {{lastName}} at {{company}},</p><p>— {{myName}} ({{myEmail}})</p>',
    });

    const rendered = await templateService.render(user.id, template.id, { recipientEmail: 'jane@acme.test' });

    expect(rendered.subject).toBe('Following up, Jane');
    expect(rendered.body).toBe('<p>Hi Jane Doe at Acme Corp,</p><p>— Alice Owner (alice@mailviz.test)</p>');
    expect(rendered.missing).toEqual([]);
  });

  it('matches the recipient case-insensitively', async () => {
    const user = await createUser({ name: 'Alice Owner' });
    const customer = await createCustomer(user.id, { name: 'Acme Corp', domain: 'acme.test' });
    await createContact(customer.id, { firstName: 'Jane', lastName: 'Doe', email: 'Jane@Acme.test' });

    const template = await createTemplate(user.id, { body: '<p>Hi {{firstName}},</p>' });
    const rendered = await templateService.render(user.id, template.id, { recipientEmail: 'JANE@acme.TEST' });

    expect(rendered.body).toBe('<p>Hi Jane,</p>');
  });

  it('does not read a contact belonging to another user', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id, { name: 'Bob Industries', domain: 'bobind.test' });
    await createContact(bobCustomer.id, { firstName: 'Jane', lastName: 'Doe', email: 'jane@bobind.test' });

    const template = await createTemplate(alice.id, { body: '<p>Hi {{firstName}} at {{company}},</p>' });
    const rendered = await templateService.render(alice.id, template.id, { recipientEmail: 'jane@bobind.test' });

    expect(rendered.body).toContain('{{firstName}}');
    expect(rendered.body).not.toContain('Jane');
    expect(rendered.body).not.toContain('Bob Industries');
    expect(rendered.missing).toEqual(expect.arrayContaining(['firstName', 'company']));
  });

  it('leaves an unfillable variable in place and reports it', async () => {
    const user = await createUser({ name: 'Alice Owner' });
    const template = await createTemplate(user.id, { body: '<p>Hi {{firstName}}, from {{myName}}.</p>' });

    // No recipient at all: a brand-new compose window with an empty To field.
    const rendered = await templateService.render(user.id, template.id, {});

    expect(rendered.missing).toEqual(['firstName']);
    // Left verbatim, not blanked — "Hi ," would be damage the user cannot
    // trace, and compose blocks the send while a placeholder survives.
    expect(rendered.body).toBe('<p>Hi {{firstName}}, from Alice Owner.</p>');
  });

  it('falls back to the display name from the message being replied to', async () => {
    const user = await createUser();
    const template = await createTemplate(user.id, { body: '<p>Hi {{firstName}} {{lastName}},</p>' });

    const rendered = await templateService.render(user.id, template.id, {
      recipientEmail: 'someone@unknown.test',
      recipientName: 'Jean-Pierre Martin',
    });

    expect(rendered.body).toBe('<p>Hi Jean-Pierre Martin,</p>');
    expect(rendered.missing).toEqual([]);
  });

  it('resolves the company from the email domain when there is no contact', async () => {
    const user = await createUser();
    await createCustomer(user.id, { name: 'Acme Corp', domain: 'acme.test' });

    const template = await createTemplate(user.id, { body: '<p>Hello {{company}}</p>' });
    const rendered = await templateService.render(user.id, template.id, { recipientEmail: 'nobody@acme.test' });

    expect(rendered.body).toBe('<p>Hello Acme Corp</p>');
  });

  it('escapes substituted values into the HTML body but not into the subject', async () => {
    const user = await createUser({ name: 'Alice' });
    const customer = await createCustomer(user.id, { name: 'Ben & Co <Holdings>', domain: 'benco.test' });
    await createContact(customer.id, { firstName: 'Ben', lastName: 'Smith', email: 'ben@benco.test' });

    const template = await createTemplate(user.id, {
      subject: 'Proposal for {{company}}',
      body: '<p>Dear {{company}},</p>',
    });
    const rendered = await templateService.render(user.id, template.id, { recipientEmail: 'ben@benco.test' });

    // The body is HTML — an unescaped "<Holdings>" would swallow the rest of it.
    expect(rendered.body).toBe('<p>Dear Ben &amp; Co &lt;Holdings&gt;,</p>');
    // The subject is a plain-text header; escaping it would put a literal
    // "&amp;" in the recipient's inbox.
    expect(rendered.subject).toBe('Proposal for Ben & Co <Holdings>');
  });

  it('counts usage so the picker can put the most-used first', async () => {
    const user = await createUser();
    const rare = await createTemplate(user.id, { name: 'Rare' });
    const common = await createTemplate(user.id, { name: 'Common' });

    await templateService.render(user.id, common.id, {});
    await templateService.render(user.id, common.id, {});
    await templateService.render(user.id, rare.id, {});

    const listed = await templateService.findAll(user.id);
    expect(listed.map((t) => t.name)).toEqual(['Common', 'Rare']);
    expect(listed[0].usageCount).toBe(2);
    expect(listed[0].lastUsedAt).toBeInstanceOf(Date);
  });

  it('renders a snippet with no subject', async () => {
    const user = await createUser({ name: 'Alice Owner' });
    const snippet = await createTemplate(user.id, {
      name: 'Sign-off',
      kind: 'snippet',
      subject: 'ignored',
      body: '<p>Thanks, {{myName}}</p>',
    });

    expect(snippet.subject).toBeNull();

    const rendered = await templateService.render(user.id, snippet.id, {});
    expect(rendered.subject).toBeNull();
    expect(rendered.body).toBe('<p>Thanks, Alice Owner</p>');
  });
});

describe('applyVariables', () => {
  it('tolerates whitespace inside the braces', () => {
    const { text, missing } = applyVariables('Hi {{ firstName }}', { firstName: 'Jane' }, { escape: false });
    expect(text).toBe('Hi Jane');
    expect(missing).toEqual([]);
  });

  it('treats an empty string as missing', () => {
    // A contact whose lastName is '' must not silently produce "Dear Jane ".
    const { text, missing } = applyVariables('Dear {{lastName}}', { lastName: '' }, { escape: false });
    expect(text).toBe('Dear {{lastName}}');
    expect(missing).toEqual(['lastName']);
  });

  it('reports each missing name once however often it appears', () => {
    const { missing } = applyVariables('{{firstName}} {{firstName}}', {}, { escape: false });
    expect(missing).toEqual(['firstName']);
  });
});

describe('extractPlaceholders', () => {
  it('finds each distinct name', () => {
    expect(extractPlaceholders('{{firstName}} {{company}} {{firstName}}').sort()).toEqual(['company', 'firstName']);
  });

  it('ignores anything that is not a bare identifier', () => {
    expect(extractPlaceholders('{{ user.name }} {{ 1 + 1 }} {{}}')).toEqual([]);
  });
});
