import { describe, it, expect } from 'vitest';
import {
  sendEmailSchema,
  replyEmailSchema,
  forwardEmailSchema,
  scheduleEmailSchema,
  updateScheduledEmailSchema,
} from './composeValidator.js';

/**
 * Compose request schemas.
 *
 * This is the one validator whose failures are irreversible: everything that
 * gets past it is handed to Gmail and leaves the building. Three groups of
 * assertions matter.
 *
 * 1. **Recipients.** `to` is the difference between a sent message and a Gmail
 *    400; an empty array must never reach the API layer.
 * 2. **The attachment policy.** Blocked extensions and the 25MB cap are
 *    enforced by a `.refine()` over the whole array, which is the fragile kind
 *    of rule — it lives outside the field definitions, so a later `.extend()`
 *    or `.omit()` on the object silently drops it and executables start
 *    flowing through. Both halves of the rule are tested, plus the error path,
 *    because a refine that reports on the wrong field is a refine the UI cannot
 *    surface.
 * 3. **Scheduling in the past.** `scheduledSendScheduler` sweeps every 30s for
 *    due rows, so a past `sendAt` is not "invalid" to the scheduler — it is
 *    due, and the mail goes out immediately. The refine is the only thing that
 *    prevents "schedule for last Tuesday" meaning "send now".
 */

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_UUID = '9c858901-8a57-4791-81fe-4c455b099bc9';

function futureIso(msAhead = 60 * 60 * 1000): string {
  return new Date(Date.now() + msAhead).toISOString();
}

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

describe('sendEmailSchema', () => {
  const minimal = { to: ['ada@acme.com'], subject: 'Hello', htmlBody: '<p>Hi</p>' };

  it('accepts a minimal message and fills the empty collections', () => {
    const parsed = sendEmailSchema.parse(minimal);

    // The controller iterates cc/bcc/attachments unconditionally; if the
    // defaults were lost these would be undefined and sending would throw.
    expect(parsed.cc).toEqual([]);
    expect(parsed.bcc).toEqual([]);
    expect(parsed.attachments).toEqual([]);
  });

  it('refuses a message with no recipient', () => {
    const result = sendEmailSchema.safeParse({ ...minimal, to: [] });

    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('to');
    expect(() => sendEmailSchema.parse({ subject: 'Hello', htmlBody: '<p>Hi</p>' })).toThrow();
  });

  it('rejects a malformed address anywhere in to, cc or bcc', () => {
    expect(() => sendEmailSchema.parse({ ...minimal, to: ['ada@acme.com', 'nope'] })).toThrow();
    expect(() => sendEmailSchema.parse({ ...minimal, cc: ['nope'] })).toThrow();
    expect(() => sendEmailSchema.parse({ ...minimal, bcc: ['nope'] })).toThrow();
    expect(() => sendEmailSchema.parse({ ...minimal, to: ['ada@acme.com'], cc: [''] })).toThrow();
  });

  it('caps an address at 255 characters', () => {
    const at255 = `${'a'.repeat(243)}@example.com`;
    expect(at255).toHaveLength(255);
    expect(sendEmailSchema.parse({ ...minimal, to: [at255] }).to[0]).toBe(at255);

    expect(() => sendEmailSchema.parse({ ...minimal, to: [`a${at255}`] })).toThrow();
  });

  it('requires a subject and a body, and bounds both', () => {
    expect(() => sendEmailSchema.parse({ ...minimal, subject: '' })).toThrow();
    expect(() => sendEmailSchema.parse({ ...minimal, htmlBody: '' })).toThrow();

    expect(sendEmailSchema.parse({ ...minimal, subject: 'a'.repeat(500) }).subject).toHaveLength(500);
    expect(() => sendEmailSchema.parse({ ...minimal, subject: 'a'.repeat(501) })).toThrow();

    expect(sendEmailSchema.parse({ ...minimal, htmlBody: 'a'.repeat(500000) }).htmlBody).toHaveLength(500000);
    expect(() => sendEmailSchema.parse({ ...minimal, htmlBody: 'a'.repeat(500001) })).toThrow();
  });

  it('blocks executable attachments, whatever the case', () => {
    for (const filename of ['payload.exe', 'PAYLOAD.EXE', 'setup.msi', 'macro.vbs', 'script.js', 'thing.cpl']) {
      const result = sendEmailSchema.safeParse({ ...minimal, attachments: [attachment({ filename })] });
      expect(result.success, `${filename} should be blocked`).toBe(false);
      // The refine must blame `attachments` — compose shows the message next to
      // the attachment list, and an unattributed error is invisible there.
      expect(pathsOf(result)).toContain('attachments');
    }
  });

  it('blocks an executable hidden among harmless attachments', () => {
    // The loop in validateAttachments has to check every entry, not just the
    // first — a single `return` in the wrong place would let this through.
    const result = sendEmailSchema.safeParse({
      ...minimal,
      attachments: [attachment(), attachment({ filename: 'notes.txt' }), attachment({ filename: 'run.bat' })],
    });

    expect(result.success).toBe(false);
  });

  it('allows an ordinary extension the policy does not list', () => {
    expect(sendEmailSchema.parse({ ...minimal, attachments: [attachment({ filename: 'deck.pptx' })] })
      .attachments).toHaveLength(1);
  });

  it.fails('KNOWN GAP: a double extension slips past the blocklist', () => {
    // `report.exe.txt` is a real attack when Windows hides known extensions,
    // and BLOCKED_EXTENSIONS is anchored to the end of the filename, so it is
    // accepted today.
    //
    // Written as `it.fails` on purpose. As a passing assertion that the file is
    // ACCEPTED, this cemented the bypass: tightening the regex turned the test
    // red, and a red test invites reverting the fix. Inverted, hardening the
    // policy makes this go green and the todo below is the reminder to delete
    // the wrapper when it does.
    expect(() =>
      sendEmailSchema.parse({ ...minimal, attachments: [attachment({ filename: 'report.exe.txt' })] })
    ).toThrow();
  });

  it('rejects attachments totalling more than 25MB', () => {
    const half = 13 * 1024 * 1024;
    const result = sendEmailSchema.safeParse({
      ...minimal,
      attachments: [attachment({ size: half }), attachment({ filename: 'b.pdf', size: half })],
    });

    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('attachments');

    // Exactly at the cap is allowed — the rule is "more than", not "at least".
    const exact = sendEmailSchema.safeParse({ ...minimal, attachments: [attachment({ size: 25 * 1024 * 1024 })] });
    expect(exact.success).toBe(true);
  });

  it('rejects a single oversized attachment', () => {
    const result = sendEmailSchema.safeParse({ ...minimal, attachments: [attachment({ size: 25 * 1024 * 1024 + 1 })] });

    expect(result.success).toBe(false);
  });

  it('bounds the attachment count and validates each entry', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => attachment({ filename: `f${i}.pdf`, size: 1024 }));
    expect(sendEmailSchema.parse({ ...minimal, attachments: twenty }).attachments).toHaveLength(20);
    expect(() => sendEmailSchema.parse({ ...minimal, attachments: [...twenty, attachment({ filename: 'f20.pdf' })] })).toThrow();

    expect(() => sendEmailSchema.parse({ ...minimal, attachments: [attachment({ filename: '' })] })).toThrow();
    expect(() => sendEmailSchema.parse({ ...minimal, attachments: [attachment({ content: '' })] })).toThrow();
    expect(() => sendEmailSchema.parse({ ...minimal, attachments: [attachment({ size: 0 })] })).toThrow();
    expect(() => sendEmailSchema.parse({ ...minimal, attachments: [attachment({ size: -1 })] })).toThrow();
    expect(() => sendEmailSchema.parse({ ...minimal, attachments: [attachment({ size: 1.5 })] })).toThrow();
  });
});

