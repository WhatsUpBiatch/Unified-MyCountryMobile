/* Stands in for src/lib/utils, which pulls in react-toastify and half the
   icon set. Only handleAlert is needed; every toast is recorded. */
module.exports = {
  handleAlert: ({ text, type }) => {
    (globalThis.__mcmToasts = globalThis.__mcmToasts || []).push({ text, type });
    return null;
  },
};
