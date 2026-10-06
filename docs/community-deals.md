# Community Deal Spotter & Live Deals Feed

The customer page is `/community-deals` (the repository keeps `community-deals.html` as the static source). It is explicitly `noindex,follow`; individual community reports never create SEO routes or enter the sitemap.

## Data and request flow

- `pm_community_deal_reports` stores the city, store and deal text, normal and sale prices, secure upload object path, server timestamp, status, expiration, confirmation count, and a normalized fingerprint.
- `pm_community_deal_votes` stores one changeable vote per report and HMAC-hashed client IP. The UI exposes Still available, Expired, and Wrong info.
- Private rate-limit and challenge tables enforce three submissions and forty votes per IP hash per hour and make proof-of-work challenges one-use.
- The server routes `api/community-deals.js` use only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not add either value to frontend files or use a `NEXT_PUBLIC_`-style variable.
- After `pm_submit_community_deal` creates a non-duplicate report, the server sends a best-effort admin notification through Resend. The message includes the submitted deal details and states that it is Under review and not public until approved. Notification failure is logged server-side and does not change the successful report response.
- Photos reuse `/api/business-assets`: the browser gets a short-lived signed upload through the existing challenge/capability/session flow, uploads to the existing `business-images` bucket, and finalizes through server-side metadata and signature checks. Submission verifies that the capability/session still owns an uploaded `gallery-1` object. Only the verified object path is stored. The private report API does not accept arbitrary image URLs.

## Moderation

Every user report starts as `under_review` and is never automatically activated. Under-review reports are hidden from the public feed. A moderator reviews the report and, if appropriate, explicitly approves it in Supabase:

```sql
update public.pm_community_deal_reports
set status = 'active',
    spotted_at = now(),
    expires_at = now() + interval '7 days',
    updated_at = now()
where id = '<reviewed-report-uuid>'
  and status = 'under_review';
```

Reject a report by leaving it under review or setting `status = 'expired'`. Only the server-side service role can read or change reports and votes through the Data API; RLS is enabled and forced, and client roles have no table or RPC access.

For a data export in the Supabase SQL editor, inspect pending reports with:

```sql
select id, store_name, item_title, description, city, normal_price, sale_price,
       photo_path, spotted_at, created_at
from public.pm_community_deal_reports
where status = 'under_review'
order by created_at asc;
```

## Freshness, votes, and duplicates

Active reports expire seven days after approval. The public query requires both `status = active` and `expires_at > now()`, and the feed endpoint also sweeps expired rows, so stale reports disappear even before the next status sweep. Each Still available vote extends the window by seven days. Three unique Expired votes that outnumber confirmations mark a report expired; three Wrong info votes that outnumber confirmations return it to Under review.

The server normalizes city/store/item text to build a SHA-256 fingerprint. A partial unique index prevents a matching report while its earlier report is active or under review; a new report can be made after the earlier report is expired. Duplicate and rate-limit decisions are serialized in database functions.

## Setup

1. Add and apply `supabase/migrations/20261005000000_community_deal_spotter.sql` to the Price Market Supabase project. It creates the private tables and service-role-only RPC functions; it does not change storage buckets or public Storage policies.
2. Ensure Vercel Production and Preview have the existing server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` variables used by the secure business-upload endpoint.
3. Add the server-only `RESEND_API_KEY` in Vercel Production and Preview. Verify the `pricemarketpa.com` sending domain in Resend so `Price Market <notifications@pricemarketpa.com>` is authorized to send. Notifications go to `pat@pricemarketpa.com`.
4. Deploy the branch and test a new `/community-deals` report. Confirm the notification arrives and the report remains Under review; duplicates, failed writes, and rate-limited writes do not send email.
5. Approve a test report in the Supabase SQL editor before checking the active feed and status buttons. Remove the test report and its uploaded object after QA. Community records do not appear in sitemap.

The existing Storage upload flow uploads to a public bucket using unpredictable pending paths. Under-review reports are not returned by the feed and their photo URLs are not exposed by the community feed API until a moderator activates the report.

## Abuse controls and limits

- Server-side origin and forwarded-host matching uses the current production/Preview allowlist from the business upload system.
- A server-signed, five-minute proof-of-work challenge is required for submissions; each challenge can be consumed once.
- Database-atomic per-IP-hash limits: 3 submissions/hour, 40 vote actions/hour.
- Store/title/city duplicate detection is performed atomically by a unique fingerprint index.
- Plain text is trimmed, bounded, HTML-like tags are rejected, prices are parsed server-side, and user content is rendered with DOM `textContent`, never interpolated into HTML.
- Price bounds are numeric with up to two decimal places; normal and sale prices are required, and a sale price cannot exceed the normal price.

