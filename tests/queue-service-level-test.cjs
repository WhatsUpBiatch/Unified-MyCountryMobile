const SL = require('./queue-service-level.build.cjs');
const { serviceLevel, waitSeconds, talkSeconds, wasAnswered, isShortAbandon } = SL;
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : fail++; console.log(`    ${c ? 'PASS' : 'FAIL'}  ${n}`); };
const near = (a, b, tol = 0.01) => a !== null && Math.abs(a - b) < tol;

console.log('  --- reading the wait off the real column ---');
t('waitsec is preferred over the subtraction',
  waitSeconds({ waitsec: 9, duration: 100, billsec: 50 }) === 9);
t('a waitsec of "0" is a real zero, not missing',
  waitSeconds({ waitsec: '0', duration: 100, billsec: 50 }) === 0);
t('an empty waitsec falls back to duration minus talk',
  waitSeconds({ waitsec: '', duration: 100, billsec: 60 }) === 40);
t('a missing waitsec falls back too',
  waitSeconds({ duration: 30, billsec: 10 }) === 20);
t('waitsec as a numeric string is read',
  waitSeconds({ waitsec: '13' }) === 13);
t('an HH:MM:SS wait is understood',
  waitSeconds({ waitsec: '00:01:05' }) === 65);
t('the fallback never goes negative',
  waitSeconds({ duration: 10, billsec: 40 }) === 0);
t('rubbish in waitsec falls back rather than poisoning the figure',
  waitSeconds({ waitsec: 'n/a', duration: 50, billsec: 20 }) === 30);

console.log('  --- talk and answered ---');
t('billsectotal wins over billsec', talkSeconds({ billsectotal: 40, billsec: 5 }) === 40);
t('talk of zero is not answered', wasAnswered({ billsec: 0 }) === false);
t('any talk at all is answered', wasAnswered({ billsec: 1 }) === true);

console.log('  --- short abandons ---');
t('an instant hang-up is short', isShortAbandon({ waitsec: 0, duration: 0, billsec: 0 }) === true);
t('a 3s hang-up is short', isShortAbandon({ waitsec: 3, duration: 3, billsec: 0 }) === true);
t('a 30s hang-up is a real abandon', isShortAbandon({ waitsec: 30, duration: 30, billsec: 0 }) === false);
t('an answered call is never a short abandon',
  isShortAbandon({ waitsec: 1, duration: 60, billsec: 59 }) === false);
t('the threshold is adjustable',
  isShortAbandon({ waitsec: 8, duration: 8, billsec: 0 }, 10) === true &&
  isShortAbandon({ waitsec: 8, duration: 8, billsec: 0 }, 5) === false);
t('a threshold of 0 keeps every abandon',
  isShortAbandon({ waitsec: 0, duration: 0, billsec: 0 }, 0) === false);
t('a row with no timing at all still reads as short',
  isShortAbandon({}) === true);

console.log('  --- service level ---');
let r = serviceLevel({ rows: [
  { waitsec: 5,  billsec: 60 },
  { waitsec: 10, billsec: 60 },
  { waitsec: 25, billsec: 60 },
  { waitsec: 40, billsec: 0  },
] });
t('three of four counted answered', r.answered === 3);
t('two answered inside 20s', r.answeredWithinTarget === 2);
t('one real abandon', r.abandoned === 1);
t('service level is 2 of 4', near(r.serviceLevelPercent, 50));
t('abandon rate is 1 of 4', near(r.abandonRatePercent, 25));
t('speed of answer averages answered calls only', near(r.averageAnswerSeconds, (5 + 10 + 25) / 3));
t('longest wait is the worst counted call', r.longestWaitSeconds === 40);

console.log('  --- a call answered exactly on the target ---');
r = serviceLevel({ rows: [{ waitsec: 20, billsec: 30 }] });
t('20s against a 20s target is inside it', r.answeredWithinTarget === 1 && near(r.serviceLevelPercent, 100));
r = serviceLevel({ rows: [{ waitsec: 21, billsec: 30 }] });
t('21s is outside it', r.answeredWithinTarget === 0 && near(r.serviceLevelPercent, 0));

console.log('  --- the target is adjustable ---');
const rows = [{ waitsec: 25, billsec: 30 }];
t('25s misses a 20s target', near(serviceLevel({ rows }).serviceLevelPercent, 0));
t('25s meets a 30s target', near(serviceLevel({ rows, targetSeconds: 30 }).serviceLevelPercent, 100));

console.log('  --- nothing to measure ---');
r = serviceLevel({ rows: [] });
t('no calls means no service level, not 0%', r.serviceLevelPercent === null);
t('no calls means no abandon rate', r.abandonRatePercent === null);
t('no calls means no speed of answer', r.averageAnswerSeconds === null);
t('no calls means no longest wait', r.longestWaitSeconds === null);
t('bad input does not throw', serviceLevel({ rows: null }).offered === 0);

console.log('  --- only short abandons is still nothing to measure ---');
r = serviceLevel({ rows: [{ waitsec: 0, billsec: 0 }, { waitsec: 1, billsec: 0 }] });
t('two misdials are offered', r.offered === 2);
t('both are set aside', r.shortAbandons === 2);
t('nothing is counted', r.counted === 0);
t('and no rate is invented', r.serviceLevelPercent === null && r.abandonRatePercent === null);

console.log('  --- this is the live production shape ---');
// The 22 queue calls actually in the database on 3 Sep 2026: six answered on
// 21 Aug with real waits, sixteen since then that died on contact at 0s.
const live = [
  { waitsec: 9,  billsec: 15 }, { waitsec: 13, billsec: 36 },
  { waitsec: 8,  billsec: 38 }, { waitsec: 24, billsec: 25 },
  { waitsec: 16, billsec: 48 }, { waitsec: 11, billsec: 20 },
  ...Array.from({ length: 16 }, () => ({ waitsec: 0, duration: 0, billsec: 0 })),
];
const raw = serviceLevel({ rows: live, shortAbandonSeconds: 0 });
const fixed = serviceLevel({ rows: live });
t('counting every hang-up gives the alarming 73%', near(raw.abandonRatePercent, 72.73, 0.01));
t('setting misdials aside shows the truth: nothing is being abandoned',
  near(fixed.abandonRatePercent, 0));
t('all sixteen were misdial-shaped', fixed.shortAbandons === 16);
t('the six real calls are still measured', fixed.counted === 6 && fixed.answered === 6);
t('and five of six were answered inside 20s', fixed.answeredWithinTarget === 5);
t('so service level reads 83%, not a mystery', near(fixed.serviceLevelPercent, 83.33, 0.01));
t('speed of answer is 13.5s, not the 3.7s the old averaging gave',
  near(fixed.averageAnswerSeconds, 13.5));

console.log('  --- the fix must be able to fail ---');
const bad = serviceLevel({ rows: [{ waitsec: 40, billsec: 0 }, { waitsec: 1, billsec: 30 }] });
t('a genuine long abandon is NOT swept away', bad.abandoned === 1 && near(bad.abandonRatePercent, 50));

console.log(`\n    ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
