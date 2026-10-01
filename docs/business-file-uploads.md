# Business onboarding file uploads

Business onboarding uses short-lived, server-issued Supabase Storage signed upload URLs. The browser sends file bytes directly to Storage so 10 MB images and 15 MB PDFs do not pass through the Vercel Function request body limit. The server signs uploads, validates role/type/size, checks the stored object metadata and file signature, and only then returns a public URL. The service-role key is used only inside `api/business-assets.js`.

## Vercel environment variables

Add these variables to the Price Market Vercel project for **Preview** and **Production** (and Development if running Vercel locally):

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://ofjykpqfdogdpmpneuaz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | The server-side service-role/secret key from the Price Market Supabase project. Store it as a Vercel encrypted environment variable. |

Do not name the key `NEXT_PUBLIC_*`, add it to any HTML/JS asset, commit it, or expose it in browser configuration. Rotate it in Supabase if it has ever been exposed. Redeploy after setting or rotating it.

The public Storage buckets remain `business-images` (JPG, PNG, WebP, HEIC, HEIF; 10 MB) and `business-documents` (PDF; 15 MB). Keep those limits and MIME allowlists configured in Supabase as a second enforcement layer. Because these buckets are public, anyone who obtains an uploaded URL can read that file; upload only materials meant for eventual public business profiles, not private/confidential documents. Pending files are not displayed on the marketplace and are not published into a profile automatically.

The upload endpoint has no browser CORS allowlist of its own and accepts same-origin requests. The direct browser-to-Storage PUT is cross-origin; if project API origins have been restricted, allow the production site and the Vercel Preview origins used for QA. Do not enable anonymous insert/update/delete policies to make uploads work: the signed URL is the scoped upload permission, and the endpoint uses the server key for verification and removal.

## Flow and review gate

1. The browser requests a pending upload session. The endpoint returns a random submission ID and a signed capability token scoped to that ID, expiring after 12 hours.
2. For each selected file, the browser asks the endpoint for a signed URL. The server only issues one for the expected image/document role, MIME type and size.
3. The browser uploads bytes directly to Supabase Storage and reports progress.
4. The browser asks the endpoint to finalize. The server checks Storage metadata and reads the file signature before returning its public URL.
5. The onboarding Step 5 preview uses those URLs. The submission remains `Pending review`; it is still sent through the existing Google Apps Script pipeline.
6. `profileDataJson.media` contains `logoUrl`, `coverUrl`, `galleryUrls`, and `documentUrl`. The legacy `logoImage`, `heroImage`, and `gallery` fields are retained for publishing compatibility.

Replacing a logo, cover image, or document uploads a new unique object first, then asks the server to remove the old pending object. Remove buttons call the same server endpoint, which verifies the scoped token and path before deleting. No browser Storage delete/update policy is required. Abandoned uploads are not published; periodically review/delete old `pending/` objects in Storage if abandoned submission cleanup is needed.

## Local and deployment verification

The repository tests mock Supabase Storage and need no service key. To verify a live upload on a deployed Preview, configure the two Vercel variables, ensure Storage CORS allows that Preview origin, and submit test files within the bucket limits. Confirm the file appears only under `pending/<submission-id>/` and the business remains pending review.