describe('replyEmailSchema', () => {
  it('needs only a body, and defaults replyAll to false', () => {
    const parsed = replyEmailSchema.parse({ htmlBody: '<p>Sure</p>' });

    // A reply that defaulted to replyAll would copy every original recipient
    // on a message the user believed was going to one person.
    expect(parsed.replyAll).toBe(false);
    expect(parsed.cc).toEqual([]);
    expect(parsed.attachments).toEqual([]);
  });

  it('rejects an empty body', () => {
    expect(() => replyEmailSchema.parse({ htmlBody: '' })).toThrow();
    expect(() => replyEmailSchema.parse({})).toThrow();
  });

  it('enforces the attachment policy on replies too', () => {
    expect(() => replyEmailSchema.parse({ htmlBody: '<p>x</p>', attachments: [attachment({ filename: 'a.exe' })] })).toThrow();
  });

  it('keeps replyAll when explicitly true', () => {
    expect(replyEmailSchema.parse({ htmlBody: '<p>x</p>', replyAll: true }).replyAll).toBe(true);
  });
});

describe('forwardEmailSchema', () => {
  it('requires a recipient but not a body', () => {
    const parsed = forwardEmailSchema.parse({ to: ['ada@acme.com'] });

    // Forwarding with no added comment is normal, so the body defaults to ''.
    expect(parsed.htmlBody).toBe('');
    expect(parsed.forwardExistingAttachments).toEqual([]);

    expect(() => forwardEmailSchema.parse({ to: [] })).toThrow();
    expect(() => forwardEmailSchema.parse({ htmlBody: '<p>fyi</p>' })).toThrow();
  });

  it('requires forwarded attachment ids to be uuids', () => {
    expect(forwardEmailSchema.parse({ to: ['ada@acme.com'], forwardExistingAttachments: [UUID] })
      .forwardExistingAttachments).toEqual([UUID]);
    expect(() => forwardEmailSchema.parse({ to: ['ada@acme.com'], forwardExistingAttachments: ['1'] })).toThrow();
  });

  it('enforces the attachment policy on forwards too', () => {
    expect(() => forwardEmailSchema.parse({ to: ['ada@acme.com'], attachments: [attachment({ filename: 'a.scr' })] })).toThrow();
  });
});

