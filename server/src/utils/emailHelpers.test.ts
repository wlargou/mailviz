import { describe, it, expect } from 'vitest';
import {
  parseEmailAddress,
  parseEmailList,
  extractAttachments,
  extractBody,
  plainTextToHtml,
} from './emailHelpers.js';

/**
 * Header parsing for real mail.
 *
 * Everything here reads bytes we did not write. `parseEmailAddress` and
 * `parseEmailList` feed `emailService.upsertMessage`, which turns each parsed
 * address into a domain, a Customer and a Contact — so a parsing slip does not
 * throw, it silently manufactures junk rows in the CRM that a human then has to
 * find and delete. `parseEmailList` also round-trips Gmail drafts: whatever it
 * returns from a draft's `To:` header is what `draftService.save` puts back on
 * the wire, so a mangled address is a message sent to the wrong place.
 *
 * The shapes below are the ones that actually arrive, not invented ones:
 * Outlook's `"Surname, Given"` display names, bare addresses with no display
 * name, MIME-encoded names, and empty headers.
 */

describe('parseEmailAddress', () => {
  it('splits the common "Display Name <addr>" form', () => {
    expect(parseEmailAddress('John Doe <john@example.com>')).toEqual({
      name: 'John Doe',
      email: 'john@example.com',
    });
  });

  it('lowercases the address but not the display name', () => {
    // Addresses are compared and unique-keyed case-insensitively all over the
    // service layer (`findOrCreateContact`, the outbound check against the
    // account's own address). One un-lowercased header creates a second contact
    // for a person who already exists.
    expect(parseEmailAddress('John DOE <John.DOE@Example.COM>')).toEqual({
      name: 'John DOE',
      email: 'john.doe@example.com',
    });
  });

  it('handles a bare address with no display name', () => {
    expect(parseEmailAddress('john@example.com')).toEqual({ name: null, email: 'john@example.com' });
  });

  it('handles angle brackets with no display name', () => {
    expect(parseEmailAddress('<john@example.com>')).toEqual({ name: null, email: 'john@example.com' });
  });

  it('unquotes a display name that contains a comma', () => {
    // Outlook and most corporate directories write the sender this way. The
    // quotes are syntax, not part of anyone's name.
    expect(parseEmailAddress('"Doe, John" <john@example.com>')).toEqual({
      name: 'Doe, John',
      email: 'john@example.com',
    });
  });

  it('strips single quotes as well as double', () => {
    expect(parseEmailAddress("'Jane Roe' <jane@example.com>").name).toBe('Jane Roe');
  });

  it('drops bracketed classification suffixes from the display name', () => {
    expect(parseEmailAddress('Support Desk [C] <support@example.com>').name).toBe('Support Desk');
  });

  it('returns a null name rather than an empty one when nothing is left', () => {
    // `fromName` is written to Email.fromName and used as a contact's display
    // name. An empty string there renders as a blank row in the UI where the
    // address should have been the fallback.
    expect(parseEmailAddress('[EXTERNAL] <noreply@example.com>').name).toBeNull();
    expect(parseEmailAddress('"" <noreply@example.com>').name).toBeNull();
  });

  it('trims surrounding whitespace off the address', () => {
    expect(parseEmailAddress('   john@example.com   ').email).toBe('john@example.com');
  });

  it('survives an empty header without throwing', () => {
    // `headers['from']` is `|| ''` at the call site, so this is reached on any
    // message with no From at all — bounces and drafts, mostly.
    expect(parseEmailAddress('')).toEqual({ name: null, email: '' });
    expect(parseEmailAddress('    ')).toEqual({ name: null, email: '' });
  });

  it('still recovers the address from a MIME-encoded display name', () => {
    // RFC 2047 words are not decoded — the name stays as the raw token — but
    // the address must still come out clean, because that is what the domain
    // and the contact key are derived from. Getting this wrong files a French
    // or Japanese sender under a garbage domain.
    expect(parseEmailAddress('=?UTF-8?B?SsO2cmc=?= <joerg@example.de>').email).toBe('joerg@example.de');
    expect(parseEmailAddress('=?iso-8859-1?Q?Andr=E9?= <andre@example.fr>').email).toBe('andre@example.fr');
  });
});

