/* Proves the destinations list and how prices are read into it.
 *
 * The case worth the most attention is the one that looks like a detail: an
 * answer with no rates in it means "we do not sell calls there", and an answer
 * that never arrived means "we have not asked yet". A price list that shows
 * those two the same way is worse than one that shows neither.
 */

const {
  buildDestinations,
  lowestRate,
  readRateAnswer,
  markLoading,
  markFailed,
  matchesSearch,
  priceProgress,
  nextToPrice,
  toCsv,
} = require('./destination-rates.build.cjs');

let passed = 0;
let failed = 0;

const is = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`);
  }
};

const COUNTRIES = [
  { name: 'United Kingdom', isoCode: 'GB', flag: '🇬🇧', phonecode: '44' },
  { name: 'Afghanistan', isoCode: 'AF', flag: '🇦🇫', phonecode: '93' },
  { name: 'United States', isoCode: 'US', flag: '🇺🇸', phonecode: '1' },
];

/* ---- building the list ------------------------------------------------ */

const list = buildDestinations(COUNTRIES);
is('every dialable country is listed', list.length, 3);
is('sorted by name, not by the order given', list.map((d) => d.iso), ['AF', 'GB', 'US']);
is('dial codes always carry the plus', list.find((d) => d.iso === 'GB').dialCode, '+44');
is('a code given with a plus is not doubled', buildDestinations([{ name: 'X', isoCode: 'X1', phonecode: '+44' }])[0].dialCode, '+44');
is('rows start with no price known', list[0].state, 'unknown');

/* A place with no dialling code cannot be dialled, so it is not a destination -
   showing it with a blank code invites somebody to try to use it. */
is(
  'a country with no dialling code is left out',
  buildDestinations([...COUNTRIES, { name: 'Antarctica', isoCode: 'AQ', phonecode: '' }]).length,
  3,
);
is('a nameless row is left out', buildDestinations([{ name: '', isoCode: 'ZZ', phonecode: '1' }]).length, 0);
is('no countries at all is not a crash', buildDestinations([]).length, 0);
is('undefined is not a crash', buildDestinations(undefined).length, 0);

/* ---- reading a price -------------------------------------------------- */

is('the cheapest of several is used', lowestRate([{ rate: 0.12 }, { rate: 0.03 }, { rate: 0.4 }]), 0.03);
is('rates as strings still compare', lowestRate([{ rate: '0.12' }, { rate: '0.03' }]), 0.03);
is('no rates gives nothing, not zero', lowestRate([]), undefined);
is('rubbish is ignored rather than counted as free', lowestRate([{ rate: 'n/a' }]), undefined);

const gb = list.find((d) => d.iso === 'GB');

const priced = readRateAnswer(gb, {
  data: { data: { result: { outbound_call_rates: [{ rate: 0.02 }], inbound_call_rates: [{ rate: 0.01 }], sms_rates: [{ rate: 0.04 }] } } },
});
is('a priced destination reads as priced', priced.state, 'priced');
is('outbound is carried', priced.outbound, 0.02);
is('inbound is carried', priced.inbound, 0.01);
is('sms is carried', priced.sms, 0.04);
is('and it carries no explanation, because none is needed', priced.note, undefined);

/* The distinction this module exists for. */
const empty = readRateAnswer(gb, { data: { data: { result: { outbound_call_rates: [], inbound_call_rates: [], sms_rates: [] } } } });
is('an answer with no rates means not sold, not missing', empty.state, 'unpriced');
is('and says so in words', empty.note.includes('not sold'), true);

const broken = readRateAnswer(gb, null);
is('no answer at all is a failure, not "not sold"', broken.state, 'failed');
is('and offers the retry', broken.note.includes('Try again'), true);

is('a bare result shape is also understood', readRateAnswer(gb, { result: { outbound_call_rates: [{ rate: 0.05 }] } }).state, 'priced');
is('loading is marked without inventing a price', markLoading(gb).state, 'loading');
is('failure clears nothing else', markFailed(gb).iso, 'GB');

/* ---- searching -------------------------------------------------------- */

is('an empty search matches everything', matchesSearch(gb, ''), true);
is('by country name', matchesSearch(gb, 'united king'), true);
is('case does not matter', matchesSearch(gb, 'UNITED KINGDOM'), true);
is('by country code', matchesSearch(gb, 'gb'), true);
is('by dialling code without the plus', matchesSearch(gb, '44'), true);
is('by dialling code with the plus', matchesSearch(gb, '+44'), true);
/* Somebody pastes the number they are about to ring; it must find the country. */
is('by a whole number pasted in', matchesSearch(gb, '442071838750'), true);
is('a different country does not match', matchesSearch(gb, 'france'), false);
is('a different code does not match', matchesSearch(gb, '33'), false);

/* ---- progress and batching -------------------------------------------- */

const mixed = [
  { ...list[0], state: 'priced' },
  { ...list[1], state: 'unpriced' },
  { ...list[2], state: 'unknown' },
];
const progress = priceProgress(mixed);
is('known counts both priced and not-sold', progress.known, 2);
/* The two were one number, and the screen printed it as "N priced so far" —
   which on a run where most destinations publish no price told the reader the
   opposite of the truth. */
is('priced counts only rows with a price', progress.priced, 1);
is('unpriced is counted separately', progress.unpriced, 1);
is('missing is what is left', progress.missing, 1);
is('and it is not complete', progress.complete, false);
is('an empty list is not "complete"', priceProgress([]).complete, false);
is('all known is complete', priceProgress([{ state: 'priced' }, { state: 'unpriced' }]).complete, true);

is('only unfetched rows are queued', nextToPrice(mixed, 10).length, 1);
is('the batch is capped', nextToPrice(list, 2).length, 2);
is('a zero batch asks for nothing', nextToPrice(list, 0).length, 0);
is('a negative batch is not a crash', nextToPrice(list, -5).length, 0);

/* ---- export ----------------------------------------------------------- */

const csv = toCsv([priced, empty]);
is('there is a header row', csv.split('\n')[0].includes('Dialling code'), true);
is('one row per destination plus the header', csv.split('\n').length, 3);
/* Every dial code starts with +, which a spreadsheet reads as a formula unless
   it is defused - without this the whole column arrives broken. */
is('dialling codes are not treated as formulas', csv.includes('"\'+44"'), true);
is('a not-sold row says so rather than showing blank prices', csv.includes('Not sold'), true);
is('quotes in a name do not break the file', toCsv([{ ...gb, name: 'A "B" C', state: 'unknown' }]).includes('""B""'), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
