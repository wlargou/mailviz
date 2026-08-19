import { describe, it, expect } from 'vitest';
import {
  createEventSchema,
  updateEventSchema,
  respondEventSchema,
  recurrenceSchema,
  remindersSchema,
  visibilitySchema,
} from './calendarValidator.js';

/**
 * Calendar event request schemas.
 *
 * Everything parsed here is forwarded almost verbatim to the Google Calendar
 * API (see services/calendarService.ts), so the schema is the only thing
 * standing between a malformed request and a 400 coming back from Google that
 * the user sees as "failed to save event". The constraints that matter are the
 * ones Google itself enforces — the RFC 5545 recurrence shape, at most five
 * reminder overrides, `useDefault: false` whenever overrides are supplied — and
 * they are only worth having if they actually reject.
 *
 * `startTime`/`endTime` are the other load-bearing pair: an event with an
 * unparseable start is written to Postgres as an invalid Date and every
 * calendar query downstream inherits the problem.
 */

const START = '2026-09-01T09:00:00Z';
const END = '2026-09-01T10:00:00Z';

function minimalEvent() {
  return { title: 'Standup', startTime: START, endTime: END };
}

/** Field paths Zod complained about — the same list the validate middleware turns into `details`. */
function pathsOf(result: { success: boolean; error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> } }): string[] {
  return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('createEventSchema', () => {
  it('accepts the minimal event and defaults sendUpdates to all', () => {
    const parsed = createEventSchema.parse(minimalEvent());

    expect(parsed.title).toBe('Standup');
    // Attendees are notified unless the caller opts out — if this default were
    // lost, invitees would silently stop receiving invitations.
    expect(parsed.sendUpdates).toBe('all');
  });

  it('requires title, startTime and endTime', () => {
    expect(() => createEventSchema.parse({ startTime: START, endTime: END })).toThrow();
    expect(() => createEventSchema.parse({ title: 'Standup', endTime: END })).toThrow();
    expect(() => createEventSchema.parse({ title: 'Standup', startTime: START })).toThrow();
    expect(() => createEventSchema.parse({ ...minimalEvent(), title: '' })).toThrow();
  });

  it('caps the title at 255 characters', () => {
    expect(createEventSchema.parse({ ...minimalEvent(), title: 'a'.repeat(255) }).title).toHaveLength(255);
    expect(() => createEventSchema.parse({ ...minimalEvent(), title: 'a'.repeat(256) })).toThrow();
  });

  it('demands an ISO UTC datetime, not a date or a bare local time', () => {
    // The client builds these with `Date.toISOString()` (EventModal), which is
    // always the `Z` form. A date-only string would reach Prisma as an invalid
    // Date and poison every calendar range query that reads the row back.
    expect(() => createEventSchema.parse({ ...minimalEvent(), startTime: '2026-09-01' })).toThrow();
    expect(() => createEventSchema.parse({ ...minimalEvent(), startTime: '2026-09-01T09:00:00' })).toThrow();
    expect(() => createEventSchema.parse({ ...minimalEvent(), startTime: 'tomorrow' })).toThrow();
    expect(() => createEventSchema.parse({ ...minimalEvent(), endTime: '' })).toThrow();

    expect(createEventSchema.parse({ ...minimalEvent(), startTime: '2026-09-01T09:00:00.123Z' }).startTime)
      .toBe('2026-09-01T09:00:00.123Z');
  });

  it('validates every attendee address', () => {
    const ok = createEventSchema.parse({
      ...minimalEvent(),
      attendees: [{ email: 'ada@acme.com' }, { email: 'grace@acme.com' }],
    });
    expect(ok.attendees).toHaveLength(2);

    const bad = createEventSchema.safeParse({
      ...minimalEvent(),
      attendees: [{ email: 'ada@acme.com' }, { email: 'not-an-address' }],
    });
    expect(bad.success).toBe(false);
    // The index has to survive so the UI can point at the offending chip.
    expect(pathsOf(bad)).toContain('attendees.1.email');
  });

  it('rejects an unknown sendUpdates value', () => {
    expect(() => createEventSchema.parse({ ...minimalEvent(), sendUpdates: 'internalOnly' })).toThrow();
    expect(createEventSchema.parse({ ...minimalEvent(), sendUpdates: 'none' }).sendUpdates).toBe('none');
  });

  it('keeps colorId to the two characters Google uses', () => {
    expect(createEventSchema.parse({ ...minimalEvent(), colorId: '11' }).colorId).toBe('11');
    expect(() => createEventSchema.parse({ ...minimalEvent(), colorId: '110' })).toThrow();
  });

  it('drops unknown keys rather than forwarding them to Google', () => {
    const parsed = createEventSchema.parse({ ...minimalEvent(), organizer: 'someone@else.com' });

    expect(parsed).not.toHaveProperty('organizer');
  });
});

/**
 * Recurrence lines go straight into Google's `recurrence` array. Google rejects
 * the whole request when one line is malformed, so a typo in a single EXDATE
 * loses the entire event rather than the exception.
 */
describe('recurrenceSchema', () => {
  it('accepts the RFC 5545 property lines the app emits', () => {
    const lines = [
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'EXDATE;TZID=Europe/Paris:20260101T090000',
      'RDATE:20260115T090000Z',
      'EXRULE:FREQ=MONTHLY',
    ];

    expect(recurrenceSchema.parse(lines)).toEqual(lines);
  });

  it('rejects a rule that is missing its property name', () => {
    // The single most likely client mistake: sending the rule body only.
    expect(() => recurrenceSchema.parse(['FREQ=WEEKLY;BYDAY=MO'])).toThrow();
  });

  it('rejects a property name that is not one of the four', () => {
    expect(() => recurrenceSchema.parse(['DTSTART:20260101T090000Z'])).toThrow();
  });

  it('rejects characters RFC 5545 does not allow in these lines', () => {
    expect(() => recurrenceSchema.parse(['RRULE:FREQ=WEEKLY BYDAY=MO'])).toThrow();
    expect(() => recurrenceSchema.parse(['RRULE:FREQ=WEEKLY\nRRULE:FREQ=DAILY'])).toThrow();
    expect(() => recurrenceSchema.parse(['RRULE:'])).toThrow();
    expect(() => recurrenceSchema.parse([''])).toThrow();
  });

  it('caps the line length and the number of lines', () => {
    const long = `RRULE:${'A'.repeat(506)}`;
    expect(long).toHaveLength(512);
    expect(recurrenceSchema.parse([long])).toEqual([long]);
    expect(() => recurrenceSchema.parse([`${long}A`])).toThrow();

    const ten = Array.from({ length: 10 }, (_, i) => `RDATE:2026010${i}T090000Z`);
    expect(recurrenceSchema.parse(ten)).toHaveLength(10);
    expect(() => recurrenceSchema.parse([...ten, 'RDATE:20260111T090000Z'])).toThrow();
  });

  it('accepts an empty array — no recurrence is a valid answer', () => {
    expect(recurrenceSchema.parse([])).toEqual([]);
  });
});

/**
 * Google returns a 400 for `useDefault: true` together with explicit overrides,
 * and that 400 surfaces to the user as a generic save failure. The refine here
 * is the only place that combination is caught.
 */
describe('remindersSchema', () => {
  it('accepts explicit overrides with useDefault false', () => {
    const parsed = remindersSchema.parse({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 10 }, { method: 'email', minutes: 60 }],
    });

    expect(parsed.overrides).toHaveLength(2);
  });

  it('accepts useDefault true with no overrides at all', () => {
    expect(remindersSchema.parse({ useDefault: true })).toEqual({ useDefault: true });
    // An empty overrides array is not a conflict — there is nothing to conflict with.
    expect(remindersSchema.parse({ useDefault: true, overrides: [] }).overrides).toEqual([]);
  });

  it('rejects useDefault true alongside overrides, blaming useDefault', () => {
    const result = remindersSchema.safeParse({
      useDefault: true,
      overrides: [{ method: 'popup', minutes: 10 }],
    });

    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('useDefault');
  });

  it('requires useDefault to be present', () => {
    expect(() => remindersSchema.parse({ overrides: [{ method: 'popup', minutes: 10 }] })).toThrow();
  });

  it('allows at most five overrides — Google rejects the sixth', () => {
    const five = Array.from({ length: 5 }, () => ({ method: 'popup' as const, minutes: 10 }));
    expect(remindersSchema.parse({ useDefault: false, overrides: five }).overrides).toHaveLength(5);
    expect(() =>
      remindersSchema.parse({ useDefault: false, overrides: [...five, { method: 'popup', minutes: 10 }] })
    ).toThrow();
  });

  it('bounds minutes at 0 and at four weeks', () => {
    const at = (minutes: number) => ({ useDefault: false, overrides: [{ method: 'email', minutes }] });

    expect(remindersSchema.parse(at(0)).overrides?.[0].minutes).toBe(0);
    expect(remindersSchema.parse(at(40320)).overrides?.[0].minutes).toBe(40320);
    expect(() => remindersSchema.parse(at(40321))).toThrow();
    expect(() => remindersSchema.parse(at(-1))).toThrow();
    expect(() => remindersSchema.parse(at(10.5))).toThrow();
  });

  it('rejects a reminder method Google does not have', () => {
    expect(() => remindersSchema.parse({ useDefault: false, overrides: [{ method: 'sms', minutes: 10 }] })).toThrow();
  });
});

