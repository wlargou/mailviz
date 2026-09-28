import { describe, it, expect } from 'vitest';
import { sentTo, mailListParams } from './mailList';
import type { MailFilters } from '../components/mail/MailSearchBar';

describe('sentTo', () => {
  it('names the first recipient, by name when there is one, and counts the rest', () => {
    expect(sentTo({ to: ['"Hicham Gadi" <h@awb.ma>', 'b@x.ma'], cc: ['c@x.ma'] })).toBe('To: Hicham Gadi +2');
    expect(sentTo({ to: ['h@awb.ma'], cc: [] })).toBe('To: h@awb.ma');
    expect(sentTo({ to: [], cc: ['Boss <boss@x.ma>'] })).toBe('To: Boss');
    expect(sentTo({ to: [], cc: [] })).toBe('To: (no one)');
  });
});

describe('mailListParams', () => {
  const NONE: MailFilters = {
    search: '', from: '', to: '', participant: '', participantName: '', subject: '',
    dateAfter: '', dateBefore: '', customerIds: [], isRead: null, hasAttachment: false, folder: null,
  };
  const opts = { page: 2, pageSize: 20, category: 'primary' };

  it('sends the person picked, but never their display name', () => {
    const params = mailListParams({ ...NONE, participant: 'h@awb.test', participantName: 'Hicham' }, opts);
    expect(params).toEqual({ page: '2', limit: '20', participant: 'h@awb.test' });
  });

  it('sends the Gmail category with the Inbox only', () => {
    expect(mailListParams({ ...NONE, folder: 'inbox' }, opts)).toMatchObject({ folder: 'inbox', category: 'primary' });
    expect(mailListParams({ ...NONE, folder: 'sent' }, opts)).not.toHaveProperty('category');
    expect(mailListParams(NONE, opts)).toEqual({ page: '2', limit: '20' });
  });

  it('sends every filter that is set', () => {
    expect(mailListParams({
      ...NONE, search: 'offre', from: 'a@x.test', to: 'b@x.test', subject: 'Q3', dateAfter: '2026-09-01',
      dateBefore: '2026-09-30', customerIds: ['c1', 'c2'], isRead: 'false', hasAttachment: true,
    }, opts)).toEqual({
      page: '2', limit: '20', search: 'offre', from: 'a@x.test', to: 'b@x.test', subject: 'Q3',
      dateAfter: '2026-09-01', dateBefore: '2026-09-30', customerId: 'c1,c2', isRead: 'false', hasAttachment: 'true',
    });
  });
});
