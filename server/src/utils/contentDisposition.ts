/**
 * A Content-Disposition header that survives any filename.
 *
 * Node refuses a header carrying a character above U+00FF, and throws: the
 * browser sends filenames in UTF-8, so "Attestation d’exécution – CMI.pdf"
 * (a curly apostrophe, an en dash) turned every preview and download of it
 * into a 500. The name goes out twice, per RFC 6266: an ASCII stand-in for
 * old clients, and the exact name percent-encoded in `filename*`, which every
 * current browser reads first. Quotes, backslashes and line breaks — the
 * header-injection characters — cannot survive either form.
 */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const fallback =
    filename
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download';
  // encodeURIComponent leaves ' ( ) * alone, which RFC 5987 does not allow raw.
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
