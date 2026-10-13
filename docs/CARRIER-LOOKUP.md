# Official carrier lookup

The runnable Node service retrieves the public [easyJet cabin-bags page](https://www.easyjet.com/en/help/baggage/cabin-bags). It does not sign in, retrieve bookings, send trip data, buy bags, or contact the carrier on a traveller's behalf. The supported scope is ordinary seated-passenger cabin bags. Hold luggage, infant exceptions, dangerous goods, extra items and other carriers remain outside this adapter.

## Run and configure

Use Node 22.18 or newer; this minimum follows [Node’s native TypeScript execution documentation](https://nodejs.org/api/typescript.html). `npm ci`, `npm run build`, then `npm start` serves the built app and lookup at `http://127.0.0.1:3001/`. For development use `npm run api` and `npm run dev` in separate terminals. `vite preview` also proxies `/api/` to the local service. A static-only deployment can still run the local planner but cannot retrieve the source.

Process environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` only for an intentional container/service deployment |
| `APP_PORT` | `3001` | App and public API port |
| `CARRIER_CACHE_FILE` | `.carrier-cache/easyjet.json` | Public source cache; keep writable and persistent across restarts |
| `APP_ALLOWED_ORIGINS` | empty | Comma-separated exact cross-origin clients; never a wildcard |
| `VITE_CARRIER_API_ORIGIN` | unset | Build-time HTTPS origin for native lookup; no path, credentials or trailing slash |

The supplied Android build has no deployed API origin configured. It explains that live retrieval is unavailable and retains manual records and restored public-rule copies. To enable native retrieval, operate the service behind HTTPS, set `VITE_CARRIER_API_ORIGIN` before the web build and Capacitor sync, and configure the exact client origin on the server (`https://localhost` for this Android Capacitor configuration; `capacitor://localhost` for iOS). Native transport and CORS must then be accepted on hardware. No service has been deployed by this work.

The optional [Dockerfile](../deploy/Dockerfile) and [Compose configuration](../deploy/compose.yaml) bind the host port to loopback, run without root, retain only the public source cache and leave TLS to an operator's reverse proxy. The image build and all 90 tests passed on Linux with Node 22.23.3. A local container ran as uid 1000 with a read-only root filesystem, retrieved the real official page, wrote its public cache, and reused the same retrieval timestamp after restart. The base image is pinned to the tested manifest digest. The Compose file passed configuration validation; public hosting, TLS, native phone connectivity and a deployed Compose service remain unverified. Do not expose a native API endpoint over plain HTTP.

## Lookup protocol

`GET /api/v1/carrier-rules/easyjet` is intentionally public and accepts no query parameters, request body, booking identifiers or arbitrary URLs. All other provider paths return 404; unsupported methods return 405; unexpected input returns 400; unavailable source without a valid cache returns 503; more than 120 API requests in one minute per process returns 429 with `Retry-After`. TLS and any additional fleet-level limits belong at the reverse proxy.

Success returns `{ data: CarrierCatalog, meta: { delivery, warning? } }`. `delivery` is `retrieved`, `cached`, or `fallback`. `data` includes the carrier, canonical source URL, original retrieval timestamp, SHA-256 of the response, adapter version, seven-day stale window, and three allowance variants:

- Small under-seat bag included across fares for seated passengers.
- Large cabin bag added to the flight booking through an add-on or Plus benefit.
- Large bag with Inclusive Plus or an unbooked Plus membership benefit, subject to locker space and possible placement in the hold.

The parser reads limits from the page, cross-checks repeated values and requires the associated entitlement, handles/wheels, placement and available-space statements. Changed or ambiguous structure fails closed. It does not silently substitute bundled numbers. The response hash identifies the retrieved HTML; it is not a signed attestation or proof of booking applicability.

Provider requests use the fixed canonical HTTPS URL, omit cookies/credentials, reject redirects, have a 15-second timeout and a 1.5 MB streaming limit. Concurrent lookups are coalesced. A successfully retrieved copy is reused for an hour; the interface explicitly identifies cached delivery. Failures have a one-minute retry backoff. Error responses do not reveal stack traces or file paths. The service stores public source information only, without trip records or an access-log implementation.

## Saved records, edits and offline behavior

The browser saves a validated retrieved copy in its existing local database and includes it in JSON backups. The service worker deliberately excludes `/api/` from its generic cache. Offline use therefore displays the saved copy with its real retrieval time rather than a silently cached HTTP response. Opening the page does not automatically perform a lookup; the traveller starts retrieval explicitly.

Saving an allowance requires selecting exactly one bag. Route/fare context and booking confirmation remain local. The initial booking checkbox is unchecked; editing the carrier, context, source, limits, notes or selected bags resets a previous confirmation. The interface identifies manually changed numeric limits or source as an override and retains the immutable retrieved baseline. Refreshing the catalog never replaces existing trip records, overrides or confirmations. A new manual review cannot make an old retrieved source fresh. A newer catalog with different numeric limits flags the older saved record for immediate review, without changing it; changing HTML hashes alone does not trigger a false rule-change warning.

Neither a current source nor a traveller confirmation establishes physical fit, packed weight or carrier acceptance. Missing outside measurements and bag weights remain incomplete. Piece allowances across saved records are disclosed but not automatically enforced. Automatically verifying routes, fares, operating airlines and passenger entitlements remains future work.
