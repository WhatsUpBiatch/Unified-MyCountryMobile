# Two-phone call test, 3 Sep 2026

Everything below is live on the switch and proven by offline tests. This is the
real-call check. You need: one person's account on a softphone or the web app
(call them "A", extension known), one outside phone (call it "B"), and admin
access to unified.mycountrymobile.com. About 20 minutes.

Write the result of each step next to it. "Expected" is what the switch should
do; if it does not, note what happened instead and the time, so I can read the
switch log for that minute.

## Before you start
1. Admin > Company > Phone rules: note the company opening hours and timezone.
2. Admin > People > A > call rules: turn OFF forward-all and DND, clear the
   after-ring action. Save.
3. Point a company number at A (Numbers > that number > business hours target =
   A's extension). Note the number: ______

## 1. Control call (nothing special set)
- B calls the number during opening hours.
- Expected: A rings for the company ring time, then voicemail. Result: ______

## 2. Company closed
- Admin > Company > Phone rules > opening hours: set today to closed. Save.
- B calls the number.
- Expected: A does NOT ring; caller goes to A's voicemail (or the number's
  closed-hours destination if one is set). Result: ______
- Put the hours back.

## 3. The number's own hours
- Numbers > that number > call handling > its own hours: set today closed and
  choose a closed-hours destination (voicemail or an extension). Save.
- B calls the number. Expected: caller goes to that destination, company still
  open. Result: ______
- Set the number back to open.

## 4. Menu's own hours
- Point the number at a phone menu. In that menu set today closed with a
  closed action (voicemail of A). B calls.
- Expected: caller does not hear the menu; goes to A's voicemail. Result: ______
- Set the menu back to open, point the number back at A.

## 5. Person rules (direct calls)
- People > A > call rules: forward-all to B's number. Save. B calls the number.
  Expected: B's own phone rings (the call is forwarded). Result: ______
- Turn forward-all off; turn DND on. B calls. Expected: straight to voicemail,
  A does not ring. Result: ______
- DND off; set ring time to 10 seconds; after-ring action = hang up. B calls.
  Expected: A rings about 10 seconds, then the call ends. Result: ______
- Put A's rules back.

## 6. Personal voicemail greeting
- My Account > Greetings (signed in as A): upload or pick a voicemail greeting.
- B calls, let it ring out. Expected: B hears A's greeting, then the beep.
  Result: ______

## 7. Location caller ID (outbound)
- Admin > Company > Locations > A's location: caller ID = Custom name "Test Co".
- A calls B. Expected: B's phone shows "Test Co" as the name. Result: ______
- Set to Withheld. A calls B. Expected: B sees a withheld/private number.
  Result: ______
- Set it back.

## 8. Suspended person
- Admin > People > A > Suspend. Then on A's softphone try to sign in / register.
  Expected: registration refused. B calls the number. Expected: A does not
  ring; caller goes to voicemail. Result: ______
- Reactivate A. Register again. Expected: works. Result: ______

## 9. Company holiday
- Admin > Company > Holidays: add today. B calls. Expected: closed behaviour as
  in step 2. Remove the holiday after. Result: ______

Send me the filled-in sheet, or just the failures with the time of each call.
