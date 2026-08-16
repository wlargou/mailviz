import { vi, type Mock } from 'vitest';
import type { gmail_v1 } from 'googleapis';

/**
 * A fake Gmail client for the sync and batch tests.
 *
 * The seam is `lib/gmail.ts#getGmailClient` — every Gmail call in the app is
 * routed through it (that is also where the per-user rate limiter is applied),
 * so mocking that one module replaces the entire Google surface without any
 * production code knowing. Tests do `vi.mock('../lib/gmail.js')` and hand back
 * `createGmailMock().client`.
 *
 * The fake only implements the endpoints emailService actually reaches for.
 * The cast to `gmail_v1.Gmail` is deliberate and goes through `unknown`:
 * googleapis' generated client has hundreds of resources, and a partial fake is
 * exactly what we want — a test that starts calling an unstubbed endpoint
 * should fail loudly rather than silently receive an empty object.
 */

export interface GmailMock {
  client: gmail_v1.Gmail;
  messagesList: Mock;
  messagesGet: Mock;
  messagesModify: Mock;
  messagesTrash: Mock;
  messagesUntrash: Mock;
  historyList: Mock;
  getProfile: Mock;
  threadsGet: Mock;
}

export function createGmailMock(): GmailMock {
  const messagesList = vi.fn().mockResolvedValue({ data: { messages: [] } });
  const messagesGet = vi.fn().mockResolvedValue({ data: gmailMessage({ id: 'unstubbed' }) });
  const messagesModify = vi.fn().mockResolvedValue({ data: {} });
  const messagesTrash = vi.fn().mockResolvedValue({ data: {} });
  const messagesUntrash = vi.fn().mockResolvedValue({ data: {} });
  const historyList = vi.fn().mockResolvedValue({ data: { history: [] } });
  const getProfile = vi.fn().mockResolvedValue({ data: { emailAddress: 'me@example.com', historyId: '1' } });
  const threadsGet = vi.fn().mockResolvedValue({ data: { messages: [] } });

  const client = {
    users: {
      messages: {
        list: messagesList,
        get: messagesGet,
        modify: messagesModify,
        trash: messagesTrash,
        untrash: messagesUntrash,
      },
      history: { list: historyList },
      threads: { get: threadsGet },
      getProfile,
    },
  } as unknown as gmail_v1.Gmail;

  return {
    client,
    messagesList,
    messagesGet,
    messagesModify,
    messagesTrash,
    messagesUntrash,
    historyList,
    getProfile,
    threadsGet,
  };
}

// ── Request-shape helpers ────────────────────────────────────────────────────

/** The subset of `users.messages.list` params the assertions care about. */
export interface MessagesListParams {
  userId?: string;
  q?: string;
  maxResults?: number;
  pageToken?: string;
}

/** The subset of `users.history.list` params the assertions care about. */
export interface HistoryListParams {
  userId?: string;
  startHistoryId?: string;
  historyTypes?: string[];
  pageToken?: string;
}

export interface ModifyParams {
  userId?: string;
  id?: string;
  requestBody?: { addLabelIds?: string[]; removeLabelIds?: string[] };
}

export interface MessageIdParams {
  userId?: string;
  id?: string;
}

function firstArg<T>(mock: Mock, callIndex: number): T {
  const call: unknown[] | undefined = mock.mock.calls[callIndex];
  if (!call) throw new Error(`Expected the mock to have been called at least ${callIndex + 1} time(s)`);
  return call[0] as T;
}

export const listParams = (mock: Mock, callIndex = 0): MessagesListParams =>
  firstArg<MessagesListParams>(mock, callIndex);

export const historyParams = (mock: Mock, callIndex = 0): HistoryListParams =>
  firstArg<HistoryListParams>(mock, callIndex);

export const modifyParams = (mock: Mock, callIndex = 0): ModifyParams =>
  firstArg<ModifyParams>(mock, callIndex);

/** Every message id a mock was called with, in call order. */
export function calledMessageIds(mock: Mock): string[] {
  return mock.mock.calls.map((call: unknown[]) => (call[0] as MessageIdParams)?.id ?? '');
}

// ── Response builders ────────────────────────────────────────────────────────

export interface FakeMessage {
  id: string;
  threadId?: string;
  subject?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  labelIds?: string[];
  snippet?: string;
  /** Epoch milliseconds; Gmail sends this as a string. */
  internalDate?: number;
}

