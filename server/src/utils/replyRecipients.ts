/**
 * Who a reply goes to.
 *
 * Replying to someone else's message answers its sender (and, for reply
 * all, everyone else on it). Replying to your *own* message — the last one
 * in a thread is often yours — answers the people you wrote to: its
 * recipients, not you. Your own addresses (login and send-as aliases) are
 * never a recipient, unless a message only ever went to yourself.
 */

/** The bare address out of `Name <address>`, lower-cased. */
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
    out.push(v.trim());
  }
  return out;
}

export function replyRecipients(
  original: { from: string; to: string[]; cc: string[] },
  opts: { replyAll: boolean; to?: string[]; cc?: string[] },
  own: Set<string>,
): { to: string[]; cc: string[] } {
  const fromMe = own.has(bareAddress(original.from));
  const explicit = (opts.to ?? []).filter((a) => a.trim().length > 0);

  const natural = fromMe ? original.to : [original.from];
  let to = uniqueByAddress(explicit.length > 0 ? explicit : natural, own);
  // An explicit To that named only you means the natural recipients; failing
  // those, whoever else was on it; failing that — a note to self — yourself.
  if (to.length === 0) to = uniqueByAddress(natural, own);
  if (to.length === 0) to = uniqueByAddress([...original.to, ...original.cc], own);
  if (to.length === 0) to = [original.from];

  const taken = new Set([...own, ...to.map(bareAddress)]);
  const ccCandidates = opts.replyAll
    // Everyone on it; whoever is already in To is filtered out by `taken`.
    ? [...original.to, ...original.cc, ...(opts.cc ?? [])]
    : opts.cc ?? [];
  const cc = uniqueByAddress(ccCandidates, taken);

  return { to, cc };
}