describe('parseEmailList', () => {
  it('returns an empty list for a missing or empty header', () => {
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList('')).toEqual([]);
  });

  it('splits multiple recipients and normalises each', () => {
    expect(parseEmailList('Alice <ALICE@example.com>, bob@example.com , Carol <carol@example.com>')).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ]);
  });

  it('does not split inside a quoted display name — REGRESSION', () => {
    // `"Doe, John" <john@example.com>` is what Outlook puts on the wire for a
    // corporate directory entry. A naive split on every comma tore it into
    // `"Doe` and `John" <john@example.com>`, so the recipient list gained a
    // bogus entry `"doe` for every such address. Two consequences, both real:
    // the stored Email.to array is polluted, and — worse — draftService reads a
    // Gmail draft's To: header through this function and hands the result
    // straight back to buildMimeMessage on save, so re-saving a draft addressed
    // to "Doe, John" sent it to a recipient literally named `"doe`.
    expect(parseEmailList('"Doe, John" <john@example.com>, jane@example.com')).toEqual([
      'john@example.com',
      'jane@example.com',
    ]);
  });

  it('does not split inside angle brackets', () => {
    // Rare but legal: a comma inside the addr-spec of a quoted local part.
    expect(parseEmailList('"Odd" <"a,b"@example.com>, plain@example.com')).toEqual([
      '"a,b"@example.com',
      'plain@example.com',
    ]);
  });

  it('handles several quoted names in one header', () => {
    expect(
      parseEmailList('"Doe, John" <john@example.com>, "Roe, Jane" <jane@example.com>, bob@example.com')
    ).toEqual(['john@example.com', 'jane@example.com', 'bob@example.com']);
  });

  it('drops empty segments from trailing or doubled commas', () => {
    // Gmail hands back headers like this on forwarded chains. An empty string
    // in the list becomes a contact with no address if it is not filtered.
    expect(parseEmailList('a@example.com,,b@example.com,')).toEqual(['a@example.com', 'b@example.com']);
    expect(parseEmailList(',')).toEqual([]);
  });

  it('keeps a single recipient with no display name intact', () => {
    expect(parseEmailList('solo@example.com')).toEqual(['solo@example.com']);
  });
});

describe('extractAttachments', () => {
  it('finds attachments nested inside multipart parts', () => {
    // Gmail nests: multipart/mixed → multipart/alternative → parts. A walker
    // that only looked at the top level reported hasAttachment=false on the
    // majority of real mail, hiding the paperclip and the download list.
    const payload = {
      parts: [
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: '' } }] },
        {
          mimeType: 'multipart/mixed',
          parts: [
            {
              filename: 'invoice.pdf',
              mimeType: 'application/pdf',
              body: { attachmentId: 'att-1', size: 1234 },
            },
          ],
        },
      ],
    };

    expect(extractAttachments(payload)).toEqual([
      { filename: 'invoice.pdf', mimeType: 'application/pdf', size: 1234, attachmentId: 'att-1' },
    ]);
  });

  it('ignores inline parts that have no filename', () => {
    // Inline signature images carry an attachmentId but an empty filename.
    // Counting them turns every signed corporate email into "has attachment".
    const payload = {
      parts: [
        { filename: '', mimeType: 'image/png', body: { attachmentId: 'cid-logo', size: 900 } },
        { filename: 'real.txt', mimeType: 'text/plain', body: { attachmentId: 'att-2', size: 10 } },
      ],
    };

    expect(extractAttachments(payload).map((a) => a.filename)).toEqual(['real.txt']);
  });

  it('falls back to a generic type and zero size when Gmail omits them', () => {
    const payload = { parts: [{ filename: 'thing', body: { attachmentId: 'att-3' } }] };

    expect(extractAttachments(payload)).toEqual([
      { filename: 'thing', mimeType: 'application/octet-stream', size: 0, attachmentId: 'att-3' },
    ]);
  });

  it('returns an empty list for a single-part payload', () => {
    expect(extractAttachments({ mimeType: 'text/plain', body: { data: 'aGk' } })).toEqual([]);
    expect(extractAttachments({})).toEqual([]);
  });
});

