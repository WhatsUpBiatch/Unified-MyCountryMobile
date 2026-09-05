/* Stands in for src/services/api when tests/company-settings.build.cjs is
   built. Every endpoint reads its behaviour off globalThis.__mcmApi so a test
   can script the server turn by turn: return a body, or throw an axios-shaped
   error with a status. Each call is also recorded so a test can prove what
   was sent, in what order. */

const call = (name, ...args) => {
  const api = globalThis.__mcmApi || {};
  (globalThis.__mcmCalls = globalThis.__mcmCalls || []).push({ name, args });
  const handler = api[name];
  if (typeof handler !== 'function') {
    return Promise.reject(new Error(`no stub for ${name}`));
  }
  return Promise.resolve().then(() => handler(...args));
};

module.exports = {
  getTemplateList: (...args) => call('getTemplateList', ...args),
  upsertTemplate: (...args) => call('upsertTemplate', ...args),
  listCompanySettings: (...args) => call('listCompanySettings', ...args),
  getCompanySettingsSection: (...args) => call('getCompanySettingsSection', ...args),
  saveCompanySettingsSection: (...args) => call('saveCompanySettingsSection', ...args),
  getCompanySettingsHistory: (...args) => call('getCompanySettingsHistory', ...args),
};
