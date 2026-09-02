/**
 * Which queue a live call came through, read off its SIP headers.
 *
 * The switch tells the app about a queue call twice, under two different names,
 * and the app was only listening for one of them.
 *
 * On the caller's own leg the dialplan sets `X-Queue`. But an agent does not
 * receive that leg - the queue script bridges them a *new* call, and the headers
 * it puts on that invite are `X-ForwardType: QUEUE` and `X-ForwardValue: <the
 * queue id>`. `X-Queue` is not among them. So every consumer that looked only
 * for `X-Queue` found nothing on the one leg that matters: the agent's.
 *
 * That single missing mapping is why an agent answering a queue call saw no
 * disposition list, no call script, and the wrong wrap-up time. All three are
 * built and all three read the queue record, which was never fetched because
 * the id was sitting in a header nobody read.
 *
 * `X-Queue` is still preferred where it exists. This only fills the gap, so it
 * cannot change behaviour on any leg that already worked.
 */

/** The forward type the switch uses for a call sitting in, or sent from, a queue. */
export const QUEUE_FORWARD_TYPE = 'QUEUE';

export type HeaderReader = (name: string) => string;

/**
 * The queue id for this call, or ''.
 *
 * `read` is given a lower-case header name and returns its value, or '' - the
 * shape both header helpers in the dialpad context already have, so neither
 * caller has to reshape anything to use this.
 */
export const queueIdFromHeaders = (read: HeaderReader): string => {
  const direct = String(read('x-queue') || '').trim();
  if (direct) return direct;

  /* Only when the switch says this leg is a queue call. `X-ForwardValue` also
     carries campaign ids and extension numbers, and treating one of those as a
     queue id would send the app looking up a queue that does not exist. */
  const forwardType = String(read('x-forwardtype') || '')
    .trim()
    .toUpperCase();
  if (forwardType !== QUEUE_FORWARD_TYPE) return '';

  return String(read('x-forwardvalue') || '').trim();
};

/** Convenience for the plain `Record<string, string>` case. */
export const queueIdFromHeaderMap = (headers: Record<string, unknown> | null | undefined): string =>
  queueIdFromHeaders((name) => String(headers?.[name] ?? ''));
