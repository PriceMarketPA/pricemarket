'use strict';

const ADMIN_EMAIL = 'pat@pricemarketpa.com';
const FROM_EMAIL = 'Price Market <notifications@pricemarketpa.com>';

function formatPrice(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? '$' + amount.toFixed(2) : 'Not provided';
}

function buildCommunityDealEmail({ deal, submissionId, submittedAt, photoIncluded }) {
  return {
    from: FROM_EMAIL,
    to: [ADMIN_EMAIL],
    subject: 'New community deal submission — Under review',
    text: [
      'A new community deal report was submitted to Price Market.',
      '',
      'Store/business: ' + deal.storeName,
      'Item/deal title: ' + deal.itemTitle,
      'City: ' + deal.city,
      'Normal price: ' + formatPrice(deal.normalPrice),
      'Sale price: ' + formatPrice(deal.salePrice),
      'Description: ' + deal.description,
      'Photo included: ' + (photoIncluded ? 'Yes' : 'No'),
      'Submission ID: ' + submissionId,
      'Submission time: ' + submittedAt,
      'Status: Under review',
      '',
      'This deal is not public and will not appear in the marketplace until Price Market approves it.'
    ].join('\n')
  };
}

async function sendCommunityDealNotification({ apiKey, deal, submissionId, submittedAt, photoIncluded, fetchImpl = global.fetch }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('RESEND_API_KEY is not configured.');
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildCommunityDealEmail({ deal, submissionId, submittedAt, photoIncluded })),
    ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(5000) } : {})
  });
  if (!response.ok) throw new Error('Resend email request failed with HTTP ' + response.status + '.');
}

module.exports = { ADMIN_EMAIL, FROM_EMAIL, buildCommunityDealEmail, sendCommunityDealNotification };

