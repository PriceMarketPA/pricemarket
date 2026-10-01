# Price Market Local SEO Foundation

## Public URLs and indexability

The static generator `scripts/generate-local-seo-pages.js` builds these five indexable city hubs:

- `/mechanicsburg/`
- `/camp-hill/`
- `/carlisle/`
- `/harrisburg/`
- `/hershey/`

Each city hub has its own title, description, intro, city context, discovery guidance, and links to the existing marketplace. The copy does not claim that a city has participating businesses or inventory that is not present in approved data.

The generator also creates these four route types for each city (20 total): `/deals/`, `/happy-hour/`, `/businesses/`, and `/jobs/`. For example, `/mechanicsburg/deals/` and `/hershey/jobs/`. They provide type-specific guidance and link to the existing homepage filters with city and listing type preselected. They are `noindex,follow` and excluded from the sitemap until the city/type is supported by at least three `demo:false` businesses with that listing type and at least 35 words of city-specific discovery guidance. This avoids indexing empty/thin doorway pages. Do not lower the gate to pad page count.

When that gate is met, rerun `node scripts/generate-local-seo-pages.js`. The generator will make that route indexable and add it to the sitemap. An approved profile's deals, Happy Hours, jobs, and business presence are inferred only from the corresponding fields in `businesses.js`; `demo:true`, missing, or otherwise ambiguous approval status is never eligible.

## Business profile URLs and schema

New approved profiles have a clean URL: `/business/<slug>/`. Vercel rewrites this to the existing reusable `business-profile.html` renderer with the `business` query parameter. The existing `business-profile.html?business=<slug>` route stays functional, and `keystone-pizza.html` remains the legacy demo redirect. Demo content is `noindex,follow` and is never listed in the sitemap.

`LocalBusiness` JSON-LD is emitted only for an explicitly approved (`demo:false`) profile with an unambiguous, complete postal address that matches its city/state data. Incomplete or inconsistent addresses result in no LocalBusiness schema. No rating, review, price range, opening hours, or offer schema is synthesized. Keep the site's organization as `Organization`; Price Market has no asserted storefront address.

## Rebuild and review

After adding an approved profile through the existing human-reviewed publishing workflow:

1. Verify `demo:false`, city, listing fields, slug, and any address against the reviewed source.
2. Add the profile entry to `businesses.js` and ensure no duplicate slug exists.
3. Run `node scripts/generate-local-seo-pages.js` to regenerate city/category pages and `sitemap.xml`.
4. Review the generated page's title, canonical, robots directive, visible copy, links, and JSON-LD. Confirm that city/type pages remain `noindex` until the threshold is met.
5. Run `node --test scripts/*.test.js business-onboarding.test.js` and the responsive browser checks.
6. Create a PR and retain human review/merge as the publication gate.

## Crawl and metadata conventions

- Production origin is `https://pricemarketpa.com` (without `www`).
- Each indexable URL has one self-referencing canonical.
- The homepage has `Organization` and `WebSite` JSON-LD. City and discovery pages add `WebPage` and `BreadcrumbList`.
- `robots.txt` allows crawling and references `https://pricemarketpa.com/sitemap.xml`.
- Sitemap generation includes the homepage, city hubs, qualified city/type routes, and approved clean business-profile routes. It excludes onboarding, legacy/demo pages, query-string profile routes, and noindex city/type pages.
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
