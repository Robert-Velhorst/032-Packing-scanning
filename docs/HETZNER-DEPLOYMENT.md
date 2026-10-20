# Hetzner release and operations

Target: General-Server, Hetzner server 164610353, project 15925962.
Public origin: `https://032-packing-scanner.noodzakelijkonline.de`.
Web and native clients share this HTTPS service. The native binaries bundle
their own web assets; deploying the website does not update installed apps.

## Release boundary

This runbook prepares the hosting path. It does not certify metric scanning,
physical packing accuracy, Android device behavior, or iOS release readiness.
The product acceptance criteria in the README still apply. Keep accounts and
weather disabled until their separate operational checks are complete. Do not
advertise the unvalidated scanner as a measured-fit service.

## Architecture and shared-host inventory

Read-only inspection on 2026-10-20 confirmed 1 vCPU, approximately 2 GB RAM,
5 GB available on the 38-GB root filesystem, existing ShareT/Caddy, MySQL,
PostgreSQL and MemoryLayer services. Refresh that inventory before deployment.
The existing `sharet-caddy` container owns ports 80/443. Preserve its volumes,
sites and configuration; never replace it with another proxy or restart its
whole Compose project for this app.

Use a dedicated `packing032` Compose project and `packing032_edge` network.
The app is non-root, read-only, capability-free, bound to host loopback on 3001,
limited to 768 MB/0.5 CPU/128 processes, with rotated Docker logs. Caddy joins
the dedicated network and routes only the named host to `packing032:3001`.
Persist carrier cache in its own volume. Optional accounts use a separate
SQLite volume and an external raw 32-byte encryption key. Never print, commit,
or put that key in an image, environment file, or browser build.

## Build and transfer

Build on a development/CI machine with Docker, not on this small shared host:

```sh
docker build -f deploy/Dockerfile -t packing-scanning:RELEASE .
docker image inspect packing-scanning:RELEASE --format '{{.Id}}'
docker save -o packing-scanning-RELEASE.tar packing-scanning:RELEASE
```

Use an immutable release identifier and record Git SHA, image ID, archive
SHA-256, test results and the deployment time. Transfer the archive and deploy
files over authenticated SSH to `/opt/packing032/releases/RELEASE/`. Verify the
archive checksum on both ends before `docker load`. Check available disk first;
retain the previous image and release for rollback. Do not prune shared Docker
images, volumes or build caches to make room.

From the uploaded release's `deploy` directory:

```sh
export PACKING_IMAGE=packing-scanning:RELEASE
docker compose -p packing032 -f compose.yaml -f compose.hetzner.yaml config --quiet
docker compose -p packing032 -f compose.yaml -f compose.hetzner.yaml up -d --no-build
curl --fail http://127.0.0.1:3001/health/ready
```

Use exactly the same project name and overlay list for subsequent commands.
The initial service has guest data only, accounts unavailable and weather off.
Carrier requests contact the fixed official provider only when requested.

## DNS and TLS cutover

Verify the target address directly in the authenticated Hetzner console.
Create the exact subdomain A record for that server. Do not create an AAAA
record from a routed /64 prefix: first verify the actual assigned host IPv6,
firewall and end-to-end reachability. Do not change apex or unrelated records.

Back up `/opt/sharet/deploy/Caddyfile` with a dated filename. Connect the
existing Caddy container to `packing032_edge`. Preserve that network connection
in its managed Compose configuration before any later Caddy recreation.
Append only the site in `deploy/Caddyfile.packing`. Validate the combined config
inside the existing container, then reload it without restarting other services:

