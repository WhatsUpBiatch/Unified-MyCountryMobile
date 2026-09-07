/* Bundle entry: both modules under one require, with the stubs above in place
   of the network and the toast. See tests/README.md for the build line. */
module.exports = {
  ...require('../src/lib/company-settings-api.ts'),
  ...require('../src/lib/company-defaults.ts'),
};
