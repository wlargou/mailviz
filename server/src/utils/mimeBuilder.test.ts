import { describe, it, expect } from 'vitest';
import { buildMimeMessage } from './mimeBuilder.js';

/**
 * The outgoing message itself.
 *
 * Everything this module produces is handed to `gmail.users.messages.send` as a
 * single `raw` string, and Gmail derives the envelope — who actually receives
 * the mail — from the headers inside it. There is no second chance and no
 * error: a header this builder gets wrong is a message the user has already
 * sent, wrongly, and cannot unsend. That is why the assertions below decode the
 * built message and read it back rather than checking that the builder was
 * called with the right arguments.
 *
 * The decoding helpers are deliberately local and dumb — enough MIME to read
 * what we just wrote, no library that might share a bug with the writer.
 */

/** Decode the `raw` field back into the message text. */
function decodeMessage(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf-8');
}

function headerBlock(section: string): string {
  const end = section.indexOf('\r\n\r\n');
  return end === -1 ? section : section.slice(0, end);
}

function bodyBlock(section: string): string {
  const end = section.indexOf('\r\n\r\n');
  return end === -1 ? '' : section.slice(end + 4);
}

/** Read a header, undoing RFC 5322 folding so the value comes back whole. */
function header(section: string, name: string): string | null {
  const unfolded = headerBlock(section).replace(/\r\n[ \t]+/g, ' ');
  const line = unfolded
    .split('\r\n')
    .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : null;
}

function contentType(section: string): string {
  return header(section, 'Content-Type') ?? '';
}

/** Split a multipart section into its child sections; [] if it is a leaf. */
function childParts(section: string): string[] {
  const boundary = /boundary="([^"]+)"/.exec(contentType(section))?.[1];
  if (!boundary) return [];
  return bodyBlock(section)
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => part.replace(/^\r\n/, '').replace(/\r\n$/, ''));
}

function leafParts(section: string): string[] {
  const children = childParts(section);
  return children.length === 0 ? [section] : children.flatMap(leafParts);
}

function findLeaf(message: string, mimeType: string): string {
  const found = leafParts(message).find((p) => contentType(p).toLowerCase().startsWith(mimeType));
  if (!found) {
    throw new Error(
      `no ${mimeType} part; got ${leafParts(message).map(contentType).join(' | ')}`
    );
  }
  return found;
}

