(function attachPriceMarketCopyright(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.document.querySelectorAll('[data-copyright-year]').forEach(element => {
      element.textContent = api.formatCopyright();
    });
  }
})(typeof globalThis === 'object' ? globalThis : this, function createPriceMarketCopyright() {
  'use strict';

  const START_YEAR = 2026;

  function formatCopyright(currentYear = new Date().getFullYear()) {
    const endYear = Math.max(START_YEAR, Number(currentYear) || START_YEAR);
    const years = endYear === START_YEAR ? String(START_YEAR) : `${START_YEAR}–${endYear}`;
    return `© ${years} Price Market LLC. All rights reserved.`;
  }

  return { formatCopyright };
});
