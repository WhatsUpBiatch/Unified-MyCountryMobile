/* Every place you can call, what it costs, and what we do not know yet.
 *
 * The rates screen answers one question at a time: pick a country, see its
 * rates. That is the right shape when somebody is checking a single number
 * before they dial it, and the wrong shape for every other reason people ask.
 * "Which destinations are expensive?" and "what does our whole price list look
 * like?" cannot be answered by looking countries up one at a time, and the
 * finance team asking has no way to export anything.
 *
 * The list of destinations is not the problem - 250 countries and their
 * dialling codes are already in the app, so the table can be complete from the
 * first paint. Prices are the problem: the endpoint that has them takes exactly
 * one country per request and refuses an empty filter, so a full price list is
 * 250 round trips.
 *
 * So this module keeps the two apart. The destination list is built instantly
 * and locally; prices arrive one country at a time and are filled in as they
 * land. A row whose price has not arrived says so, rather than showing a blank
 * that reads as free.
 *
 * The distinction that matters most here, and the one a price list gets wrong:
 * "we have not fetched this yet" and "there is no rate for this destination"
 * look identical on screen unless you make them different. One is a spinner,
 * the other is a business fact, and a finance team reading the second as the
 * first will wait forever for a number that is never coming.
 */

export interface CountryLike {
  name: string;
  isoCode: string;
  flag?: string;
  phonecode?: string;
}

export type RateState = 'unknown' | 'loading' | 'priced' | 'unpriced' | 'failed';

export interface Destination {
  iso: string;
  name: string;
  flag: string;
  /* Always stored with a leading +, so the table never mixes "44" and "+44". */
  dialCode: string;
  state: RateState;
  /* Only meaningful when state is 'priced'. */
  outbound?: number;
  inbound?: number;
  sms?: number;
  /* Why a row has no price, in words a customer can read. */
  note?: string;
}

const cleanCode = (raw: unknown): string => {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  return digits ? `+${digits}` : '';
};

/* Some entries in the country data carry no dialling code at all - Antarctica,
   a few territories. They are real places and they belong in the list, but a
   destination you cannot dial is not a destination, so they are left out rather
   than shown with an empty code somebody might try to use. */
export const buildDestinations = (countries: CountryLike[]): Destination[] =>
  (countries ?? [])
    .map((c) => ({
      iso: String(c?.isoCode ?? '').toUpperCase(),
      name: String(c?.name ?? '').trim(),
      flag: String(c?.flag ?? ''),
      dialCode: cleanCode(c?.phonecode),
      state: 'unknown' as RateState,
    }))
    .filter((d) => d.iso && d.name && d.dialCode)
    .sort((a, b) => a.name.localeCompare(b.name));

const money = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/* The cheapest rate in a list, which is what a price list should show when a
   destination has several - mobile, landline, and so on. Showing the highest
   would read as a warning nobody asked for; showing the first is arbitrary. */
export const lowestRate = (rows: any[]): number | undefined => {
  const values = (rows ?? [])
    .map((r) => money(r?.rate))
    .filter((n): n is number => n !== undefined);
  return values.length ? Math.min(...values) : undefined;
};

/* Reads one country's answer from the rates endpoint into a row.
 *
 * An answer that arrives with no rates in it is not a failure - it means we do
 * not sell calls there - so it becomes 'unpriced' with a plain sentence, not an
 * error. Those two being told apart is the whole point of this function. */
export const readRateAnswer = (destination: Destination, answer: any): Destination => {
  const result = answer?.data?.data?.result ?? answer?.result ?? answer;
  if (!result) {
    return { ...destination, state: 'failed', note: 'The price could not be loaded. Try again.' };
  }

  const outbound = lowestRate(result?.outbound_call_rates);
  const inbound = lowestRate(result?.inbound_call_rates);
  const sms = lowestRate(result?.sms_rates);

  if (outbound === undefined && inbound === undefined && sms === undefined) {
    return {
      ...destination,
      state: 'unpriced',
      note: 'No price is published for this destination, so calls to it are not sold.',
    };
  }

  return { ...destination, state: 'priced', outbound, inbound, sms, note: undefined };
};

export const markLoading = (destination: Destination): Destination => ({
  ...destination,
  state: 'loading',
  note: undefined,
});

export const markFailed = (destination: Destination): Destination => ({
  ...destination,
  state: 'failed',
  note: 'The price could not be loaded. Try again.',
});

/* What to search on. A person looking for a destination types a country name,
   a dialling code, or the start of a number they are about to call - all three
   have to find the same row. The + is optional because nobody types it. */
export const matchesSearch = (destination: Destination, search: string): boolean => {
  const term = String(search ?? '')
    .trim()
    .toLowerCase();
  if (!term) return true;

  if (destination.name.toLowerCase().includes(term)) return true;
  if (destination.iso.toLowerCase() === term) return true;

  const digits = term.replace(/[^\d]/g, '');
  if (!digits) return false;
  /* Typing a whole number should find its country, so the code is matched
     against the start of what was typed as well as the other way round. */
  const code = destination.dialCode.slice(1);
  return code.startsWith(digits) || digits.startsWith(code);
};

/* How much of the price list we actually have, for a line that tells somebody
   whether what they are looking at is the whole picture. */
export const priceProgress = (
  destinations: Destination[],
): {
  total: number;
  known: number;
  priced: number;
  unpriced: number;
  missing: number;
  complete: boolean;
} => {
  const total = destinations.length;
  const priced = destinations.filter((d) => d.state === 'priced').length;
  const unpriced = destinations.filter((d) => d.state === 'unpriced').length;
  /* `known` is how many have been *asked about*, priced or not — it is what
     decides whether there is anything left to fetch. It is deliberately not
     the same number as `priced`: the screen reported "176 priced so far" on a
     run where six destinations had a price and the other hundred and seventy
     had come back with none, which is a very different thing to tell somebody
     looking at a price list. Both are returned so the copy can say both. */
  const known = priced + unpriced;
  return { total, known, priced, unpriced, missing: total - known, complete: total > 0 && known >= total };
};

/* The next destinations whose price should be fetched, oldest-first and capped.
 *
 * Bounded on purpose: 250 requests fired at once would be refused by the
 * browser, hammer the API, and finish in an order nobody can predict. A small
 * batch keeps the table filling visibly and the service unbothered. */
export const nextToPrice = (destinations: Destination[], batch: number): Destination[] =>
  destinations.filter((d) => d.state === 'unknown').slice(0, Math.max(0, batch));

const csvCell = (value: unknown): string => {
  const text = String(value ?? '');
  /* A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
     Dialling codes start with + on every single row, so without this the whole
     column arrives broken. */
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const toCsv = (destinations: Destination[]): string => {
  const header = [
    'Destination',
    'Country code',
    'Dialling code',
    'Outbound',
    'Inbound',
    'SMS',
    'Status',
  ];
  const rows = destinations.map((d) =>
    [
      csvCell(d.name),
      csvCell(d.iso),
      csvCell(d.dialCode),
      csvCell(d.outbound ?? ''),
      csvCell(d.inbound ?? ''),
      csvCell(d.sms ?? ''),
      csvCell(
        d.state === 'priced'
          ? 'Priced'
          : d.state === 'unpriced'
            ? 'Not sold'
            : d.state === 'failed'
              ? 'Could not load'
              : 'Not loaded',
      ),
    ].join(','),
  );
  return [header.map(csvCell).join(','), ...rows].join('\n');
};
