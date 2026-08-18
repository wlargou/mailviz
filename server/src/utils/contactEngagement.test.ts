import { describe, it, expect } from 'vitest';
import { mergeEngagement, engagementFrom } from './contactEngagement.js';

/**
 * Engagement only ever widens.
 *
 * That is the property worth pinning: a mailbox syncs a window of history, so
 * re-deriving from what is currently stored must never downgrade someone who
 * wrote to you two years ago.
 */

describe('mergeEngagement', () => {
  it.each([
    ['none', 'sender', 'sender'],
    ['none', 'receiver', 'receiver'],
    ['sender', 'receiver', 'both'],
    ['receiver', 'sender', 'both'],
  ])('%s + %s = %s', (current, observed, expected) => {
    expect(mergeEngagement(current, observed as 'sender' | 'receiver')).toBe(expected);
  });

  it.each([
    ['sender', 'sender'],
    ['receiver', 'receiver'],
  ])('%s is unchanged by seeing the same direction again', (current, observed) => {
    expect(mergeEngagement(current, observed as 'sender' | 'receiver')).toBe(current);
  });

  it.each([['sender'], ['receiver']])('both is never narrowed by a %s signal', (observed) => {
    expect(mergeEngagement('both', observed as 'sender' | 'receiver')).toBe('both');
  });

  it.each([[null], [undefined], [''], ['nonsense']])(
    'treats %s as none rather than trusting it',
    (current) => {
      expect(mergeEngagement(current as string | null, 'sender')).toBe('sender');
    }
  );
});

describe('engagementFrom', () => {
  it.each([
    [true, true, 'both'],
    [true, false, 'sender'],
    [false, true, 'receiver'],
    [false, false, 'none'],
  ])('sent=%s received=%s => %s', (sent, received, expected) => {
    expect(engagementFrom(sent, received)).toBe(expected);
  });
});
