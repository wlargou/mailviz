import { describe, it, expect } from 'vitest';
import { foldQuotedHistory, QUOTED_ATTR } from './mailQuotes';

/**
 * Where quoted history starts, per client — the markup below is the shape
 * each client really sends (from the mail in this app), trimmed. Pinned:
 * the reply stays visible, everything from the history on is marked, and a
 * forward or a message that is nothing but quote is left alone.
 */

function parts(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const hidden = [...doc.querySelectorAll(`[${QUOTED_ATTR}]`)].map((e) => e.textContent ?? '').join(' ');
  doc.querySelectorAll(`[${QUOTED_ATTR}]`).forEach((e) => e.remove());
  return { shown: (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim(), hidden: hidden.replace(/\s+/g, ' ').trim() };
}

describe('foldQuotedHistory', () => {
  it('folds Outlook on the web from the separator on', () => {
    const html = `
      <div class="elementToProof">Bonjour Hicham, voici le plan.</div>
      <div class="elementToProof">Cordialement</div>
      <div id="appendonsend"></div>
      <hr style="display:inline-block;width:98%">
      <div id="divRplyFwdMsg" dir="ltr"><b>De :</b> Hicham<br><b>Objet :</b> Fichier PEP</div>
      <div>Bonjour, merci de transmettre le fichier PEP.</div>`;
    const { html: out, folded } = foldQuotedHistory(html, 'RE: Fichier PEP');
    expect(folded).toBe(true);
    const { shown, hidden } = parts(out);
    expect(shown).toBe('Bonjour Hicham, voici le plan. Cordialement');
    expect(hidden).toContain('De : Hicham');
    expect(hidden).toContain('merci de transmettre');
    // The separator rule goes with it, not left hanging under the reply.
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect(doc.querySelector('hr')?.hasAttribute(QUOTED_ATTR)).toBe(true);
  });

  it('folds Outlook desktop from its ruled header, whatever wraps it', () => {
    const html = `
      <div class="WordSection1">
        <p class="MsoNormal">Merci, bien reçu.</p>
        <div><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm">
          <p class="MsoNormal"><b>From:</b> Omar <b>Sent:</b> Monday</p>
        </div></div>
        <p class="MsoNormal">Earlier message text</p>
      </div>`;
    const { shown, hidden } = parts(foldQuotedHistory(html, 'RE: x').html);
    expect(shown).toBe('Merci, bien reçu.');
    expect(hidden).toContain('From: Omar');
    expect(hidden).toContain('Earlier message text');
  });

  it("folds Gmail's quote, attribution included", () => {
    const html = `<div dir="ltr">Sounds good.</div><br>
      <div class="gmail_quote"><div class="gmail_attr">On Mon, Omar wrote:<br></div>
      <blockquote class="gmail_quote">The original</blockquote></div>`;
    const { shown, hidden } = parts(foldQuotedHistory(html, 'Re: plan').html);
    expect(shown).toBe('Sounds good.');
    expect(hidden).toBe('On Mon, Omar wrote: The original');
  });

  it("folds Apple Mail's cite with the line that introduces it", () => {
    const html = `<div>Yes.</div><div>On 2 Sep, Omar wrote:</div><blockquote type="cite">Can we meet?</blockquote>`;
    const { shown, hidden } = parts(foldQuotedHistory(html, 'Re: meet').html);
    expect(shown).toBe('Yes.');
    expect(hidden).toBe('On 2 Sep, Omar wrote: Can we meet?');
  });

  it('folds text that trails the history at the top level too', () => {
    const html = `Short answer<div class="gmail_quote">old</div> trailing old text`;
    const { shown, hidden } = parts(foldQuotedHistory(html, 'Re: x').html);
    expect(shown).toBe('Short answer');
    expect(hidden).toBe('old trailing old text');
  });

  it('takes the earliest marker when a reply quotes a reply', () => {
    const html = `<p>New</p><div class="gmail_quote">Middle<div id="divRplyFwdMsg">Oldest header</div><p>Oldest</p></div>`;
    const { shown } = parts(foldQuotedHistory(html, 'Re: x').html);
    expect(shown).toBe('New');
  });

  it('leaves a forward alone: the forwarded mail is the message', () => {
    const html = `<p>FYI</p><div class="gmail_quote">---------- Forwarded message --------- The offer</div>`;
    for (const subject of ['Fwd: offer', 'TR: offre', 'FW: offer']) {
      expect(foldQuotedHistory(html, subject)).toEqual({ html, folded: false });
    }
  });

  it('leaves a message that is all quote alone, and one with no quote', () => {
    const allQuote = `<div class="gmail_quote">only history</div>`;
    expect(foldQuotedHistory(allQuote, 'Re: x').folded).toBe(false);
    const plain = `<p>Just a message</p>`;
    expect(foldQuotedHistory(plain, 'Hello')).toEqual({ html: plain, folded: false });
  });

  it('does not count a style or script block as the reply', () => {
    // Inside the body: leading, the parser would move them to <head>.
    const style = `<div><style>p { color: red }</style></div><div class="gmail_quote">only history</div>`;
    expect(foldQuotedHistory(style, 'Re: x').folded).toBe(false);
    const script = `<div><script>var x = 1</script></div><div class="gmail_quote">only history</div>`;
    expect(foldQuotedHistory(script, 'Re: x').folded).toBe(false);
  });
});