```sh
docker exec sharet-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec sharet-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Test DNS, HTTP-to-HTTPS redirect, a publicly trusted certificate, the homepage,
hashed assets, `/health/ready`, and account/weather disabled status from outside
the host. Verify existing ShareT and MemoryLayer routes still respond. Never
disable TLS validation to manufacture acceptance. Do not enable access logs
containing account bodies, cookies, tokens or packing data.

## Optional accounts, backups and restore

See [account configuration](ACCOUNTS.md). Add `compose.accounts.yaml` to every
command, set the exact public origin, and provide the external key file.
Registration defaults closed. Before opening it, prove sign-in, CSRF, recovery,
encrypted backup save/download, conflict handling and restart persistence over
real HTTPS with a synthetic account. Keep the recovery code private.

Backups must cover the account volume, release/configuration and the matching
encryption key. Store the key separately in restricted encrypted recovery
storage. A database backup without its matching key is unusable. Carrier cache
can be rebuilt; browser/native local-only records are not in server backups.

For a consistent maintenance backup, close registration, announce downtime,
stop only the `packing` service gracefully, then archive the entire account
volume including any SQLite WAL/SHM files. Do not copy just `accounts.sqlite`
while it is live. Restrict the archive to the operator, encrypt it off-host and
record its checksum, date, image ID and matching-key identifier (never key
bytes). Restart only packing and check readiness. Establish a daily backup
schedule and an agreed retention/deletion policy before accepting real data.
No scheduler or off-host storage has been configured merely by adding this guide.

Rehearse restore into a fresh, separate volume/container with no public route
and the matching key. Verify SQLite integrity, readiness, synthetic account
sign-in and saved-backup download, then compare the restored data with the
known fixture. Never overwrite the live volume as a restore test. Wrong-key
startup must fail. Measure recovery time and record the actual result. Keep
private test fixtures and backups outside Git.

## Monitoring and rollback

`GET /health/live` proves that the HTTP process responds. `GET /health/ready`
also requires a nonempty readable `dist/index.html` and, when accounts are
configured, a successful query of the account database. Failures return a generic
503. Both are no-store and never contact external providers. They do not prove
database write capacity, backup recoverability, provider access or device health.
Docker checks readiness; it reports unhealthy but does not itself restart an
unhealthy process. Configure an independent HTTPS check and operator alert.
Monitor container exits/restarts, memory, disk, TLS expiry and backup failures.
The app drains HTTP connections on SIGTERM, forces remaining connections closed
after 15 seconds, and then closes SQLite; Compose allows 20 seconds to stop.

For a code-only rollback, point `PACKING_IMAGE` at the retained image and use
`up -d --no-build` for packing only. Check readiness and existing proxy routes.
If schema changes are introduced in a future release, require a tested migration
and compatible rollback/restore plan before deployment. Never assume an old
binary can read a new schema. To remove public exposure, restore and validate
the backed-up Caddy configuration and remove only the new DNS record. Preserve
account/cache volumes and the matching key. Never run `down --volumes`.

## Web, Android and iOS acceptance

| Platform | Required evidence before release |
| --- | --- |
| Web | Production tests/build, hardened image smoke test, HTTPS browser workflow on desktop/mobile, offline inventory/plan behavior, permission/error/privacy journeys. |
| Android | Supported Java/SDK build, native tests/lint, signed release artifact, real device camera/depth/fallback, microphone, secure workspace, file provider, offline and lifecycle checks against the production HTTPS origin. |
| iOS | Mac/Xcode build and signing, supported iPhone/iPad tests, camera/depth/fallback, Keychain, protected data, file provider, voice and lifecycle acceptance; implement remaining unsupported native workflows before claiming parity. |
| Physical packing | Measured scan/fit/closure/replanning trials and source-bound benchmark evidence against README acceptance criteria. Synthetic geometry tests cannot substitute for these trials. |

Set `PACKING_ACCOUNT_ORIGIN` when building native bundles, and the documented
`VITE_CARRIER_API_ORIGIN` / `VITE_WEATHER_API_ORIGIN` only for enabled services.
Permit only the required native origins (`https://localhost` and
`capacitor://localhost`) using `APP_ALLOWED_ORIGINS` for the public lookup APIs.
Account transport retains its own strict HTTPS Host/Origin rules. Never set a
Capacitor development server URL for release. Complete [native account
acceptance](NATIVE-ACCOUNTS.md) and [native capture acceptance](NATIVE-CAPTURE-STORAGE.md).
