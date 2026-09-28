import { describe, it, expect } from 'vitest';
import { replyRecipients, ownAddressesIn, bareAddress } from './replyRecipients';

const own = new Set(['me@powerm.ma', 'alias@powerm.ma']);

describe('replyRecipients (client)', () => {
  it("answers someone else's message by its sender", () => {
    expect(replyRecipients({ from: 'Omar <omar@bkam.ma>', to: ['me@powerm.ma'], cc: ['sara@bkam.ma'] }, false, own))
      .toEqual({ to: ['omar@bkam.ma'], cc: [] });
  });

  it('answers your own message by the people you wrote to — REGRESSION', () => {
    // The form used to prefill your own address, so the reply went to you.
    expect(replyRecipients({ from: 'me@powerm.ma', to: ['h.gadialami@awb.ma'], cc: ['t.eljallab@awb.ma'] }, false, own))
      .toEqual({ to: ['h.gadialami@awb.ma'], cc: [] });
  });

  it('reply all keeps everyone else, and never you or an alias', () => {
    expect(replyRecipients({ from: 'omar@bkam.ma', to: ['ME@powerm.ma', 'sara@bkam.ma'], cc: ['alias@powerm.ma', 'omar@bkam.ma', 'karim@bkam.ma'] }, true, own))
      .toEqual({ to: ['omar@bkam.ma'], cc: ['sara@bkam.ma', 'karim@bkam.ma'] });
  });

  it('reply all to your own message keeps its recipients and its copies', () => {
    expect(replyRecipients({ from: 'me@powerm.ma', to: ['a@x.ma', 'b@x.ma'], cc: ['c@x.ma', 'me@powerm.ma'] }, true, own))
      .toEqual({ to: ['a@x.ma', 'b@x.ma'], cc: ['c@x.ma'] });
  });

  it('falls back to whoever was copied when you wrote only to yourself', () => {
    expect(replyRecipients({ from: 'me@powerm.ma', to: ['alias@powerm.ma'], cc: ['boss@x.ma'] }, false, own).to).toEqual(['boss@x.ma']);
  });

  it('writes to yourself only when the message only went to you', () => {
    expect(replyRecipients({ from: 'me@powerm.ma', to: ['alias@powerm.ma'], cc: [] }, false, own).to).toEqual(['me@powerm.ma']);
  });
});

describe('ownAddressesIn', () => {
  it('is the login address and whatever the thread shows you sending from', () => {
    const got = ownAddressesIn('Me@Powerm.ma', [
      { from: 'L.walid <alias@powerm.ma>', labelIds: ['SENT'] },
      { from: 'omar@bkam.ma', labelIds: ['INBOX'] },
    ]);
    expect([...got].sort()).toEqual(['alias@powerm.ma', 'me@powerm.ma']);
    expect(bareAddress(' X <A@B.ma> ')).toBe('a@b.ma');
  });
});
