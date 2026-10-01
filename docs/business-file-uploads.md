# Business onboarding file uploads

Business onboarding uses short-lived, server-issued Supabase Storage signed upload URLs. The browser sends file bytes directly to Storage so 10 MB images and 15 MB PDFs do not pass through the Vercel Function request body limit. The server signs uploads, validates role/type/size, checks the stored object metadata and file signature, and only then returns a public URL. The service-role key is used only inside `api/business-assets.js`.

The endpoint requires an exact approved HTTPS `Origin` and a matching request host on every action. Production accepts only `https://pricemarketpa.com` and `https://www.pricemarketpa.com`. Preview accepts only the deployment host supplied by Vercel's trusted `VERCEL_URL`/`VERCEL_BRANCH_URL` environment values. Missing origins and unlisted hosts are denied. Session creation also requires a single-use, server-signed proof-of-work challenge (16 leading zero bits in SHA-256); the browser solves it with Web Crypto. A persistent server-side limiter caps initialization at ten sessions per source IP per hour; only a keyed HMAC hash of the address is stored. This is a lightweight anti-abuse gate, not an identity or human-verification claim.

## Vercel environment variables

Add these variables to the Price Market Vercel project for **Preview** and **Production** (and Development if running Vercel locally):

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://ofjykpqfdogdpmpneuaz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | The server-side service-role/secret key from the Price Market Supabase project. Store it as a Vercel encrypted environment variable. |

Do not name the key `NEXT_PUBLIC_*`, add it to any HTML/JS asset, commit it, or expose it in browser configuration. Rotate it in Supabase if it has ever been exposed. Redeploy after setting or rotating it.

The public Storage buckets remain `business-images` (JPG, PNG, WebP, HEIC, HEIF; 10 MB) and `business-documents` (PDF; 15 MB). Keep those limits and MIME allowlists configured in Supabase as a second enforcement layer. Because these buckets are public, anyone who obtains an uploaded URL can read that file; upload only materials meant for eventual public business profiles, not private/confidential documents. Pending files are not displayed on the marketplace and are not published into a profile automatically.

The upload endpoint has no browser CORS allowlist of its own and accepts same-origin requests. The direct browser-to-Storage PUT is cross-origin; if project API origins have been restricted, allow the production site and the Vercel Preview origins used for QA. Do not enable anonymous insert/update/delete policies to make uploads work: the signed URL is the scoped upload permission, and the endpoint uses the server key for verification and removal.

## Apply the quota ledger migration

Before testing uploads on a deployment, apply [`supabase/migrations/20261001220000_business_upload_quotas.sql`](../supabase/migrations/20261001220000_business_upload_quotas.sql) to the Price Market Supabase project (for example, in the Supabase SQL Editor). It creates private session/slot tables and atomic server-only functions. Row-level security is enabled and forced, and `anon`/`authenticated` have no table or function access. Only the Vercel server endpoint uses the service-role key to create sessions and reserve, finalize, or remove slots.

The ledger enforces one active logo, cover, and PDF slot, up to five active gallery slots, and rejects duplicate signed-URL requests for an occupied slot. Replacements require the current uploaded object path and are limited to five signed-URL issues per individual slot. Gallery issuance is capped at ten URLs per session (five initial files plus a bounded replacement allowance). Session creation is capped at ten per IP per hour. These counters are stored in Supabase and locked transactionally, so parallel Vercel instances cannot bypass them.

## Flow and review gate

1. The browser requests a proof-of-work challenge and then creates a pending upload session. The database records each challenge ID only once; the endpoint returns a random submission ID and signed capability token scoped to that ID, expiring after 12 hours.
2. For each selected file, the browser asks the endpoint for a signed URL. The server only issues one for the expected image/document role, MIME type and size.
3. The browser uploads bytes directly to Supabase Storage and reports progress.
4. The browser asks the endpoint to finalize. The server checks Storage metadata and reads the file signature before returning its public URL.
5. The onboarding Step 5 preview uses those URLs. The submission remains `Pending review`; it is still sent through the existing Google Apps Script pipeline.
6. `profileDataJson.media` contains `logoUrl`, `coverUrl`, `galleryUrls`, and `documentUrl`. The legacy `logoImage`, `heroImage`, and `gallery` fields are retained for publishing compatibility.

Replacing a logo, cover image, or document reserves that existing slot, uploads a new unique object first, then asks the server to remove the old pending object. Removal first checks the path against the active/previous ledger reference without mutating it, deletes the Storage object, and commits the ledger change only after Storage succeeds. If Storage is temporarily unavailable, the original reference stays tracked and the same remove request can be retried. A confirmed already-missing object is treated as a successful deletion so a retry can finish after a lost response. The onboarding preview keeps a failed replacement cleanup attached to the new asset and provides a retry action; another replacement is blocked until the pending cleanup finishes. Remove buttons call the same server endpoint. No browser Storage delete/update policy is required. Abandoned uploads are not published; periodically review/delete old `pending/` objects in Storage if abandoned submission cleanup is needed. Expired session/slot rows may also be pruned after pending-object cleanup.

## Local and deployment verification

The repository tests mock Supabase Storage and need no service key. To verify a live upload on a deployed Preview, apply the quota migration, configure the two Vercel variables, ensure Storage CORS allows that Preview origin, and submit test files within the bucket limits. Confirm the file appears only under `pending/<submission-id>/` and the business remains pending review. For local Vercel development only, set `BUSINESS_UPLOAD_ALLOWED_ORIGINS` to a comma-separated list of exact HTTPS origins; never use this override in Production or Preview.