/** A `users.messages.get` payload, shaped the way Gmail returns `format: 'full'`. */
export function gmailMessage(msg: FakeMessage): gmail_v1.Schema$Message {
  const headers: gmail_v1.Schema$MessagePartHeader[] = [
    { name: 'Subject', value: msg.subject ?? `Subject ${msg.id}` },
    { name: 'From', value: msg.from ?? `sender-${msg.id}@example.com` },
    { name: 'To', value: (msg.to ?? ['me@example.com']).join(', ') },
    { name: 'Message-ID', value: `<${msg.id}@mail.example.com>` },
  ];
  if (msg.cc?.length) headers.push({ name: 'Cc', value: msg.cc.join(', ') });

  return {
    id: msg.id,
    threadId: msg.threadId ?? `thread-${msg.id}`,
    labelIds: msg.labelIds ?? ['INBOX'],
    snippet: msg.snippet ?? `Snippet for ${msg.id}`,
    internalDate: String(msg.internalDate ?? Date.UTC(2024, 0, 1)),
    sizeEstimate: 1024,
    payload: { mimeType: 'text/plain', headers, body: { size: 0 } },
  };
}

/** One page of `users.messages.list`. */
export function listPage(ids: string[], nextPageToken?: string) {
  return {
    data: {
      messages: ids.map((id) => ({ id, threadId: `thread-${id}` })),
      ...(nextPageToken ? { nextPageToken } : {}),
    },
  };
}

/** One page of `users.history.list`. */
export function historyPage(history: gmail_v1.Schema$History[], nextPageToken?: string) {
  return { data: { history, ...(nextPageToken ? { nextPageToken } : {}) } };
}

export const messageAdded = (id: string, threadId?: string): gmail_v1.Schema$History => ({
  id: `h-${id}`,
  messagesAdded: [{ message: { id, threadId: threadId ?? `thread-${id}` } }],
});

export const messageDeleted = (id: string): gmail_v1.Schema$History => ({
  id: `h-del-${id}`,
  messagesDeleted: [{ message: { id } }],
});

export const labelsAdded = (id: string, labelIds: string[]): gmail_v1.Schema$History => ({
  id: `h-add-${id}`,
  labelsAdded: [{ message: { id }, labelIds }],
});

export const labelsRemoved = (id: string, labelIds: string[]): gmail_v1.Schema$History => ({
  id: `h-rm-${id}`,
  labelsRemoved: [{ message: { id }, labelIds }],
});

/**
 * Answer `users.messages.get` from a fixed set of messages. Ids listed in
 * `failing` reject instead — that is how the "one bad message must not abort
 * the sync" cases are set up.
 */
export function stubMessagesGet(
  mock: GmailMock,
  messages: FakeMessage[],
  failing: Record<string, Error> = {}
): void {
  const byId = new Map(messages.map((m) => [m.id, gmailMessage(m)]));
  mock.messagesGet.mockImplementation(async (params: MessageIdParams) => {
    const id = params?.id ?? '';
    const failure = failing[id];
    if (failure) throw failure;
    const message = byId.get(id);
    if (!message) throw gmailError(404, `Message ${id} not found`, ['notFound']);
    return { data: message };
  });
}

/** Reply to `users.messages.list` with these pages, in order. */
export function stubMessagesListPages(mock: GmailMock, pages: string[][]): void {
  mock.messagesList.mockReset();
  pages.forEach((ids, index) => {
    const next = index < pages.length - 1 ? `page-${index + 1}` : undefined;
    mock.messagesList.mockResolvedValueOnce(listPage(ids, next));
  });
  mock.messagesList.mockResolvedValue(listPage([]));
}

// ── Error builders ───────────────────────────────────────────────────────────

export interface GmailApiError extends Error {
  code: number;
  response: {
    status: number;
    data: { error: { code: number; message: string; errors: Array<{ domain: string; reason: string; message: string }> } };
  };
}

/**
 * A Gmail failure shaped the way gaxios surfaces it: a numeric `code` plus the
 * machine-readable reasons nested at `response.data.error.errors[].reason`.
 * `isGmailRateLimitError` reads both the flat and the nested form; the nested
 * one is what googleapis actually produces, so that is the default here.
 */
export function gmailError(code: number, message: string, reasons: string[] = []): GmailApiError {
  const errors = reasons.map((reason) => ({ domain: 'global', reason, message }));
  return Object.assign(new Error(message), {
    code,
    response: { status: code, data: { error: { code, message, errors } } },
  });
}

/** Gmail's answer when `startHistoryId` predates its ~1 week history retention. */
export const historyExpiredError = (): GmailApiError =>
  gmailError(404, 'Requested entity was not found.', ['notFound']);

/** A plain 403: the Gmail scope was never granted. The user must reconnect. */
export const insufficientScopeError = (): GmailApiError =>
  gmailError(403, 'Request had insufficient authentication scopes.', ['ACCESS_TOKEN_SCOPE_INSUFFICIENT']);

/**
 * A 403 that is throttling, not a permission problem. The message deliberately
 * avoids the words "rate limit exceeded" so the only thing distinguishing it
 * from the scope error is the nested `reason` — which is the distinction under
 * test.
 */
export const rateLimitedError = (): GmailApiError =>
  gmailError(403, 'Quota exceeded for quota metric "Queries".', ['rateLimitExceeded']);
