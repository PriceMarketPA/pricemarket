// Small display-only helpers for the community deals feed.
(function attachCommunityDealView(root) {
  function freshnessBadges(deal, now = new Date()) {
    const timestamp = Date.parse(deal?.spottedAt || deal?.spotted_at || '');
    const currentTime = now instanceof Date ? now.getTime() : Number(now);
    const labels = [];

    if (Number.isFinite(timestamp) && Number.isFinite(currentTime)) {
      const spotted = new Date(timestamp);
      const current = new Date(currentTime);
      const sameDay = spotted.getFullYear() === current.getFullYear()
        && spotted.getMonth() === current.getMonth()
        && spotted.getDate() === current.getDate();
      const ageMinutes = Math.max(0, Math.floor((currentTime - timestamp) / 60000));
      if (ageMinutes < 60) labels.push('New');
      else if (sameDay) labels.push('Today');
    }

    if (Number(deal?.confirmationCount ?? deal?.confirmation_count ?? 0) > 0) {
      labels.push('Community confirmed');
    }
    return labels;
  }

  const view = Object.freeze({ freshnessBadges });
  if (root) root.pmCommunityDealView = view;
  if (typeof module === 'object' && module.exports) module.exports = view;
})(typeof window === 'undefined' ? null : window);
