import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { createUser, createEmail } from '../test/factories.js';
import { createGmailMock, type GmailMock } from '../test/gmailMock.js';
import { emailService } from './emailService.js';

/**
 * What actually leaves the building.
 *
 * Reply and forward both quote a message someone else sent into HTML that goes
 * out over this user's own address, so every header they interpolate is
 * attacker-controllable. The forward block interpolated four of them — sender
 * name, address, subject and recipient list — with no escaping at all.
 *
 * `sanitize-html` runs over the finished body and does strip `<script>` and
 * event handlers, so this was never code execution. What it does not strip is
 * an `<a href>`, an `<img>`, or a `</p>` that closes the block the value sits
 * in — which is enough to put a clickable link of someone else's choosing into
 * a message the recipient sees as coming from this user.
 *
 * These assert on the real MIME body, not on a helper, because the helper was
 * already right — it was the interpolation sites that were not.
 */

vi.mock('../lib/gmail.js', () => ({ getGmailClient: vi.fn() }));

let gmail: GmailMock;

beforeEach(() => {
  gmail = createGmailMock();
  vi.mocked(getGmailClient).mockResolvedValue(gmail.client);
});

/**
 * Just the text/html part of whatever was handed to users.messages.send.
 *
 * Isolating the part matters: the same hostile string also lands in the
 * `Subject:` header of a forward, legitimately and inertly, so searching the
 * whole message finds it there and says nothing about the body. Soft line
 * breaks are unfolded because quoted-printable wraps at 76 columns and would
 * otherwise split the very substrings being asserted on.
 */
function sentHtml(): string {
  expect(gmail.messagesSend).toHaveBeenCalledTimes(1);
  const raw = gmail.messagesSend.mock.calls[0][0].requestBody.raw as string;
  const message = Buffer.from(raw, 'base64url').toString('utf8').replace(/=\r?\n/g, '');

  const start = message.indexOf('Content-Type: text/html');
  expect(start).toBeGreaterThan(-1);
  const body = message.slice(start);
  const end = body.indexOf('\r\n--');
  return end === -1 ? body : body.slice(0, end);
}

async function connected() {
  const user = await createUser();
  await prisma.googleAuth.create({
    data: {
      userId: user.id,
      email: 'me@example.com',
      accessToken: 'a',
      refreshToken: 'r',
      tokenExpiry: new Date(Date.now() + 3_600_000),
    },
  });
  return user;
}

const HOSTILE = '</p><a href="https://evil.example">Click</a><b>x</b>';

describe('forwardEmail — quoting a hostile message', () => {
  it('renders the original subject as text, not as markup', async () => {
    const user = await connected();
    const email = await createEmail(user.id, { subject: HOSTILE, from: 'them@other.test' });

    await emailService.forwardEmail(email.id, { to: ['you@x.test'], htmlBody: '<p>fyi</p>' }, user.id);

    const html = sentHtml();
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain('&lt;a href=');
  });

  it('renders a hostile sender name and recipient list as text', async () => {
    const user = await connected();
    const email = await createEmail(user.id, { subject: 'ordinary', from: 'them@other.test' });
    await prisma.email.update({
      where: { id: email.id },
      data: { fromName: HOSTILE, to: [HOSTILE, 'real@x.test'] },
    });

    await emailService.forwardEmail(email.id, { to: ['you@x.test'], htmlBody: '<p>fyi</p>' }, user.id);

    const html = sentHtml();
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain('&lt;a href=');
  });

  it('still shows an ordinary ampersand as an ampersand', async () => {
    // The other half-fix to avoid. Escaping the stored value without decoding
    // it first turns Gmail's `&amp;` into `&amp;amp;`, which the recipient
    // reads as the literal text "&amp;" — safe, and wrong.
    const user = await connected();
    const email = await createEmail(user.id, { subject: 'Ben &amp; Co', from: 'them@other.test' });

    await emailService.forwardEmail(email.id, { to: ['you@x.test'], htmlBody: '<p>fyi</p>' }, user.id);

    const html = sentHtml();
    expect(html).toContain('Subject: Ben &amp; Co');
    expect(html).not.toContain('&amp;amp;');
  });
});

describe('replyToEmail — quoting a hostile sender', () => {
  it('renders a hostile display name as text, not as markup', async () => {
    const user = await connected();
    const email = await createEmail(user.id, { subject: 'ordinary', from: 'them@other.test' });
    await prisma.email.update({ where: { id: email.id }, data: { fromName: HOSTILE } });

    await emailService.replyToEmail(email.id, { htmlBody: '<p>thanks</p>' }, user.id);

    const html = sentHtml();
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain('&lt;a href=');
  });
});
