import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rfpsApi } from './rfps';
import { api } from './client';

vi.mock('./client', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

/**
 * The upload is the one call in this app that does not send JSON.
 *
 * The shared axios client sets `Content-Type: application/json` on every
 * request, which on a FormData body is fatal and completely silent: no
 * multipart boundary is generated, so multer finds no file and the server
 * answers 400 NO_FILE while the browser shows a perfectly normal request.
 */
describe('rfpsApi.uploadDocument', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends multipart, letting the browser set the boundary', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { data: {} } } as never);

    await rfpsApi.uploadDocument('r1', new File(['%PDF'], 'CPS.pdf', { type: 'application/pdf' }), 'AVIS');

    const [url, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/rfps/r1/documents');
    expect(body).toBeInstanceOf(FormData);
    // Undefined, not absent: absent would leave the client's JSON default in
    // place, which is the bug this pins.
    expect(config?.headers).toHaveProperty('Content-Type', undefined);

    const form = body as FormData;
    expect(form.get('kind')).toBe('AVIS');
    expect((form.get('file') as File).name).toBe('CPS.pdf');
  });
});
