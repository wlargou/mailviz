import { describe, it, expect } from 'vitest';
import { queryWords, likePattern } from './searchTerms.js';

describe('queryWords', () => {
  it('splits on any whitespace, and keeps at most five words', () => {
    expect(queryWords('  omar\t alami \n')).toEqual(['omar', 'alami']);
    expect(queryWords('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(queryWords('   ')).toEqual([]);
  });
});

describe('likePattern', () => {
  it('wraps a term in wildcards and escapes the ones typed', () => {
    expect(likePattern('omar')).toBe('%omar%');
    expect(likePattern('50%_\\')).toBe('%50\\%\\_\\\\%');
  });
});