describe('scheduleEmailSchema', () => {
  const base = { sendAt: futureIso(), mode: 'new' as const, to: ['ada@acme.com'], htmlBody: '<p>Later</p>' };

  it('accepts a future send in new mode', () => {
    const parsed = scheduleEmailSchema.parse(base);

    expect(parsed.mode).toBe('new');
    expect(parsed.subject).toBe('');
  });

  it('refuses a send time in the past, blaming sendAt', () => {
    // The scheduler treats "due" as `sendAt <= now`, so a past timestamp is not
    // rejected downstream — it is picked up on the next 30s tick and sent
    // immediately. This refine is the only thing standing in the way.
    const result = scheduleEmailSchema.safeParse({ ...base, sendAt: new Date(Date.now() - 60_000).toISOString() });

    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('sendAt');
  });

  it('refuses a sendAt that is not an ISO datetime at all', () => {
    expect(() => scheduleEmailSchema.parse({ ...base, sendAt: '2026-09-01' })).toThrow();
    expect(() => scheduleEmailSchema.parse({ ...base, sendAt: 'later' })).toThrow();
    expect(() => scheduleEmailSchema.parse({ ...base, sendAt: undefined })).toThrow();
  });

  it('requires recipients for new and forward, but not for replies', () => {
    const noRecipients = { sendAt: futureIso(), htmlBody: '<p>Later</p>' };

    const asNew = scheduleEmailSchema.safeParse({ ...noRecipients, mode: 'new' });
    expect(asNew.success).toBe(false);
    expect(pathsOf(asNew)).toContain('to');

    expect(scheduleEmailSchema.safeParse({ ...noRecipients, mode: 'forward' }).success).toBe(false);

    // A reply gets its recipients from the thread it answers, so an empty `to`
    // is correct there — rejecting it would break scheduled replies entirely.
    expect(scheduleEmailSchema.parse({ ...noRecipients, mode: 'reply', replyToEmailId: UUID }).to).toEqual([]);
    expect(scheduleEmailSchema.parse({ ...noRecipients, mode: 'replyAll', replyToEmailId: UUID }).to).toEqual([]);
  });

  it('rejects an unknown mode and a non-uuid replyToEmailId', () => {
    expect(() => scheduleEmailSchema.parse({ ...base, mode: 'draft' })).toThrow();
    expect(() => scheduleEmailSchema.parse({ ...base, replyToEmailId: 'not-a-uuid' })).toThrow();
    expect(scheduleEmailSchema.parse({ ...base, replyToEmailId: OTHER_UUID }).replyToEmailId).toBe(OTHER_UUID);
  });

  it('requires a body but leaves the subject optional', () => {
    expect(() => scheduleEmailSchema.parse({ ...base, htmlBody: '' })).toThrow();
    expect(scheduleEmailSchema.parse({ ...base, subject: 'Q3 numbers' }).subject).toBe('Q3 numbers');
  });

  it('enforces the attachment policy on scheduled sends too — REGRESSION', () => {
    // The bug: this schema carried the sendAt and recipient refines but not the
    // attachment one, so scheduling was a complete bypass of the policy every
    // other compose route enforces. "Schedule for one minute from now" shipped
    // an .exe, or a 60MB payload that then failed inside the 30s scheduler
    // sweep — a background failure the sender never sees.
    const blocked = scheduleEmailSchema.safeParse({ ...base, attachments: [attachment({ filename: 'a.cmd' })] });
    expect(blocked.success).toBe(false);
    expect(pathsOf(blocked)).toContain('attachments');

    const half = 13 * 1024 * 1024;
    const oversized = scheduleEmailSchema.safeParse({
      ...base,
      attachments: [attachment({ size: half }), attachment({ filename: 'b.pdf', size: half })],
    });
    expect(oversized.success).toBe(false);

    // …and an ordinary attachment still schedules.
    expect(scheduleEmailSchema.safeParse({ ...base, attachments: [attachment()] }).success).toBe(true);
  });
});

describe('updateScheduledEmailSchema', () => {
  it('accepts a reschedule into the future', () => {
    const sendAt = futureIso(2 * 60 * 60 * 1000);

    expect(updateScheduledEmailSchema.parse({ sendAt }).sendAt).toBe(sendAt);
  });

  it('refuses rescheduling into the past', () => {
    // Same consequence as scheduling in the past: the next scheduler tick would
    // treat the row as due and send it.
    const result = updateScheduledEmailSchema.safeParse({ sendAt: new Date(Date.now() - 1000).toISOString() });

    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('sendAt');
  });

  it('requires sendAt to be present and well formed', () => {
    expect(() => updateScheduledEmailSchema.parse({})).toThrow();
    expect(() => updateScheduledEmailSchema.parse({ sendAt: 'soon' })).toThrow();
  });
});
