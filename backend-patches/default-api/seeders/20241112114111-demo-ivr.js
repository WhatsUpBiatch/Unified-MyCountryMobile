"use strict";

/* The recordings every new company starts with.
 *
 * This seeder runs once per tenant, from TenantDatabaseService.createDatabase,
 * and it is the ONLY thing that puts stock recordings in a new tenant. That
 * makes it the single source of truth for "what does a brand-new customer
 * see", and it had drifted badly: nine defaults were added to the product on
 * 3 Sep 2026 and back-filled into the tenants that already existed, but never
 * added here. So every company created after that date got the original four -
 * all of them `voicemail` - and had NO welcome greeting and NO hold music at
 * all. The Welcome dropdown was simply empty for them.
 *
 * If you add a default recording, it belongs in TWO places: here, for every
 * future tenant, and a back-fill into the tenants that already exist. One
 * without the other is how this drifted.
 *
 * `is_default` is not set on these rows on purpose - the column defaults to
 * true, which is what the original four relied on, and the screens key off it
 * to mark a recording as stock.
 */
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.bulkInsert("ivrfiles", [
      {
        id: 1,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f457824a",
        user_uuid: null,
        name: "Default VM",
        filename: "ad98d65d-fcf8-4d4d-bc77-ee1426c3433f.mp3",
        duration: "4",
        size: 26496,
        type: "voicemail",
      },
      {
        id: 2,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f457824b",
        user_uuid: null,
        name: "Default Recording On",
        filename: "ad98d65d-fcf8-4d4d-bc77-ee1426c34331.mp3",
        duration: "2",
        size: 26496,
        type: "voicemail",
      },
      {
        id: 3,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f457824c",
        user_uuid: null,
        name: "Default Recording Off",
        filename: "ad98d65d-fcf8-4d4d-bc77-ee1426c34332.mp3",
        duration: "2",
        size: 26496,
        type: "voicemail",
      },
      {
        id: 4,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f457824d",
        user_uuid: null,
        name: "Default Recording",
        filename: "ad98d65d-fcf8-4d4d-bc77-ee1426c34333.mp3",
        duration: "2",
        size: 26496,
        type: "voicemail",
      },

      /* Added to the product 3 Sep 2026. Ids continue from 23 to match the
         numbering the back-fill used on existing tenants, so a row means the
         same thing whichever tenant you look at. */
      {
        id: 23,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578250",
        user_uuid: null,
        name: "Default welcome message",
        filename: "mcm-default-welcome.mp3",
        duration: "5",
        size: 0,
        type: "welcome_greeting",
      },
      {
        id: 24,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578251",
        user_uuid: null,
        name: "Default hold music",
        filename: "mcm-default-hold-music.mp3",
        duration: "140",
        size: 0,
        type: "on_hold_music",
      },
      {
        id: 25,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578260",
        user_uuid: null,
        name: "Default voicemail",
        filename: "mcm-default-vm-default.mp3",
        duration: "12",
        size: 0,
        type: "voicemail",
      },
      {
        id: 26,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578261",
        user_uuid: null,
        name: "After-hours voicemail",
        filename: "mcm-default-vm-after-hours.mp3",
        duration: "12",
        size: 0,
        type: "voicemail",
      },
      {
        id: 27,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578262",
        user_uuid: null,
        name: "Busy - all lines voicemail",
        filename: "mcm-default-vm-busy.mp3",
        duration: "11",
        size: 0,
        type: "voicemail",
      },
      {
        id: 28,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578263",
        user_uuid: null,
        name: "Holiday voicemail",
        filename: "mcm-default-vm-holiday.mp3",
        duration: "11",
        size: 0,
        type: "voicemail",
      },
      {
        id: 29,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578270",
        user_uuid: null,
        name: "Jenny (Female - American)",
        filename: "mcm-default-welcome-female-us.mp3",
        duration: "5",
        size: 0,
        type: "welcome_greeting",
      },
      {
        id: 30,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578271",
        user_uuid: null,
        name: "Guy (Male - American)",
        filename: "mcm-default-welcome-male-us.mp3",
        duration: "5",
        size: 0,
        type: "welcome_greeting",
      },
      {
        id: 31,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578272",
        user_uuid: null,
        name: "Ryan (Male - British)",
        filename: "mcm-default-welcome-male-gb.mp3",
        duration: "5",
        size: 0,
        type: "welcome_greeting",
      },

      /* The set the account owner curated, promoted from their own library to
         every tenant on 3 Sep 2026. These are what the pickers actually offer;
         ids 29-31 above are hidden in the product (see HIDDEN_RECORDING_UUIDS)
         and kept only so a company that already chose one keeps hearing it. */
      {
        id: 32,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578280",
        user_uuid: null,
        name: "Jenny (Female - American)",
        filename: "mcm-default-welcome-jenny-female-us.mp3",
        duration: "5",
        size: 94560,
        type: "welcome_greeting",
      },
      {
        id: 33,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578281",
        user_uuid: null,
        name: "Andrew (Male - American)",
        filename: "mcm-default-welcome-andrew-male-us.mp3",
        duration: "4",
        size: 71520,
        type: "welcome_greeting",
      },
      {
        id: 34,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578282",
        user_uuid: null,
        name: "Davis (Male - British)",
        filename: "mcm-default-welcome-davis-male-gb.mp3",
        duration: "5",
        size: 95520,
        type: "welcome_greeting",
      },
      {
        id: 35,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578283",
        user_uuid: null,
        name: "Victoria (Female - British)",
        filename: "mcm-default-welcome-victoria-female-gb.mp3",
        duration: "5",
        size: 94560,
        type: "welcome_greeting",
      },
      {
        id: 36,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578284",
        user_uuid: null,
        name: "Hold music - Arabesque",
        filename: "mcm-default-hold-arabesque.mp3",
        duration: "251",
        size: 3010918,
        type: "on_hold_music",
      },
      {
        id: 37,
        uuid: "5b6ecf4c-4df2-43fe-b2c7-dd12f4578285",
        user_uuid: null,
        name: "Hold music - Bach Prelude",
        filename: "mcm-default-hold-bach-prelude.mp3",
        duration: "251",
        size: 3010918,
        type: "on_hold_music",
      },
    ]);
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete("ivrfiles", null, {});
  },
};
