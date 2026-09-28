/**
 * Who a reply is addressed to — the reply form's starting point. The server
 * applies the same rule (server/src/utils/replyRecipients.ts); the tests on
 * both sides keep them in step.
 *
 * Replying to your own message answers the people you wrote to, not you;
 * reply all keeps everyone else; none of your addresses is a recipient
 * unless the message only ever went to you.
 */

export function bareAddress(value: string): string {
  const m = /<([^>]+)>/.exec(value);
  return (m ? m[1] : value).trim().toLowerCase();
}

function uniqueByAddress(values: string[], exclude: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const a = bareAddress(v);
    if (!a || exclude.has(a) || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

export function replyRecipients(
  message: { from: string; to: string[]; cc: string[] },
  replyAll: boolean,
  own: Set<string>,
): { to: string[]; cc: string[] } {
  const fromMe = own.has(bareAddress(message.from));
  const natural = fromMe ? message.to : [message.from];
  let to = uniqueByAddress(natural, own);
  if (to.length === 0) to = uniqueByAddress([...message.to, ...message.cc], own);
  if (to.length === 0) to = [bareAddress(message.from)];
  const cc = replyAll ? uniqueByAddress([...message.to, ...message.cc], new Set([...own, ...to])) : [];
  return { to, cc };
}

/**
 * Your addresses, as far as a thread shows them: the login address, and
 * whatever you have sent this thread's messages from.
 */
export function ownAddressesIn(
  userEmail: string | null | undefined,
  messages: Array<{ from: string; labelIds?: string[] }>,
): Set<string> {
  const own = new Set<string>();
  if (userEmail) own.add(userEmail.toLowerCase());
  for (const m of messages) if (m.labelIds?.includes('SENT')) own.add(bareAddress(m.from));
  return own;
}
