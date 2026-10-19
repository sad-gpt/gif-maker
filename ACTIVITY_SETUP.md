# Private activity counters

Connect Upstash Redis to this project from Vercel Marketplace, choosing a free database. Connect the Production environment only. The server accepts either `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or the integration aliases `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Never prefix credentials with `NEXT_PUBLIC_`. Redeploy after connecting.

In the Vercel database browser, inspect the hash `gg:activity:totals` (or run `HGETALL gg:activity:totals`). Fields appear after their first event:

- `github_galleries`: distinct repositories reported live by a new-publish flow, verified with GitHub ownership, gallery marker, and a successful Pages build.
- `github_updates`: successful update jobs, deduplicated by repository and job ID.
- `zip_exports`: ZIP generation followed by triggering a browser download, not confirmation the file was saved or published on Netlify.

Daily UTC hashes use `gg:activity:daily:YYYY-MM-DD` and expire after 400 days. Totals and hashed deduplication IDs persist. Rate-limit keys expire after an hour; they contain an HMAC of account ID or connection IP, never the raw value. No photos, captions, names, repository URLs, or access tokens are stored in the counter database.

Collection is production-only and best effort. Missing configuration disables collection. Network failures, browser blocking, and closing the page can undercount; anonymous exports are client-reported and can be spoofed despite rate limits. These are usage statistics, not billing records or exact unique-user counts. Repeated exports are separate events. Previously published galleries are not imported. Never add the counters together and label them websites created.

Counters are private to the database dashboard; there is no public read endpoint. Verification adds two GitHub reads per first report. The app continues publishing/downloading when telemetry fails. No background retry queue is used. To check setup, make a ZIP export on the production site and inspect `zip_exports`. For public galleries, create a small test gallery and wait for the live confirmation.
