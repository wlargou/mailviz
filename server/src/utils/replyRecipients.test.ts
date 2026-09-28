import { describe, it, expect } from 'vitest';
import { replyRecipients, bareAddress } from './replyRecipients.js';

const own = new Set(['me@powerm.ma', 'alias@powerm.ma']);

describe('replyRecipients', () => {
  it("answers someone else's message by its sender", () => {
    const r = replyRecipients({ from: 'omar@bkam.ma', to: ['me@powerm.ma'], cc: ['sara@bkam.ma'] }, { replyAll: false }, own);
    expect(r).toEqual({ to: ['omar@bkam.ma'], cc: [] });
  });

  it('answers your own message by the people you wrote to — REGRESSION', () => {
    // "Click to reply" on a thread you wrote last used to mail only yourself.
    const r = replyRecipients(
      { from: 'Me <me@powerm.ma>', to: ['h.gadialami@awb.ma'], cc: ['t.eljallab@awb.ma', 'alias@powerm.ma'] },
      { replyAll: false },
      own,
    );
    expect(r).toEqual({ to: ['h.gadialami@awb.ma'], cc: [] });
  });

  it('reply all keeps everyone else, and never you or your aliases', () => {
    const r = replyRecipients(
      { from: 'omar@bkam.ma', to: ['ME@powerm.ma', 'sara@bkam.ma'], cc: ['alias@powerm.ma', 'Omar <omar@bkam.ma>', 'karim@bkam.ma'] },
      { replyAll: true },
      own,
    );
    expect(r).toEqual({ to: ['omar@bkam.ma'], cc: ['sara@bkam.ma', 'karim@bkam.ma'] });
  });

  it('reply all to your own message keeps its recipients and its copies', () => {
    const r = replyRecipients(
      { from: 'me@powerm.ma', to: ['a@x.ma', 'b@x.ma'], cc: ['c@x.ma', 'me@powerm.ma'] },
      { replyAll: true },
      own,
    );
    expect(r).toEqual({ to: ['a@x.ma', 'b@x.ma'], cc: ['c@x.ma'] });
  });

  it('honours an explicit To, and drops you from it', () => {
    const r = replyRecipients({ from: 'omar@bkam.ma', to: ['me@powerm.ma'], cc: [] }, { replyAll: false, to: ['me@powerm.ma', 'new@x.ma'], cc: ['c@x.ma'] }, own);
    expect(r).toEqual({ to: ['new@x.ma'], cc: ['c@x.ma'] });
  });

  it('keeps the Cc of a reply all as the form left it — REGRESSION', () => {
    // Ahmed was taken off the Cc; merging the original's people back in
    // mailed him anyway.
    const r = replyRecipients(
      { from: 'omar@bkam.ma', to: ['me@powerm.ma', 'sara@bkam.ma', 'ahmed@bkam.ma'], cc: ['karim@bkam.ma'] },
      { replyAll: true, to: ['omar@bkam.ma'], cc: ['sara@bkam.ma', 'me@powerm.ma'] },
      own,
    );
    expect(r).toEqual({ to: ['omar@bkam.ma'], cc: ['sara@bkam.ma'] });
  });

  it('writes to yourself only when the message only ever went to you', () => {
    const r = replyRecipients({ from: 'me@powerm.ma', to: ['alias@powerm.ma'], cc: [] }, { replyAll: false }, own);
    expect(r.to).toEqual(['me@powerm.ma']);
  });

  it('reads the address out of a display name', () => {
    expect(bareAddress('Omar <OMAR@bkam.ma>')).toBe('omar@bkam.ma');
    expect(bareAddress(' plain@x.ma ')).toBe('plain@x.ma');
  });
});
