# Publishing an approved business profile

This workflow converts an approved Google Sheets onboarding submission into an entry for the existing `businesses.js` data object. It does not publish directly, edit the repository, or expose Google Sheets data in the website.

## Review and publish

1. Review the submission in the `Price Market Leads` sheet, including its contact details, business information, hours, images, deal, and any job opening.
2. Change that row's **Review Status** to **Approved** only after a person has reviewed it. New onboarding submissions start as **Pending review**.
3. Copy the row's **Profile Data JSON** cell into a local file such as `approved-profile.json`. Save the cell contents as JSON; don't include the surrounding spreadsheet quotes.
4. From the repository root, run:

   ```sh
   node scripts/create-business-profile.js --approved --input approved-profile.json
   ```

   `--approved` is a required human confirmation. The utility checks the current `businesses.js` IDs and names, validates required fields, normalizes optional data, and prints a JSON entry. It never writes to `businesses.js` itself.

5. Review the generated entry and slug. Copy the new keyed entry into `window.priceMarketBusinesses` in `businesses.js`. The key is the profile ID used by `business-profile.html?business=<slug>`.
6. Run the utility tests with `node --test scripts/create-business-profile.test.js`, review the diff, and create a PR. Merge the PR only after the normal human review; the deployment then makes the profile available.

The generated key must be unique. If a profile already uses the same normalized business name or slug, the utility stops with an error so the reviewer can resolve the duplicate instead of overwriting or creating a second listing.

## Validation and optional values

Business name, category, city, street address, description, and a valid email are required. State defaults to `PA`; avatar initials are generated from the business name. Missing or unsafe optional image URLs become blank values so the profile cover's existing background and avatar fallback remain available. Missing or invalid website data becomes `null`. Missing hours, deals, jobs, and gallery photos become empty arrays, which the existing renderer already supports.

The onboarding form's `profileDataJson` follows the profile data shape in `businesses.js`. The publishing utility preserves that renderer's field names (`heroImage`, `logoImage`, `hours`, `deals`, `jobs`, and `gallery`) and sets `demo: false` only in the generated proposal. A row remaining Pending review cannot pass the utility without a human deliberately confirming approval.

## Tests

The dependency-free Node test suite covers valid entry generation, missing required data, duplicate slugs and IDs, approval gating, safe slug generation, and optional-field fallbacks.
