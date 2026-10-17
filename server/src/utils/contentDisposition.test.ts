import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { contentDisposition } from './contentDisposition.js';

describe('contentDisposition', () => {
  it('keeps the exact name in filename*, and an ASCII stand-in for the rest', () => {
    expect(contentDisposition('inline', 'Attestation d’exécution – CMI.pdf')).toBe(
      `inline; filename="Attestation d_execution _ CMI.pdf"; filename*=UTF-8''Attestation%20d%E2%80%99ex%C3%A9cution%20%E2%80%93%20CMI.pdf`,
    );
    expect(contentDisposition('attachment', 'Avis AO 70.pdf')).toBe(`attachment; filename="Avis AO 70.pdf"; filename*=UTF-8''Avis%20AO%2070.pdf`);
  });

  it('lets no quote, backslash or line break through to split the header', () => {
    const header = contentDisposition('attachment', 'a"b\\c\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/"/g)).toHaveLength(2);
    expect(header).toContain(`filename*=UTF-8''a%22b%5Cc%0D%0ASet-Cookie%3A%20x%3D1.pdf`);
  });

  it('is a value Node accepts as a header — REGRESSION', () => {
    // The raw name in a quoted string threw ERR_INVALID_CHAR for anything above U+00FF.
    const res = new http.ServerResponse(new http.IncomingMessage(null as never));
    for (const name of ['Attestation d’exécution – CMI.pdf', 'شهادة مرجعية.pdf', '“quoted”.pdf', '']) {
      expect(() => res.setHeader('Content-Disposition', contentDisposition('inline', name))).not.toThrow();
    }
  });
});
