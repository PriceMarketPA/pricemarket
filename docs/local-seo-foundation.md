# Price Market Local SEO Foundation

## Public URLs and indexability

The static generator `scripts/generate-local-seo-pages.js` builds these five indexable city hubs (canonical URLs omit the final slash to match Vercel's existing routing):

- `/mechanicsburg`
- `/camp-hill`
- `/carlisle`
- `/harrisburg`
- `/hershey`

Each city hub has its own title, description, intro, city context, discovery guidance, and links to the existing marketplace. It renders one section for Deals, Happy Hours, Businesses, and Jobs from explicitly approved (`demo:false`) matching profile data. Each section links to its clean business profiles or explains that no approved listings are available. The copy does not claim a city has inventory that is not present in approved data. The homepage city tiles link to these hubs.

The generator also creates these four route types for each city (20 total): `/deals`, `/happy-hour`, `/businesses`, and `/jobs`. For example, `/mechanicsburg/deals` and `/hershey/jobs`. They provide type-specific guidance, current approved listings with profile links, and links to the existing homepage filters with city and listing type preselected. A route becomes `index,follow` and enters the sitemap only when it has at least three approved, non-demo matching listing entries and enough distinct city/category guidance (25 words of city-specific discovery notes, 45 words of category guidance, and 100 words of city intro/guide copy). Otherwise it remains `noindex,follow` and is excluded from the sitemap. This avoids indexing empty/thin doorway pages. Do not lower the gate to pad page count.

When that gate is met, rerun `node scripts/generate-local-seo-pages.js`. The generator will make that route indexable and add it to the sitemap. An approved profile's deals, Happy Hours, jobs, and business presence are inferred only from the corresponding fields in `businesses.js`; `demo:true`, missing, or otherwise ambiguous approval status is never eligible. Listing entries are counted by type, so a profile can contribute multiple distinct deal or job entries, while the Businesses route counts one profile per business.

## Business profile URLs and schema

New approved profiles get a static clean URL at `/business/<slug>` (generated as `business/<slug>/index.html`) using the existing reusable profile renderer. The generator writes the approved profile's title, description, canonical, social metadata, visible business information, image alt text, and JSON-LD into the initial HTML response. The client renderer leaves this prerendered SEO content intact; query-based/demo routes continue to use the existing dynamic renderer. The existing `business-profile.html?business=<slug>` route stays functional and `noindex,follow`, and `keystone-pizza.html` remains the legacy demo redirect. Demo and pending content are never generated as clean profile pages or listed in the sitemap.

Vercel keeps `cleanUrls:true` and the pre-existing `trailingSlash:false`. Legacy `.html` requests receive Vercel's 308 redirect to the extensionless URL while retaining query strings; slash-suffixed clean paths receive one 308 to the no-slash canonical. For example, `/business-profile.html?business=keystone-pizza` resolves to `/business-profile?business=keystone-pizza`. The query-profile canonical and social URL use that final extensionless destination. Keeping the original slash policy also preserves the onboarding page's root-relative asset resolution at `/business-onboarding`, where its relative `styles.css` and script URLs resolve from the site root.

A profile JSON-LD graph is emitted only for an explicitly approved (`demo:false`) clean profile. Its LocalBusiness subtype is selected from the supplied category (for example Restaurant, CafeOrCoffeeShop, BeautySalon, or ExerciseGym). Only supplied values are included; available city/state may be represented without inventing a street address. Opening-hours markup is emitted only when days and times parse cleanly. No rating, review, price range, or offer schema is synthesized. Google can still require additional details for particular rich-result features; accurate structured data does not guarantee a rich result. Keep the site's organization as `Organization`; Price Market has no asserted storefront address.

## Rebuild and review

After adding an approved profile through the existing human-reviewed publishing workflow:

1. Verify `demo:false`, city, listing fields, slug, and any address against the reviewed source.
2. Add the profile entry to `businesses.js` and ensure no duplicate slug exists.
3. Run `node scripts/generate-local-seo-pages.js` to regenerate city/category pages, approved clean profile pages, and `sitemap.xml`.
4. Review the generated page's title, canonical, robots directive, visible copy, links, and JSON-LD. Confirm that city/type pages remain `noindex` until the threshold is met.
5. Run `node --test scripts/*.test.js business-onboarding.test.js` and the responsive browser checks.
6. Create a PR and retain human review/merge as the publication gate.

## Crawl and metadata conventions

- Production origin is `https://pricemarketpa.com` (without `www`).
- Each indexable URL has one self-referencing canonical. City, category, and profile URLs consistently omit the trailing slash, matching `trailingSlash:false`.
- The homepage has `Organization` and `WebSite` JSON-LD. City and discovery pages add `WebPage` and `BreadcrumbList`.
- `robots.txt` allows crawling and references `https://pricemarketpa.com/sitemap.xml`.
- Sitemap generation includes the homepage, About, For Businesses, city hubs, qualified city/type routes, and approved clean business-profile routes. On the current data set the five hubs plus homepage/About/For Businesses are included; no type page qualifies and the only business profile is a demo. It excludes onboarding, legacy/demo pages, query-string profile routes, and noindex city/type pages.
- Onboarding carries `noindex,follow`; it is not disallowed in robots.txt so crawlers can see that directive.
- Do not use structured data to state facts absent from the reviewed business data.

## Google Search Console setup after merge

1. In Google Search Console, add a **Domain property** for `pricemarketpa.com`.
2. Copy Google's DNS TXT verification value into the DNS provider for the domain. Wait for DNS propagation, then click **Verify** in Search Console. No verification token is committed to this repository.
3. Open **Sitemaps** for the verified property and submit `https://pricemarketpa.com/sitemap.xml`.
4. Use **URL inspection** for the homepage and the five city hub URLs, test the live URL, and request indexing where offered.
5. After Google has recrawled, review the Sitemaps and Page Indexing reports for fetch errors, canonical selection, and excluded URLs. No indexing outcome is guaranteed by submission.

## Local copy references used

City facts are intentionally limited to stable geography/community context. The source links below were reviewed while writing the copy:

- The Mechanicsburg Museum Association's local timeline documents the Cumberland Valley Railroad opening service through town in 1837–1839: https://www.mechanicsburgmuseum.org/our-history
- Camp Hill's downtown business district is described in borough materials: https://www.camphillborough.com/agendas%20and%20minutes/Council/2024%20Agendas/Council%20Packet%203-13-24.pdf
- Carlisle's county-seat and Cumberland Valley context appears in its annual report: https://www.carlislepa.org/finance/CAFR/Annual%20Report%202022.pdf
- Harrisburg identifies itself as the state capital and discusses its Susquehanna waterfront: https://www.harrisburgpa.gov/contact_us.php and https://www.harrisburgpa.gov/services/planning/floodplain.php
- Derry Township's official history describes Hershey's connection to the township and the chocolate company: https://www.derrytownship.org/history