describe('extractBody', () => {
  const b64url = (s: string) => Buffer.from(s, 'utf-8').toString('base64url');

  it('prefers the HTML alternative over the plain-text one', () => {
    const payload = {
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('plain version') } },
        { mimeType: 'text/html', body: { data: b64url('<p>html version</p>') } },
      ],
    };

    expect(extractBody(payload)).toBe('<p>html version</p>');
  });

  it('decodes Gmail’s URL-safe base64 payload', () => {
    // Gmail returns base64**url**: `-` and `_` where standard base64 has `+`
    // and `/`. The body below is chosen so its encoding contains both.
    //
    // Note what this does NOT prove: Node's decoder accepts both alphabets
    // interchangeably, so swapping 'base64url' for 'base64' in extractBody is
    // invisible to any round-trip assertion. This pins that a URL-safe payload
    // decodes correctly — which is the property callers depend on — not the
    // spelling of the encoding argument.
    const body = '<p>Ã¾Ã¿ ~~~ ???</p>';
    const encoded = Buffer.from(body, 'utf-8').toString('base64url');

    expect(encoded).toMatch(/[-_]/);
    expect(extractBody({ parts: [{ mimeType: 'text/html', body: { data: encoded } }] })).toBe(body);
  });

  it('falls back to plain text, converted to HTML, when there is no HTML part', () => {
    const payload = { parts: [{ mimeType: 'text/plain', body: { data: b64url('line one\nline two') } }] };

    expect(extractBody(payload)).toBe('line one<br>line two');
  });

  it('reaches a body nested two levels down', () => {
    const payload = {
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64url('nested plain') } },
            { mimeType: 'text/html', body: { data: b64url('<b>nested html</b>') } },
          ],
        },
      ],
    };

    expect(extractBody(payload)).toBe('<b>nested html</b>');
  });

  it('reads a single-part message from payload.body', () => {
    expect(extractBody({ mimeType: 'text/html', body: { data: b64url('<i>solo</i>') } })).toBe('<i>solo</i>');
    expect(extractBody({ mimeType: 'text/plain', body: { data: b64url('solo & plain') } })).toBe(
      'solo &amp; plain'
    );
  });

  it('returns null when there is nothing to read', () => {
    // Callers do `extractBody(...) ?? ''` / `|| snippet`, so null is the
    // contract for "no body", not an empty string.
    expect(extractBody({})).toBeNull();
    expect(extractBody({ parts: [{ mimeType: 'application/pdf', body: { attachmentId: 'a' } }] })).toBeNull();
  });
});

describe('plainTextToHtml', () => {
  it('escapes markup before doing anything else', () => {
    // This output is injected into the message viewer. A plain-text email
    // containing a <script> tag must arrive as text, not as a script — the
    // escape has to happen before the linkifier starts writing tags of its own.
    const html = plainTextToHtml('<script>alert("x")</script>');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  it('cannot be tricked into emitting an attribute by a crafted URL', () => {
    const html = plainTextToHtml('https://evil.test/" onmouseover="steal()');

    // The quote is already an entity by the time the href is built, so the
    // attribute cannot be closed early.
    expect(html).not.toContain('onmouseover="steal()"');
    expect(html).toContain('&quot;');
  });

  it('linkifies http(s) urls', () => {
    const html = plainTextToHtml('see https://example.com/docs now');

    expect(html).toContain('<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">');
  });

  it('opens links in a new tab without leaking the opener', () => {
    // `rel="noopener noreferrer"` on a target=_blank link is what stops the
    // opened page reaching back into window.opener.
    expect(plainTextToHtml('https://example.com')).toContain('rel="noopener noreferrer"');
  });

  it('turns bare addresses into mailto links', () => {
    expect(plainTextToHtml('write to bob@example.com')).toContain('<a href="mailto:bob@example.com">');
  });

  it('preserves line breaks', () => {
    expect(plainTextToHtml('a\nb\nc')).toBe('a<br>b<br>c');
  });

  it('leaves ordinary text alone', () => {
    expect(plainTextToHtml('nothing special here')).toBe('nothing special here');
    expect(plainTextToHtml('')).toBe('');
  });

  it('does not nest a mailto inside a url that contains an address', () => {
    // The shape that broke: linkify URLs, then run the address pass over the
    // HTML that produced — and the address in the path gets its own anchor
    // written INSIDE the href, destroying the link. Unsubscribe footers carry
    // the recipient's own address, so this is ordinary mail, not a corner case.
    const html = plainTextToHtml('Stop: https://mail.example.com/u/bob@corp.com/stop');

    expect(html).toBe(
      'Stop: <a href="https://mail.example.com/u/bob@corp.com/stop" ' +
        'target="_blank" rel="noopener noreferrer">https://mail.example.com/u/bob@corp.com/stop</a>'
    );
    // The specific corruption: an anchor opening while an href is still open.
    expect(html).not.toContain('href="https://mail.example.com/u/<a');
    expect(html).not.toContain('mailto:');
  });

  it('keeps a query-string address inside the link', () => {
    const html = plainTextToHtml('https://example.com/verify?email=bob@corp.com&token=1');

    expect(html).toContain('href="https://example.com/verify?email=bob@corp.com&amp;token=1"');
    expect(html).not.toContain('mailto:');
  });

  it('still linkifies an address that follows a url', () => {
    // The single pass must not make the address branch unreachable — a URL
    // earlier in the line is exactly when that regression would hide.
    const html = plainTextToHtml('docs at https://example.com or ask bob@corp.com');

    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('<a href="mailto:bob@corp.com">bob@corp.com</a>');
  });
});
