import { describe, it, expect } from 'vitest';
import { sentTo } from './mailList';

describe('sentTo', () => {
  it('names the first recipient, by name when there is one, and counts the rest', () => {
    expect(sentTo({ to: ['"Hicham Gadi" <h@awb.ma>', 'b@x.ma'], cc: ['c@x.ma'] })).toBe('To: Hicham Gadi +2');
    expect(sentTo({ to: ['h@awb.ma'], cc: [] })).toBe('To: h@awb.ma');
    expect(sentTo({ to: [], cc: ['Boss <boss@x.ma>'] })).toBe('To: Boss');
    expect(sentTo({ to: [], cc: [] })).toBe('To: (no one)');
  });
});
