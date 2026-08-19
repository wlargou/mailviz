import { describe, it, expect } from 'vitest';
import { saveDraftSchema, sendDraftSchema } from './draftValidator.js';

/**
 * Draft request schemas.
 *
 * The pair exists because a draft and a send have opposite requirements: a
 * draft is half-written by definition (autosave fires while the user is still
 * typing the first address), while sending is the moment it has to become a
 * real message. The tests below are mostly about keeping those two apart —
 * tightening `saveDraftSchema` breaks autosave, loosening `sendDraftSchema`
 * lets a message go out with no recipient.
 *
 * The attachment policy applies to both, for the reason the validator states:
 * a draft's attachments are the same bytes that eventually leave the building.
 */

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function attachment(overrides: Partial<{ filename: string; content: string; contentType: string; size: number }> = {}) {
  return {
    filename: 'quote.pdf',
    content: 'JVBERi0xLjQK',
    contentType: 'application/pdf',
    size: 1024,
    ...overrides,
  };
}

/** Field paths Zod complained about — the same list the validate middleware turns into `details`. */
function pathsOf(result: { success: boolean; error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> } }): string[] {
  return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('saveDraftSchema', () => {
  it('accepts a completely empty draft', () => {
    // Autosave fires before the user has typed anything meaningful. If this
    // required a recipient or a body, every early save would 400 and the draft
    // would be lost.
    expect(saveDraftSchema.parse({})).toEqual({
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      htmlBody: '',
      attachments: [],
    });
  });

  it('accepts an empty subject and body explicitly', () => {
    const parsed = saveDraftSchema.parse({ subject: '', htmlBody: '' });

    expect(parsed.subject).toBe('');
    expect(parsed.htmlBody).toBe('');
  });

  it('still validates the addresses that are present', () => {
    // A half-typed address is the normal state of a draft, but it is stored and
    // later sent verbatim — Gmail rejects the whole send for one bad address.
    expect(() => saveDraftSchema.parse({ to: ['ada@'] })).toThrow();
    expect(() => saveDraftSchema.parse({ cc: ['nope'] })).toThrow();
    expect(() => saveDraftSchema.parse({ bcc: [''] })).toThrow();
  });

  it('bounds the subject and body like a real message', () => {
    expect(saveDraftSchema.parse({ subject: 'a'.repeat(500) }).subject).toHaveLength(500);
    expect(() => saveDraftSchema.parse({ subject: 'a'.repeat(501) })).toThrow();
    expect(() => saveDraftSchema.parse({ htmlBody: 'a'.repeat(500001) })).toThrow();
  });

  it('enforces the attachment policy on drafts', () => {
    const blocked = saveDraftSchema.safeParse({ attachments: [attachment({ filename: 'payload.exe' })] });
    expect(blocked.success).toBe(false);
    expect(pathsOf(blocked)).toContain('attachments');

    const half = 13 * 1024 * 1024;
    const oversized = saveDraftSchema.safeParse({
      attachments: [attachment({ size: half }), attachment({ filename: 'b.pdf', size: half })],
    });
    expect(oversized.success).toBe(false);

    expect(saveDraftSchema.parse({ attachments: [attachment()] }).attachments).toHaveLength(1);
  });

  it('bounds the attachment count and validates each entry', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => attachment({ filename: `f${i}.pdf` }));
    expect(saveDraftSchema.parse({ attachments: twenty }).attachments).toHaveLength(20);
    expect(() => saveDraftSchema.parse({ attachments: [...twenty, attachment({ filename: 'f20.pdf' })] })).toThrow();
    expect(() => saveDraftSchema.parse({ attachments: [attachment({ size: 0 })] })).toThrow();
  });

  it('requires replyToEmailId to be a uuid when present', () => {
    expect(saveDraftSchema.parse({ replyToEmailId: UUID }).replyToEmailId).toBe(UUID);
    expect(() => saveDraftSchema.parse({ replyToEmailId: 'thread-1' })).toThrow();
    expect(saveDraftSchema.parse({})).not.toHaveProperty('replyToEmailId');
  });

  it('drops unknown keys — the Gmail draft id is not caller-supplied', () => {
    expect(saveDraftSchema.parse({ gmailDraftId: 'r-123', userId: 'someone-else' }))
      .not.toHaveProperty('gmailDraftId');
  });
});

describe('sendDraftSchema', () => {
  it('requires at least one recipient', () => {
    // This is the difference between the two schemas. An empty `to` reaching
    // Gmail is a 400 at send time, after the draft has already been marked as
    // sent-in-progress by the UI.
    const empty = sendDraftSchema.safeParse({});
    expect(empty.success).toBe(false);
    expect(pathsOf(empty)).toContain('to');

    const none = sendDraftSchema.safeParse({ to: [] });
    expect(none.success).toBe(false);
    expect(pathsOf(none)).toContain('to');
  });

  it('accepts a recipient with no subject or body — an empty send is still a send', () => {
    const parsed = sendDraftSchema.parse({ to: ['ada@acme.com'] });

    expect(parsed.subject).toBe('');
    expect(parsed.htmlBody).toBe('');
    expect(parsed.cc).toEqual([]);
    expect(parsed.attachments).toEqual([]);
  });

  it('validates every address', () => {
    expect(() => sendDraftSchema.parse({ to: ['ada@acme.com', 'nope'] })).toThrow();
    expect(() => sendDraftSchema.parse({ to: ['ada@acme.com'], cc: ['nope'] })).toThrow();
  });

  it('enforces the attachment policy at send time too', () => {
    const result = sendDraftSchema.safeParse({
      to: ['ada@acme.com'],
      attachments: [attachment({ filename: 'macro.vbs' })],
    });

    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('attachments');
  });
});