function decodeQuotedPrintable(text: string): Buffer {
  const joined = text.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** A part's content, with its transfer encoding undone. */
function partContent(section: string): Buffer {
  const encoding = (header(section, 'Content-Transfer-Encoding') ?? '7bit').toLowerCase();
  const body = bodyBlock(section);
  if (encoding === 'base64') return Buffer.from(body.replace(/\r\n/g, ''), 'base64');
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  return Buffer.from(body, 'utf-8');
}

function partText(section: string): string {
  return partContent(section).toString('utf-8').trim();
}

/** Undo RFC 2047 encoded words so a header value can be compared to what we asked for. */
function decodeEncodedWords(value: string): string {
  // Whitespace separating two adjacent encoded words is a fold, not content —
  // RFC 2047 §6.2 says to drop it before decoding.
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(
    /=\?[^?]+\?([QqBb])\?([^?]*)\?=/g,
    (_match, encoding: string, text: string) => {
      if (encoding.toUpperCase() === 'B') return Buffer.from(text, 'base64').toString('utf-8');
      return decodeQuotedPrintable(text.replace(/_/g, ' ')).toString('utf-8');
    }
  );
}

const BASE: Parameters<typeof buildMimeMessage>[0] = {
  from: 'me@example.com',
  to: ['alice@example.com'],
  subject: 'Hello',
  htmlBody: '<p>Hello</p>',
};

describe('buildMimeMessage — transport encoding', () => {
  it('returns base64url, the only alphabet Gmail accepts in `raw`', async () => {
    // Standard base64 contains + / and =, which are not valid in the JSON `raw`
    // field; Gmail answers 400 and the send fails outright.
    const raw = await buildMimeMessage(BASE);

    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('carries every recipient into a folded To: header', async () => {
    // The 998-octet limit is nodemailer's to enforce and nothing in
    // buildMimeMessage can violate it — the previous assertion measured a
    // 62-character longest line against a 998 bound and could never fail.
    // What IS ours is that all 25 addresses reach the header at all.
    const recipients = Array.from(
      { length: 25 },
      (_, i) => `recipient-number-${i}@quite-long-domain.example.com`
    );
    const raw = await buildMimeMessage({ ...BASE, to: recipients });

    const message = decodeMessage(raw);
    for (const address of recipients) {
      expect(message).toContain(address);
    }
    // Folded, not one enormous line: continuation lines start with whitespace.
    expect(message).toMatch(/^To: [\s\S]*?\r\n\s+recipient-number-/m);
    for (const line of message.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
  });
});

describe('buildMimeMessage — CSS inlining', () => {
  it('inlines a <style> block into the elements it targets', async () => {
    // Mail clients discard <style> blocks; inline attributes are the only
    // styling Gmail and Outlook reliably honour. This is the whole reason juice
    // is in the pipeline.
    const raw = await buildMimeMessage({
      ...BASE,
      htmlBody: '<style>.brand { color: #ff0000; }</style><p class="brand">Hello</p>',
    });

    const message = decodeMessage(raw).replace(/=\r?\n/g, '');
    expect(message).toMatch(/style="[^"]*color/);
    // The tag itself must not survive — juice runs with removeStyleTags, and
    // sanitise drops it regardless.
    expect(message).not.toContain('<style');
  });

  it('still sanitises what inlining produces', async () => {
    // Inlining runs first, so sanitising has the last word. If that order is
    // ever flipped back, this is what fails rather than a silent XSS.
    const raw = await buildMimeMessage({
      ...BASE,
      htmlBody:
        '<style>.x { color: red; }</style><script>alert(1)</script>' +
        '<p class="x" onclick="evil()">Hi</p><a href="javascript:alert(1)">click</a>',
    });

    const message = decodeMessage(raw).replace(/=\r?\n/g, '');
    expect(message).not.toContain('<script');
    expect(message).not.toContain('onclick');
    expect(message).not.toContain('javascript:');
  });
});

describe('buildMimeMessage — addressing', () => {
  it('writes From, To, Cc on the message', async () => {
    const raw = await buildMimeMessage({
      ...BASE,
      to: ['alice@example.com', 'bob@example.com'],
      cc: ['carol@example.com'],
    });
    const message = decodeMessage(raw);

    expect(header(message, 'From')).toBe('me@example.com');
    expect(header(message, 'To')).toBe('alice@example.com, bob@example.com');
    expect(header(message, 'Cc')).toBe('carol@example.com');
  });

  it('writes a Bcc header so blind recipients actually receive the mail — REGRESSION', async () => {
    // Gmail's messages.send({raw}) takes the recipient list from the headers of
    // the message it is given; there is no separate envelope. Nodemailer's
    // MimeNode strips Bcc by default because an SMTP transport supplies the
    // envelope itself — correct there, silently wrong here. Without this,
    // everyone Bcc'd on a message sent from mailviz got nothing, the send
    // returned 200, and the compose window showed the address as sent.
    const raw = await buildMimeMessage({ ...BASE, bcc: ['secret@example.com'] });
    const message = decodeMessage(raw);

    expect(header(message, 'Bcc')).toBe('secret@example.com');
  });

  it('keeps all three recipient lists separate', async () => {
    const raw = await buildMimeMessage({
      ...BASE,
      to: ['to@example.com'],
      cc: ['cc@example.com'],
      bcc: ['bcc1@example.com', 'bcc2@example.com'],
    });
    const message = decodeMessage(raw);

    expect(header(message, 'To')).toBe('to@example.com');
    expect(header(message, 'Cc')).toBe('cc@example.com');
    expect(header(message, 'Bcc')).toBe('bcc1@example.com, bcc2@example.com');
  });

  it('omits Cc and Bcc entirely when they are empty', async () => {
    // An empty `Cc:` header is not just untidy — some receivers reject it.
    const message = decodeMessage(await buildMimeMessage({ ...BASE, cc: [], bcc: [] }));

    expect(header(message, 'Cc')).toBeNull();
    expect(header(message, 'Bcc')).toBeNull();
  });
});

describe('buildMimeMessage — threading', () => {
  it('carries In-Reply-To and References when replying', async () => {
    // These two headers are the entire reason a reply lands in its thread in
    // the recipient's client rather than starting a new one.
    const message = decodeMessage(
      await buildMimeMessage({
        ...BASE,
        inReplyTo: '<parent@mail.example.com>',
        references: '<root@mail.example.com> <parent@mail.example.com>',
      })
    );

    expect(header(message, 'In-Reply-To')).toBe('<parent@mail.example.com>');
    expect(header(message, 'References')).toBe(
      '<root@mail.example.com> <parent@mail.example.com>'
    );
  });

  it('omits them on a fresh message', async () => {
    const message = decodeMessage(await buildMimeMessage(BASE));

    expect(header(message, 'In-Reply-To')).toBeNull();
    expect(header(message, 'References')).toBeNull();
  });
});

describe('buildMimeMessage — subject', () => {
  it('MIME-encodes a non-ASCII subject and it decodes back unchanged', async () => {
    // Raw UTF-8 bytes in a header are illegal; what arrives is either a
    // rejected send or a subject line of mojibake in the recipient's inbox.
    const subject = 'Réunion — café ☕ 会議';
    const message = decodeMessage(await buildMimeMessage({ ...BASE, subject }));
    const encoded = header(message, 'Subject') ?? '';

    expect(encoded).toMatch(/^=\?UTF-8\?/i);
    expect(decodeEncodedWords(encoded)).toBe(subject);
  });

  it('leaves a plain ASCII subject readable', async () => {
    const message = decodeMessage(await buildMimeMessage({ ...BASE, subject: 'Quarterly review' }));

    expect(header(message, 'Subject')).toBe('Quarterly review');
  });

  it('folds and round-trips a very long subject', async () => {
    const subject = `Re: ${'a very long thread title '.repeat(12)}end`;
    const message = decodeMessage(await buildMimeMessage({ ...BASE, subject }));

    expect(decodeEncodedWords(header(message, 'Subject') ?? '')).toBe(subject);
  });
});

describe('buildMimeMessage — html and plain-text alternatives', () => {
  it('sends both a text/plain and a text/html alternative', async () => {
    // Text-only clients and, more importantly, spam filters treat an
    // HTML-only message as a signal. Losing the plain part does not break
    // sending, it quietly costs deliverability.
    const message = decodeMessage(
      await buildMimeMessage({ ...BASE, htmlBody: '<p>Hello there</p>' })
    );

    expect(contentType(message)).toContain('multipart/alternative');
    expect(partText(findLeaf(message, 'text/plain'))).toBe('Hello there');
    expect(partText(findLeaf(message, 'text/html'))).toContain('<p>Hello there</p>');
  });

  it('renders links, lists and breaks into readable plain text', async () => {
    const html =
      '<p>Hi <a href="https://example.com/docs">the docs</a></p><ul><li>one</li><li>two</li></ul>';
    const message = decodeMessage(await buildMimeMessage({ ...BASE, htmlBody: html }));
    const plain = partText(findLeaf(message, 'text/plain'));

    // A link whose href is dropped leaves the plain-text reader with nothing.
    expect(plain).toContain('the docs (https://example.com/docs)');
    expect(plain).toContain('- one');
    expect(plain).toContain('- two');
    expect(plain).not.toContain('<');
  });

  it('decodes entities in the plain-text part', async () => {
    const message = decodeMessage(
      await buildMimeMessage({ ...BASE, htmlBody: '<p>Tom &amp; Jerry &lt;3</p>' })
    );

    expect(partText(findLeaf(message, 'text/plain'))).toBe('Tom & Jerry <3');
  });

  it('round-trips non-ASCII body content in both alternatives', async () => {
    const message = decodeMessage(
      await buildMimeMessage({ ...BASE, htmlBody: '<p>Déjà vu — 会議 ☕</p>' })
    );

    expect(partText(findLeaf(message, 'text/plain'))).toBe('Déjà vu — 会議 ☕');
    expect(partText(findLeaf(message, 'text/html'))).toContain('Déjà vu — 会議 ☕');
    expect(contentType(findLeaf(message, 'text/html')).toLowerCase()).toContain('charset=utf-8');
  });
});

describe('buildMimeMessage — sanitisation', () => {
  it('strips script tags and event handlers from the sent HTML', async () => {
    // The sanitiser runs on the way out, not only on the way in. Whatever the
    // compose editor or a quoted reply smuggled in must not be relayed to the
    // recipient over the user's own signature.
    const message = decodeMessage(
      await buildMimeMessage({
        ...BASE,
        htmlBody:
          '<p onclick="steal()">text</p><script>fetch("//evil.test")</script><img src="https://ok.test/a.png" onerror="steal()">',
      })
    );
    const html = partText(findLeaf(message, 'text/html'));

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
    expect(html).toContain('<p>text</p>');
  });

  it('drops javascript: urls but keeps http, https and mailto', async () => {
    const message = decodeMessage(
      await buildMimeMessage({
        ...BASE,
        htmlBody:
          '<a href="javascript:steal()">bad</a><a href="https://ok.test">good</a><a href="mailto:x@ok.test">mail</a>',
      })
    );
    const html = partText(findLeaf(message, 'text/html'));

    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://ok.test"');
    expect(html).toContain('href="mailto:x@ok.test"');
  });

  it('keeps the formatting tags a composed email is actually made of', async () => {
    const message = decodeMessage(
      await buildMimeMessage({
        ...BASE,
        htmlBody:
          '<h2>Title</h2><p><strong>bold</strong> <em>italic</em></p><blockquote>quoted</blockquote><table><tr><td colspan="2">cell</td></tr></table><span style="color:#f00">red</span>',
      })
    );
    const html = partText(findLeaf(message, 'text/html'));

    for (const fragment of ['<h2>', '<strong>', '<em>', '<blockquote>', '<td colspan="2">', 'style="color:#f00"']) {
      expect(html, `sanitiser dropped ${fragment}`).toContain(fragment);
    }
  });
});

describe('buildMimeMessage — attachments', () => {
  it('carries the attachment bytes through unchanged', async () => {
    // The content arrives base64 from the client, is decoded to a Buffer, and
    // is re-encoded by the composer. Any mix-up in that chain — treating it as
    // utf-8, double-encoding — produces a file the recipient cannot open, and
    // nothing upstream notices.
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0x00, 0x01, 0x80]);
    const message = decodeMessage(
      await buildMimeMessage({
        ...BASE,
        attachments: [
          { filename: 'report.pdf', content: bytes.toString('base64'), contentType: 'application/pdf' },
        ],
      })
    );
    const part = findLeaf(message, 'application/pdf');

    expect(partContent(part).equals(bytes)).toBe(true);
    expect(header(part, 'Content-Transfer-Encoding')).toBe('base64');
  });

  it('marks the attachment as an attachment and keeps its filename', async () => {
    const message = decodeMessage(
      await buildMimeMessage({
        ...BASE,
        attachments: [
          { filename: 'notes.txt', content: Buffer.from('hi').toString('base64'), contentType: 'text/plain' },
        ],
      })
    );
    // text/plain matches the body part too, so look at the disposition instead.
    const part = leafParts(message).find((p) =>
      (header(p, 'Content-Disposition') ?? '').includes('attachment')
    );

    expect(part).toBeDefined();
    expect(header(part ?? '', 'Content-Disposition')).toContain('notes.txt');
    expect(partContent(part ?? '').toString('utf-8')).toBe('hi');
  });

  it('nests the alternatives inside a mixed part when there is an attachment', async () => {
    // Flattening this — attachment as a sibling of text/plain and text/html —
    // makes clients show the attachment as the message body.
    const message = decodeMessage(
      await buildMimeMessage({
        ...BASE,
        attachments: [
          { filename: 'a.txt', content: Buffer.from('a').toString('base64'), contentType: 'text/plain' },
        ],
      })
    );

    expect(contentType(message)).toContain('multipart/mixed');
    expect(childParts(message).some((p) => contentType(p).includes('multipart/alternative'))).toBe(true);
  });

  it('escapes a non-ASCII filename instead of putting raw bytes in a header', async () => {
    const message = decodeMessage(
      await buildMimeMessage({
        ...BASE,
        attachments: [
          {
            filename: 'rapport-févr.pdf',
            content: Buffer.from('x').toString('base64'),
            contentType: 'application/pdf',
          },
        ],
      })
    );
    const part = findLeaf(message, 'application/pdf');
    const disposition = header(part, 'Content-Disposition') ?? '';

    expect(disposition).not.toContain('févr');
    // RFC 2231 percent-encoding, or an RFC 2047 word — either is legal, raw
    // UTF-8 in the header is not.
    expect(disposition + contentType(part)).toMatch(/(utf-8''|=\?UTF-8\?)/i);
  });

  it('sends several attachments, each with its own type', async () => {
    const message = decodeMessage(
      await buildMimeMessage({
        ...BASE,
        attachments: [
          { filename: 'a.pdf', content: Buffer.from('aaa').toString('base64'), contentType: 'application/pdf' },
          { filename: 'b.png', content: Buffer.from('bbb').toString('base64'), contentType: 'image/png' },
        ],
      })
    );

    expect(partContent(findLeaf(message, 'application/pdf')).toString()).toBe('aaa');
    expect(partContent(findLeaf(message, 'image/png')).toString()).toBe('bbb');
  });

  it('produces a plain alternative-only message when there are no attachments', async () => {
    const message = decodeMessage(await buildMimeMessage({ ...BASE, attachments: [] }));

    expect(contentType(message)).toContain('multipart/alternative');
  });
});

describe('the plain-text alternative does not double-decode', () => {
  it('leaves an escaped entity escaped', async () => {
    // The chained-replace form this file used to carry substituted `&amp;`
    // first, then re-substituted the `&lt;` it had just produced — so a body
    // quoting escaped markup arrived in the text/plain part as live-looking
    // tags. One regex pass cannot do that: each match is consumed once.
    const message = decodeMessage(
      await buildMimeMessage({ ...BASE, htmlBody: '<p>Tom &amp;lt;3</p>' })
    );

    expect(partText(findLeaf(message, 'text/plain'))).toBe('Tom &lt;3');
  });
});
