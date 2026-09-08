/* Every destination you can call, with its dialling code and price.
 *
 * The rates screen next to this one answers one question at a time: pick a
 * country, see its rates. That is right for checking a single number before
 * dialling it, and no use for "which destinations cost the most" or "send our
 * price list to finance".
 *
 * The list of destinations is instant, because the countries and their dialling
 * codes already ship with the app. Prices are not: the endpoint that has them
 * takes one country per request, so a full price list is 250 round trips. They
 * are fetched in small batches, and every row says which of the four things it
 * is - priced, not sold here, still loading, or not asked for yet - because a
 * blank price reads as free.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { SettingCard } from '@/components/mcm/setting-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AdminPage } from '@/pages/admin-settings/page-shell';
import { callingRatesList } from '@/services/api';
import countryList from '@/lib/countries.json';
import {
  buildDestinations,
  markFailed,
  markLoading,
  matchesSearch,
  nextToPrice,
  priceProgress,
  readRateAnswer,
  toCsv,
  type Destination,
} from '@/lib/destination-rates';

/* Small enough that the table fills visibly and the service is not hammered.
   250 at once would be refused by the browser and finish in an order nobody
   can predict. */
const BATCH = 8;

const price = (value?: number): string =>
  value === undefined ? '—' : `$${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;

const STATE_TEXT: Record<Destination['state'], string> = {
  unknown: 'Not loaded',
  loading: 'Loading…',
  priced: '',
  unpriced: 'Not sold',
  failed: 'Failed',
};

const Destinations = () => {
  const [rows, setRows] = useState<Destination[]>(() => buildDestinations(countryList as any));
  /* A mirror of `rows` that is always current.

     The batch loader needs to know which destinations are still unpriced at the
     moment it picks the next batch, and it used to get that by passing an
     updater to `setRows` that assigned to an outer variable and returned the
     array unchanged. React treats an updater returning the same reference as a
     no-op and bails out, and there is no promise about when — or how often —
     an updater runs; in StrictMode it runs twice. In practice the walk stalled
     partway: 193 of 250 destinations, with the button still offering to load
     the remaining 57 and nothing saying it had stopped.

     A ref is the honest way to read "what is true right now" outside a render.
     `writeRows` keeps the two in step so there is one place to change. */
  const rowsRef = useRef(rows);
  const writeRows = useCallback((update: (all: Destination[]) => Destination[]) => {
    rowsRef.current = update(rowsRef.current);
    setRows(rowsRef.current);
  }, []);
  const [search, setSearch] = useState('');
  const [loadingAll, setLoadingAll] = useState(false);
  /* Read inside the loop so pressing Stop takes effect on the next batch rather
     than only after every remaining country has been fetched. */
  const stopped = useRef(false);

  const shown = useMemo(() => rows.filter((r) => matchesSearch(r, search)), [rows, search]);
  const progress = useMemo(() => priceProgress(rows), [rows]);

  const fetchOne = useCallback(
    async (destination: Destination) => {
      writeRows((all) => all.map((r) => (r.iso === destination.iso ? markLoading(r) : r)));
      try {
        const answer = await callingRatesList({
          filter: { key: 'COUNTRY', value: destination.name },
        });
        writeRows((all) =>
          all.map((r) => (r.iso === destination.iso ? readRateAnswer(r, answer) : r)),
        );
      } catch {
        writeRows((all) => all.map((r) => (r.iso === destination.iso ? markFailed(r) : r)));
      }
    },
    [writeRows],
  );

  /* Walks the whole list in batches. The queue is recomputed from current state
     each round rather than captured up front, so a row somebody loaded by hand
     in the meantime is not fetched twice. */
  const loadAll = useCallback(async () => {
    stopped.current = false;
    setLoadingAll(true);
    try {
      for (;;) {
        if (stopped.current) break;
        /* Read straight from the ref: the queue is whatever is still unpriced
           right now, including anything the reader loaded by hand while this
           was running, so nothing is fetched twice and nothing is skipped. */
        const batch = nextToPrice(rowsRef.current, BATCH);
        if (batch.length === 0) break;
        await Promise.all(batch.map(fetchOne));
      }
    } finally {
      setLoadingAll(false);
    }
  }, [fetchOne]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'destinations-and-rates.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminPage
      section="SMS/Calling rates"
      title="Destinations"
      description="Everywhere you can call, with its dialling code and what a call there costs."
      filters={
        <>
          {/* Finding a destination is what this screen is for, so the search
              belongs in the page's own filter bar. It used to sit inside the
              card as a labelled settings row — a whole row of form furniture
              wrapped around one input. */}
          <Input
            placeholder="United Kingdom, 44, or +44 20 7183 8750"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loadingAll ? (
            <Button type="button" variant="outline" onClick={() => (stopped.current = true)}>
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadAll()}
              disabled={progress.complete}
            >
              {progress.missing > 0 ? `Load ${progress.missing} remaining` : 'All loaded'}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={exportCsv}>
            Export CSV
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <SettingCard
          title="The price list"
          description={
            /* Two numbers, not one. This said "N priced so far" using a count
               that included every destination checked and found to have no
               price — so a run that priced six of two hundred and fifty
               reported "176 priced". */
            progress.complete
              ? `All ${progress.total} destinations checked. ${progress.priced} have a published price; ${progress.unpriced} do not.`
              : `${progress.total} destinations. ${progress.known} checked so far — ${progress.priced} with a price. Prices are fetched one country at a time, so the rest load as you go.`
          }
        >
          {/* Wide content scrolls inside its own box — the page itself must
              never move sideways. */}
          <div className="tbl-wrap">
            <table className="mcm-dest">
              <thead>
                <tr>
                  <th scope="col">Destination</th>
                  <th scope="col">Code</th>
                  <th scope="col" className="num">
                    Outbound
                  </th>
                  <th scope="col" className="num">
                    Inbound
                  </th>
                  <th scope="col" className="num">
                    SMS
                  </th>
                  <th scope="col" className="num">
                    <span className="sr-only">Price status</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.iso}>
                    <th scope="row">
                      <span aria-hidden="true">{d.flag}</span>
                      {d.name}
                    </th>
                    <td className="num">{d.dialCode}</td>
                    <td className="num strong">{d.state === 'priced' ? price(d.outbound) : '—'}</td>
                    <td className="num">{d.state === 'priced' ? price(d.inbound) : '—'}</td>
                    <td className="num">{d.state === 'priced' ? price(d.sms) : '—'}</td>
                    {/* A dash on its own would read as "free". The state column
                        is what stops a blank price being mistaken for a zero
                        one. */}
                    <td className="num">
                      {d.state === 'priced' ? null : d.state === 'unknown' ? (
                        <button
                          type="button"
                          className="mcm-numlink"
                          onClick={() => void fetchOne(d)}
                        >
                          Load price
                        </button>
                      ) : (
                        <span className={`mcm-dest-s is-${d.state}`} title={d.note}>
                          {STATE_TEXT[d.state]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="mcm-dest-none">
                      Nothing matches &ldquo;{search}&rdquo;.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {!progress.complete ? (
            <p className="mcm-setrow-note is-info mt-2">
              A price only appears once it has been fetched. &ldquo;Not sold&rdquo; means no price
              is published for that destination &mdash; it is not the same as a price of nothing.
            </p>
          ) : null}
        </SettingCard>
      </div>
    </AdminPage>
  );
};

export default Destinations;