describe('visibilitySchema', () => {
  it('accepts Google\'s four visibilities and nothing else', () => {
    for (const v of ['default', 'public', 'private', 'confidential']) {
      expect(visibilitySchema.parse(v)).toBe(v);
    }
    expect(() => visibilitySchema.parse('secret')).toThrow();
    expect(() => visibilitySchema.parse('')).toThrow();
  });
});

describe('updateEventSchema', () => {
  it('accepts a single-field edit without resupplying the times', () => {
    expect(updateEventSchema.parse({ title: 'Renamed' }).title).toBe('Renamed');
  });

  it('still validates the fields that are present', () => {
    expect(() => updateEventSchema.parse({ title: '' })).toThrow();
    expect(() => updateEventSchema.parse({ startTime: 'nope' })).toThrow();
    expect(() => updateEventSchema.parse({ visibility: 'secret' })).toThrow();
    expect(() => updateEventSchema.parse({ reminders: { useDefault: true, overrides: [{ method: 'popup', minutes: 5 }] } })).toThrow();
  });

  it('still defaults sendUpdates on a partial edit', () => {
    // `.partial()` keeps the `.default('all')` inside the optional wrapper, so
    // an edit that does not mention sendUpdates still notifies attendees. That
    // is the intended behaviour here — unlike a stored column, sendUpdates is a
    // per-request instruction to Google and never overwrites saved state — but
    // it is asserted so the difference from `updateDealSchema` is deliberate
    // and visible rather than accidental.
    expect(updateEventSchema.parse({ title: 'Renamed' }).sendUpdates).toBe('all');
  });
});

describe('respondEventSchema', () => {
  it('accepts the three RSVP answers', () => {
    for (const response of ['accepted', 'declined', 'tentative']) {
      expect(respondEventSchema.parse({ response }).response).toBe(response);
    }
  });

  it('rejects a missing or unknown response', () => {
    expect(() => respondEventSchema.parse({})).toThrow();
    expect(() => respondEventSchema.parse({ response: 'maybe' })).toThrow();
    expect(() => respondEventSchema.parse({ response: 'ACCEPTED' })).toThrow();
  });
});
