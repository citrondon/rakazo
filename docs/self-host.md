# Self-hosting

## Connectors for beginners (Gmail, Calendar, and more)

Bots reach apps like Gmail or Google Calendar through connectors. Credentials are encrypted on
the server and never returned by the API.

**Option A — managed catalog (Composio):**

1. Set `COMPOSIO_API_KEY` in `.env` and restart the stack.
2. In the web app open **Settings → Integrations**, search the app (for example Gmail), and
   press **Connect**. An OAuth window opens; sign in with the account the bot should use.
3. The connector's tools become available to your bots automatically.

**Option B — MCP server (no managed catalog):**

1. In the web app open **Settings → Integrations → Add MCP server** and paste the HTTPS URL of
   an MCP server for the app.
2. Credential tools are treated as writes; the bot asks before consequential actions per your
   approval policy.

Both options work per user, not per bot — every bot in the space can use a connected app.
A quick end-to-end check: message a bot with *"Summarize my unread Gmail messages"* and confirm
it answers from the inbox, not from imagination.

## Overview

The signed-in product is a long-running API, a Graphile Worker, Postgres, and a computer provider (Docker supervisor, E2B, Daytona, CreateOS, or Box). It is not a static site. The marketing site in `apps/www` can be hosted separately.

### Renamed settings (`RAKAZO_` to `BOBBOT_`)

Deployment settings used to be named `RAKAZO_*`. They are now `BOBBOT_*`, and both spellings keep working: the API, worker, updater, supervisor and web build copy a legacy name onto its new one before reading anything, and the Compose files fall back to the legacy name when the new one is unset. So an existing `.env` needs no edit. Rename at your convenience — a setting whose new name is present always wins, which lets you move one variable at a time. The same applies to systemd units, which read their `EnvironmentFile` as-is.

Only the names of settings changed in that pass. Docker service, image, volume and network names, the `data` directory and the Compose project name are unchanged.

## Local (source checkout)

Same as the README quick start: `.env` from `.env.example`, Postgres via Compose, `pnpm sandbox:build`, `pnpm dev`, then [http://127.0.0.1:5173](http://127.0.0.1:5173) (or `http://localhost:5173` — both loopback hosts are trusted). Electron: `pnpm --filter @bobbot/desktop dev` while that stack is up, choosing **Existing instance** with that address. The desktop app's **This computer** option instead installs and runs the published images itself with Docker Compose (see [Published images](#published-images-no-checkout)), using port 45173 by default so it can run alongside `pnpm dev`. If that port is occupied, the app selects and remembers another loopback port. The managed API gets a Docker-assigned loopback port; all desktop traffic uses the web origin. If `pnpm dev` and the Compose stack collide on 5173 or 3100, set `BOBBOT_WEB_PORT` / `BOBBOT_API_PORT` in `.env` (see [Port conflicts](#port-conflicts-3100--5173)).

For source development in WSL, keep the checkout and `data` directory in the Linux filesystem (for example, `~/rakazo`), and run `pnpm dev` as your normal user. The host-run supervisor matches bot container UID/GID to that user. If Docker Desktop container IPs are unreachable, set `SANDBOX_CONTROL_VIA_LOOPBACK=true` in `.env`; this publishes the token-protected control service on a random loopback port. Leave this unset for the Compose-hosted supervisor.

Compose bot homes mount only their own subdirectory of the application volume using Docker volume semantics. Docker's internal volume paths are never used as host bind mounts.

## Published images (no checkout)

Pull Postgres and `ghcr.io/elie222/rakazo/app` into any empty folder. No clone or image build.
Requires Docker Engine 26+ (API 1.45+ for bot home volume subpaths), the Compose plugin, curl, and OpenSSL.

```bash
mkdir -p rakazo && cd rakazo &&
curl -fsSLO https://raw.githubusercontent.com/elie222/rakazo/main/infra/compose/install-images.sh &&
bash install-images.sh
```

The installer downloads `docker-compose.images.yml` and `.env.images.example`, creates `.env` with
random secrets, then pulls and starts the images. It preserves an existing `.env` when rerun. For
the installer secret list, non-reuse rules, and recovery, see
[Self-host secrets checklist](./self-host-secrets.md). To customize the public URL, image tag, or
optional providers before startup, run `bash install-images.sh --prepare-only`, edit `.env`, then
run `bash install-images.sh`. Flags may be combined in either order: `--prepare-only`, `--local`.

`SANDBOX_PROVIDER` defaults to `docker`. The images Compose file runs a sandbox supervisor
(from the app image, on the internal network only) and pulls `ghcr.io/elie222/rakazo/computer`.
Signup and local Docker computers work without an E2B account. Optional remote providers: set
`SANDBOX_PROVIDER` to `e2b`, `daytona`, `createos`, or `box` and add the matching API key. The published-images
Compose stack requires `SANDBOX_SUPERVISOR_TOKEN` for every provider; leave it empty and `compose up` fails closed.

Optional: set `OPENROUTER_API_KEY` or connect a model in the UI after signup.
Auto Review uses that LLM checker by default. To use TypeSafe Jev instead, set
`BOBBOT_AUTO_REVIEW_PROVIDER=jev` and `TYPESAFE_API_KEY`. Core still runs with neither.

The example defaults to `edge` (main builds). Every publish is multi-arch (`amd64` + `arm64`), so
arm64 hosts need no special tag. Do not assume `latest` is present until a stable release exists.

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The first registered user becomes the
deployment owner. Put TLS in front of `:5173` for a public host and set the three public origins to
that HTTPS URL.

Images Compose binds web to loopback (`127.0.0.1:5173`). Terminate TLS on the host and proxy
there. Vite preview same-origin-proxies `/api` and `/rpc`, so do not expose `:3100`. Set
`BETTER_AUTH_URL`, `WEB_ORIGIN`, and `API_URL` to that same HTTPS origin, and set
`BOBBOT_HOST` to its hostname (for example, `app.example.com`).

```Caddyfile
app.example.com {
	reverse_proxy 127.0.0.1:5173
}
```

Open **Agent computer** on a bot, or send a message that uses the desktop, to see
the local Docker computer. For in-stack Caddy plus remote E2B computers, use the
[production Compose](#public-single-vm-deployment) path and `infra/compose/Caddyfile.prod`
instead of this host proxy.

### Port conflicts (3100 / 5173)

`api` binds `127.0.0.1:3100` and `web` binds `127.0.0.1:5173` by default — the same ports a host
`pnpm dev` uses. When one is taken, Docker reports `bind: address already in use` /
`port is already allocated`, or with `up --wait` a service that never becomes healthy.

Name the current owner, then move the port:

```bash
lsof -nP -iTCP:3100 -sTCP:LISTEN   # or: ss -lntp '( sport = :3100 )'
```

```env
# .env — set before `docker compose up`. 0 lets Docker assign a free loopback port (API only).
BOBBOT_API_PORT=0
BOBBOT_WEB_PORT=5174
```

Both variables work in the source-checkout Compose file and in `docker-compose.images.yml`; leave
them unset to keep 3100 and 5173. The desktop app's **This computer** stack handles this itself: it
probes its web origin before starting the containers, moves to another loopback port with an
`already in use` notice, and launches the API with `BOBBOT_API_PORT=0`.

If you move `BOBBOT_WEB_PORT`, keep `BETTER_AUTH_URL`, `WEB_ORIGIN`, and `API_URL` on the new
origin, and update the host proxy in front of it.

### Restricted networks / mirror downloads

If the installer, Compose downloads, or image pulls are blocked, use the
[restricted-network guide](./self-host-restricted-network.md) for mirror settings and local files.

### Bot computer resource ceilings

Each Docker computer runs Xvfb, a window manager and a full Chromium driven by an agent that
decides for itself what to open, so it is capped. These defaults provide a starting point for the
Docker computer topology:

| Variable | Default | Accepts |
| --- | --- | --- |
| `BOBBOT_COMPUTER_MEMORY` | `2g` | `2g`, `1536m`, a byte count. Minimum `6m`, Docker's own floor. Also caps swap, so the ceiling holds. |
| `BOBBOT_COMPUTER_CPUS` | `2` | Whole or fractional cores, e.g. `1.5` |
| `BOBBOT_COMPUTER_PIDS_LIMIT` | `2048` | A positive integer |

Set any of them to `0`, `none` or `unlimited` to remove that ceiling. A malformed value fails the
supervisor at startup naming the variable, rather than surfacing later as a failed bot.

### Computer egress

Docker computers have full outbound access by default — the public internet plus the Docker
host's own addresses, the LAN, and link-local cloud metadata endpoints such as
`169.254.169.254`. On a cloud VM that last path is instance-credential theft for anything a
bot runs. `SANDBOX_COMPUTER_EGRESS` picks how much of that a computer keeps:

| Mode | A computer may reach |
| --- | --- |
| `open` (default) | Everything the host can, including the host itself and cloud metadata. |
| `restricted` | The public internet only: browsing, DNS, apt, git over SSH. Everything non-public and the host are dropped. |
| `allowlist` | Only the IP addresses and CIDR blocks in `SANDBOX_COMPUTER_EGRESS_ALLOW`, plus DNS. Everything else is dropped. |
| `offline` | Nothing at all, name resolution included. |

`allowlist` takes addresses, not names: a domain list would need a filtering resolver, which
this deployment does not ship. Resolve the endpoints you need yourself and keep the ranges
updated, for example
`SANDBOX_COMPUTER_EGRESS_ALLOW=203.0.113.7,198.51.100.0/24`. DNS stays reachable so names
still resolve — if a computer must not reach anything, not even a resolver, use `offline`.

Except for `open`, enforcement has two parts:

1. Set the mode in `.env` and recreate the supervisor. Each computer network then gets a
   deterministic host bridge name (`rakazo-c…`) instead of a generic `br-*`.
2. Apply the host ruleset once per Docker host, passing the same mode and list:

   ```bash
   sudo SANDBOX_COMPUTER_EGRESS=allowlist SANDBOX_COMPUTER_EGRESS_ALLOW=203.0.113.7 \
     bash infra/compose/restrict-computer-egress.sh
   ```

   On a no-checkout install, download it first:
   `curl -fsSLO https://raw.githubusercontent.com/elie222/rakazo/main/infra/compose/restrict-computer-egress.sh`.
   A shell does not read `.env` by itself, so pass the values here as well; the script records
   them in its systemd unit so reboots reapply the same policy. It rewrites the chains to the
   current mode, takes back the rules a previous mode installed, and leaves rules it never
   wrote alone. `--print` shows the exact rules without changing anything; `--remove`
   uninstalls.

In `restricted` mode the script drops forwarded traffic from `rakazo-c*` bridges to all
non-public IPv4/IPv6 destinations via the `DOCKER-USER` chain and adds an `INPUT` drop so
computers cannot open connections to the host (established replies to host-initiated control
and screen connections still flow). `allowlist` replaces the destination list with the
allow-listed blocks and adds a catch-all drop; `offline` drops every destination and DNS.

Screen streaming is unaffected: the supervisor and web proxy join each computer's bridge,
and the ruleset exempts traffic whose in- and out-interface are both `rakazo-c*` before
any drop (that exemption is load-bearing on hosts where `br_netfilter` feeds bridged
frames through `FORWARD`). Rules match interface names rather than subnets, so computer
create/delete cycles need no firewall maintenance; deleting a computer removes its
traffic from the match and nothing else. A computer provisioned before the flag flips
is replaced on its next provision — resuming it on an unnamed bridge would bypass the
restriction.

To disable enforcement, set `SANDBOX_COMPUTER_EGRESS=open`, recreate the supervisor, and run
`sudo bash infra/compose/restrict-computer-egress.sh --remove`. The flag alone does not
uninstall the host rules, which keep matching the still-named `rakazo-c*` bridges until
removed.

Do not use a restrictive mode if computers must reach LAN services, an internal proxy, or
endpoints bound to the host; use `allowlist` with those addresses instead. Requires Linux
Docker Engine with the iptables backend — Docker Desktop, rootless Docker, and
`firewall-backend: nftables` are unsupported. The `SANDBOX_SCREEN_NETWORK=internal` topology
shares one network instead of per-bot bridges, so no mode applies there.

## Docker Compose (single machine)

1. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD` (`openssl rand -hex 16`), plus `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, and `SCREEN_PROXY_SECRET` to independent long random strings (32+ characters; 64 hex for `ENCRYPTION_KEY`). Docker sandboxes also need a dedicated `SANDBOX_SUPERVISOR_TOKEN`. Keep existing `ENCRYPTION_KEY` values so stored credentials stay decryptable.
2. Set `OPENROUTER_API_KEY` (and `COMPOSIO_API_KEY` if you want Plugins).
3. Build the computer image: `pnpm sandbox:build` (Compose also builds it via the `computer` service).
4. `docker compose --env-file .env -f infra/compose/docker-compose.yml up --build`
5. Open the web origin (`http://127.0.0.1:5173` by default). The first registered user becomes the deployment owner.

On Windows, if an older clone with `core.autocrlf=true` leaves the computer pane hung on boot (`bash\r` in sandbox logs): from a clean worktree, set `git config core.autocrlf false`, run `git add --renormalize . && git checkout -- .`, then rebuild with `pnpm sandbox:build`.

Compose runs Postgres, the sandbox supervisor (Docker socket), API, worker, and a Vite preview of the web app. Bot computers are sibling containers (`rakazo/computer:local`) on separate per-bot networks; only the supervisor and screen proxy join each one. The API process does not get an unrestricted Docker socket; the supervisor owns the lifecycle.

Postgres stays on the Compose network only (not published on the host), matching the images
compose. Credentials come from `.env` (`POSTGRES_PASSWORD` is required). Prefer a URI-safe value
(`openssl rand -hex 16`); characters such as `@ : / ? # %` break the interpolated `DATABASE_URL`
inside Compose. Official Postgres images set user, password, and database only on first volume
init, so an existing `pgdata` volume keeps its original identity: keep those values in `.env`, or
change them in place with `ALTER ROLE` / rename. Recreate the volume only after a backup (or when
the data is disposable); `docker compose down -v` deletes all Postgres state. For host-side clients
(`pnpm db:migrate`, GUI tools),
add `infra/compose/docker-compose.postgres-host.yml` so Postgres is published on loopback
`127.0.0.1:5433`, or use
`docker compose --env-file .env -f infra/compose/docker-compose.yml exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`.
Do not publish Postgres on a public interface.

The Docker supervisor is not published as its own image and is not exposed on the host. It runs from
the app image, stays on the internal Compose network, and holds the Docker socket because access to
it is equivalent to control of the Docker host. Docker sandboxes require `SANDBOX_SUPERVISOR_TOKEN`
(API, worker, supervisor). `SCREEN_PROXY_SECRET` signs browser-screen capabilities (API and web
proxy). Keep both distinct from `BETTER_AUTH_SECRET`.

New credentials use versioned AES-GCM with per-record salt and row-bound AAD. Legacy ciphertext stays readable.

On a VPS, put TLS in front of `:5173` (or serve the web build behind your proxy) and set:

```env
BETTER_AUTH_URL=https://app.example.com
WEB_ORIGIN=https://app.example.com
API_URL=https://app.example.com
```

Cookies and CORS follow those origins. `SIGNUPS_ENABLED` seeds whether registration is open
when the API starts for the first time and is not reapplied on restart. A non-empty
`SIGNUP_ALLOWLIST` is applied on every API start, replacing the allowlist stored for the deployment.
Leave it empty to keep that stored list.

With a nonempty signup allowlist and SMTP configured, users—including existing accounts—must
verify their email to sign in. On a fresh instance with no SMTP, the first allowlisted account
can register without verification. That signup does not prove mailbox ownership, so create the
account before exposing the service. Further accounts still need SMTP.

For a public deployment, configure SMTP and an allowlist before the API's first start.
Keep an installation without email on a trusted local network.

### Optional OpenID Connect SSO

SSO works with a self-hosted or hosted OpenID Connect provider. Leave its settings unset to
keep password authentication alone. Configure all three credentials together on the API:

```env
OIDC_ISSUER=https://identity.example.com
OIDC_CLIENT_ID=replace-with-client-id
OIDC_CLIENT_SECRET=replace-with-client-secret
OIDC_NAME=SSO
OIDC_SCOPES=openid email profile
AUTH_PASSWORD_ENABLED=true
OIDC_ALLOW_SIGNUP_BYPASS=false
```

The issuer must be HTTPS and exactly match the discovery document's issuer. BobBot loads
`<issuer>/.well-known/openid-configuration`, verifies ID tokens against discovery JWKS with
issuer, audience and nonce checks, and uses authorization codes with PKCE. Additional scopes
may be space- or comma-separated; `openid email profile` are always requested. `OIDC_NAME`
is the button label, defaulting to “SSO”. Secrets remain on the API; Compose clears the worker's
OIDC credentials. The capabilities endpoint exposes only the label, discovery availability,
and enabled authentication methods.

Register this redirect URI at the provider (using your public `BETTER_AUTH_URL` origin):

```text
https://app.example.com/api/auth/callback/oidc
```

Web, Electron and mobile use the same provider redirect URI. Electron completes SSO in a
sandboxed in-app popup sharing the app's session, then returns to the main window. Mobile completes the callback
on the API, then returns to `rakazo://sign-in` (or `rakazo://account` for linking and reauthentication) through Better Auth's Expo authorization proxy
and a native auth browser session. The `rakazo` app scheme is trusted by the auth server;
never register a client secret in the mobile app. Mobile stores the resulting session with
SecureStore, like password sign-in. Native builds need the Expo WebBrowser module.

Provider emails are verified only when `email_verified` is the boolean `true`. False or missing
claims stay unverified, including on subsequent sign-ins. Sign-in never links accounts by email.
If an email belongs to another account, sign in to that existing account and choose **Link SSO**
in account settings. Linking requires an authenticated session, a verified provider email and
matching email addresses. The issuer and provider subject identify the linked account thereafter. Changing issuers does
not reuse an old identity. Old-issuer links remain stored but do not count as linked to the
current provider, so **Link SSO** becomes available again. Link the new identity from the
existing signed-in account; authenticated-session, verified-email and matching-email checks
still apply. Restoring the old issuer makes its existing links usable again.

SSO signup follows closed registration and the deployment allowlist before creating an account.
Allowlisted provider emails must be verified; the password signup's first-account exemption
never upgrades an OIDC email. `OIDC_ALLOW_SIGNUP_BYPASS=true` explicitly admits IdP identities
without applying the allowlist or its email-verification admission requirement. Enable it only
when the IdP controls who may join this deployment. It does **not** reopen closed registration,
and does not change email verification claims or linking rules. Existing admitted accounts can
sign in while registration is closed.

Set `AUTH_PASSWORD_ENABLED=false` for SSO-only operation. Password sign-in, signup, password
reset and password mutation endpoints are disabled server-side, and sign-in forms are hidden.
The API refuses to start in this mode unless all OIDC credentials are configured. It can still
start while discovery is temporarily unavailable: the provider remains registered, sign-in
returns a temporary error, and background retries recover without restarting. Discovery is lazy
on first use, refreshed in the background, and failures back off up to one minute. Availability
reflects discovery, not a guarantee that the provider's token endpoint is currently reachable.

Account deletion keeps the existing password confirmation for password users. Users without a
password may delete after a provider sign-in within five minutes; **Sign in again** starts a fresh
provider round-trip bound to the signed-in account. Choosing a different identity cannot confirm
deletion or create another account in that flow. A stale or borrowed session alone cannot authorize deletion. With transactional
email configured, **Send deletion code** sends a single-use code to the account email, valid for ten
minutes. Enter it in account settings to confirm deletion. Email-code requests are rate-limited;
invalid, expired or wrong-account codes fail. No password needs to be created for deletion.

### Verification and password recovery email

Password changes for signed-in users require no email configuration. Forgotten-password recovery
appears on sign-in only when a transactional email provider is available. BobBot uses a
provider-neutral contract and ships an SMTP adapter, so Amazon SES, Resend, and self-hosted SMTP
servers use the same configuration:

```env
SMTP_URL=smtps://smtp-user:replace-with-password@smtp.example.com:465
EMAIL_FROM=BobBot <no-reply@example.com>
```

For Resend, use `smtp.resend.com`, username `resend`, and an API key as the password. For Amazon
SES, use the regional SMTP endpoint and SES SMTP credentials; these are different from ordinary AWS
access keys. Verify the sender/domain with the provider before testing delivery. Keep credentials in
`.env`, never in tracked files. `smtps://` uses implicit TLS; `smtp://` is also supported but requires
STARTTLS. BobBot rejects configuration that disables TLS or certificate verification.

Local source development can use the offline email emulator instead. It captures email without
contacting a provider:

```env
EMAIL_EMULATOR=true
```

The emulator is forcibly disabled when `NODE_ENV=production` and requires the API to bind to a
loopback host. In `NODE_ENV=development`, captured messages are available from
`http://127.0.0.1:3100/api/dev/emails` with cache disabled; the API logs only delivery
metadata, never reset tokens. The inbox route is not registered in test, staging, or production.

### Billing

Billing stays off, with no paywall, unless `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`STRIPE_PRICE_ID` are all set (see `.env.example`). Setting only some of them stops the API at
startup.

### Logging

Backend services write structured logs to stdout. `LOG_LEVEL` is `debug`, `info`, `warn`, `error`,
or `off` (default `info`). Production defaults to `LOG_FORMAT=json`; development defaults to pretty
unless you set `json` or `pretty`.

Axiom is optional. Set both `AXIOM_TOKEN` and `AXIOM_DATASET` for ingest to one shared dataset.
Services set `service.name` (`rakazo-api`, `rakazo-worker`, `rakazo-sandbox-supervisor`,
`rakazo-updater`). A partial Axiom config logs a one-time warning and stays off. `AXIOM_EDGE` is a
regional hostname; `AXIOM_EDGE_URL` must be https and wins when both are set.

Compose passes these into the API, worker, supervisor, and updater. Computer containers and updater
child commands do not receive them.

Optional:

```env
SIGNUPS_ENABLED=true
SIGNUP_ALLOWLIST=you@example.com,@company.com
SANDBOX_PROVIDER=docker   # or none, e2b, daytona, createos, box. Keep fake only for pnpm test.
AGENT_RUNTIME=pi          # Keep scripted only for pnpm test.
WAKEUP_DRIVER=graphile
SANDBOX_IDLE_MS=600000    # pause the bot computer after 10 minutes idle
SANDBOX_COMMAND_TIMEOUT_MS=300000 # stop a shell command after 5 minutes
MAX_TOOL_CALLS_PER_TURN=  # deployment-wide Pi turn tool-call fuse; unset/0 = unlimited. Each space can override it in Settings → General → Advanced ("Max tool calls per turn"); an empty field stores unlimited.
E2B_API_KEY=              # when SANDBOX_PROVIDER=e2b
DAYTONA_API_KEY=          # when SANDBOX_PROVIDER=daytona
CREATEOS_SANDBOX_API_KEY= # when SANDBOX_PROVIDER=createos
BOX_API_KEY=              # when SANDBOX_PROVIDER=box
```

To use an operator-controlled OpenAI-compatible server such as Ollama, LM Studio, llama.cpp, or
MLX, list its model IDs and an endpoint that both the API and worker processes can reach:

```env
BOBBOT_LOCAL_MODELS=qwen3:4b,llama3.1:8b,qwen3-vl
BOBBOT_LOCAL_MODELS_URL=http://127.0.0.1:11434/v1
BOBBOT_LOCAL_CONTEXT_WINDOW=32768
BOBBOT_LOCAL_MAX_TOKENS=4096
# Optional: model ids on this endpoint that accept images (screenshot computer tools).
BOBBOT_LOCAL_VISION_MODELS=qwen3-vl
```

The loopback default is suitable when running BobBot from a source checkout. From containers,
prefer a stable LAN RFC1918 address (not Compose service DNS alone). On Docker Desktop,
`host.docker.internal` also works.
On Docker Desktop, a bot computer shell can often reach services bound to host `127.0.0.1`
through that same hostname. Do not run sensitive unauthenticated services on loopback while
bots run, or firewall / block that path. The Compose stacks also define `host.docker.internal` on
Linux (`extra_hosts: host-gateway` on the API and worker), so the hostname resolves there too —
an endpoint bound only to the host's `127.0.0.1` still stays unreachable from a container.
Only configure an endpoint you control: prompts, attachments, and tool results sent to that model
leave BobBot through this URL. Leave `BOBBOT_LOCAL_MODELS` blank to disable the provider.

Each user can also connect their own OpenAI-compatible endpoint from **Connect a model** /
**Settings → Models** on web and mobile. Choose **OpenAI-compatible**, enter the server base URL
(for example `http://127.0.0.1:8000/v1`), the exact model id, and an optional API key.
Public hosts and ordinary hostnames need `BOBBOT_OPENAI_COMPAT_ALLOW_PUBLIC=1` and HTTPS.
Literal private IP, loopback, and `host.docker.internal` targets do not. If that endpoint's model
accepts images, enable **Supports images** under **Advanced** when connecting so attachments and
screenshot computer tools stay available. Existing connections default to disabled. For centrally
managed endpoints, the deployment-wide fallback remains
`BOBBOT_OPENAI_COMPATIBLE_VISION_MODELS=gpt4o-vision,llava`.

Remote MCP servers and installed API / GraphQL connectors default to public HTTPS. The deployment
owner can attach one on localhost, the same LAN, or a Docker network. Set
`MCP_ALLOW_PRIVATE_ENDPOINT=true` on the API and worker to allow these for every user. Cloud
metadata addresses stay blocked. Leave the flag unset on public installs.

### Endpoint gates (public vs private)

| Gate | Enable with | Default | What it allows |
| --- | --- | --- | --- |
| `MCP_ALLOW_PRIVATE_ENDPOINT` | `true` (literal, not `1`) | off | Remote MCP servers and installed API/GraphQL connectors on loopback, RFC1918, `*.internal`, Docker-network and `host.docker.internal` hosts, for every user. The deployment owner needs no flag. Cloud-metadata and link-local addresses stay blocked. Set it on **both** the API and the worker process. |
| `BOBBOT_OPENAI_COMPAT_ALLOW_PUBLIC` | `1` (literal, not `true`) | off | User-connected OpenAI-compatible endpoints on public hostnames. Private/loopback endpoints need no flag. An endpoint that receives an API key must use HTTPS either way. |
| `BOBBOT_SECRETS_ALLOW_PRIVATE_HTTP` | `1` | off | Bot credentials (`request_secret` / website logins) against plain-`http://` private origins. |
| `MCP_STDIO_ENABLED` | `true` | off | stdio MCP servers, which spawn a process on the API/worker host. |
| `MCP_STDIO_ALLOWED_COMMANDS` | comma-separated executables, e.g. `npx,node` | empty | The exact executables a stdio server may start; anything else is refused. |
| `BOBBOT_ACTION_FAIL_CLOSED` | `1`, `true`, `yes` or `on` (trimmed, case-insensitive) | off | Enforcement for the recorded action decisions: a tool that no approval rule covers asks a human instead of being allowed silently. Existing `always_allow` rules still win. Set it on **both** the API and the worker process, because whichever one runs the tool call reads it. |

The `MCP_*` switches are read as the literal `true` and the `BOBBOT_*` escape hatches as the literal
`1`; any other spelling (`TRUE`, `yes`, `true` for a `BOBBOT_*` gate) leaves the gate off.
`BOBBOT_ACTION_FAIL_CLOSED` is the one exception, and its row lists the spellings it accepts.

### Skills a bot learns need the owner's approval

`skill_create`, `skill_update` and `skill_delete` always ask the owner, whatever the auto-review
setting or the approval rules say: a skill's body becomes instructions that later runs read and
follow, so writing one is proposing a standing rule rather than making a change with a visible
result. The card shows the skill's name, description and body, offers **Allow once** or **Deny**
(no "always allow": a permanent rule here would be a blank cheque), and nothing is stored before
the answer. A denied proposal writes no skill and the bot reports the refusal in the chat.

Where the operator sees the refusal: adding an MCP server on web answers
`MCP endpoint targets a private host (…)` plus the assignment to set, the same sentence carries the
fix at connect time, and a blocked public model endpoint answers with
`BOBBOT_OPENAI_COMPAT_ALLOW_PUBLIC=1`.

For servers that accept standard `reasoning_effort`, enable **Supports thinking** under
**Advanced** when connecting. The setting is saved on the connection (no env var or restart).
Existing connections default to disabled. Reconnect former Qwen-list or deployment-local models
via **Settings → Models** and turn it on; the old environment list is no longer read.

Enabled connections default to medium thinking. Web and desktop expose **Thinking** in a bot's
advanced settings; mobile inherits the same backend policy. BobBot sends standard
`reasoning_effort` (`minimal`, `low`, `medium`, `high`, or `none` when off); the server owns
model-specific translation. Leave **Supports thinking** off when the server lacks standard effort
support. Existing token limits still apply; effort is not a separate reasoning-token budget.

Do not commit `.env`. Never put `COMPOSIO_API_KEY`, OpenRouter keys, or provider tokens in git, logs, or chat.

Optional messaging platforms (iMessage, Slack, WhatsApp, Telegram, Feishu/Lark) mount when their env credentials are set — see `.env.example`. Point a Feishu/Lark bot event subscription at `/api/v1/messaging/webhook/lark` (webhook/HTTP inbound only; do not enable long connection). Groups stay iMessage-only.

### Reading what a bot was allowed to do

Every tool action that reaches the approval gate is recorded in `action_decisions` before it
runs, and the append-only trigger rejects any later update or delete of a row. A row records one
gate pass per attempt, not the final outcome: an action a human approved and that then executed
writes another `ask` row on its replay, so rows with `decision = 'ask'` are not all held actions.
Retries and resumes can record the same action again, so deduplicate with
`count(distinct coalesce("effectId", "id"))`: a read-only tool records no effect, so its rows have
nothing to deduplicate against. A run cancelled mid-gate is the one case with no row, because nothing
was allowed and nothing ran. `wouldDeny` marks an action the gate could hold that was allowed only
because no approval rule covered it, so counting them is what to look at before turning enforcement
on. Built-in reads (`read_file`, `web_search`, `schedule_list`, …) are not held by enforcement —
they record no effect, so nothing can park them — and they are written neither as `enforced` nor as
`wouldDeny`:

```sql
select "toolName", count(*) as passes, count(distinct coalesce("effectId", "id")) as actions
from "action_decisions"
where "wouldDeny"
group by "toolName"
order by passes desc;
```

The table only grows. Run retention prunes runs, attempts, effects and progress events; it does not
reach `action_decisions`, and it could not: the append-only trigger refuses `UPDATE` and `DELETE` for
any caller, so no scheduled cleanup can trim history. Deleting a space leaves its decisions behind,
because the rows carry no foreign key by design. A deployment that must bound the table takes a
backup and disables the trigger for one maintenance window
(`ALTER TABLE "action_decisions" DISABLE TRIGGER action_decision_append_only;`, re-enabled right
after) — the deliberate cost of removing a recorded decision is the point.

## Choosing a computer provider

The Electron desktop app is a client of the same API. Docker and E2B still apply. On first launch, Electron asks the deployment owner whether bots should keep using Docker or run on this Mac as you. `SANDBOX_PROVIDER=desktop` is a separate, explicit provider that always runs commands on the service host.

- **Published images** (`docker-compose.images.yml`) default to `SANDBOX_PROVIDER=docker` with a
  local supervisor and published `ghcr.io/elie222/rakazo/computer` image. No E2B account required.
  Optional: set `e2b`, `daytona`, `createos`, or `box` plus the matching API key for remote computers.
- **Docker** is the quick-start default for published images and for a source checkout / full local
  Compose stack. Workspace bots share a persistent Team Computer by default; Private computers are
  optional. Keep the supervisor private, as the included Compose files do.
- **E2B** runs bot computers away from the BobBot host and is a good choice for public or multi-user
  production deployments. BobBot checkpoints the portable workspace and browser-profile directory to
  `DATA_DIR`; the E2B disk is a runtime cache, not the durable source of truth.
- **Daytona** provides the same remote-computer contract through Daytona sandboxes. Configure
  `DAYTONA_API_KEY` and optionally `DAYTONA_API_URL` / `DAYTONA_TARGET` / `DAYTONA_SNAPSHOT`.
- **CreateOS** provides the same remote-computer contract through CreateOS desktop sandboxes.
  Configure `CREATEOS_SANDBOX_API_KEY` and optionally `CREATEOS_SANDBOX_BASE_URL`,
  `CREATEOS_SANDBOX_SHAPE`, or `CREATEOS_SANDBOX_ROOTFS`. BobBot defaults to
  `https://api.sb.createos.sh`, `s-2vcpu-2gb`, and `desktop:1`.
- **Box by ASCII** provides a managed Linux desktop through `BOX_API_KEY` and optionally
  `BOX_API_URL`. BobBot always creates or resumes boxes with `noEnv: true`, keeps the portable
  workspace under `/home/user/rakazo-home`, and refreshes a two-hour TTL. Box uses the shared Linux
  desktop runtime and protected port routes for concurrent bot desktops. Each bot has its own
  persistent Chrome profile; logins are not shared between bots.
- **Desktop provider** / **This Mac** runs commands on the API/worker host. Docker stays the default.
  The Electron app asks once; if you choose This Mac, bots can use working directories under your home
  folder. Do not enable it on a public or shared service. macOS does not show its own permission
  dialog for this.
- **Fake** is only an emulator for verification.
- **None** boots the product without a computer host (fallback when Docker/supervisor is not
  configured, or when a remote provider is selected without its API key).

For provider configuration and health checks, see the [provider setup guide](./self-host-sandbox-providers.md).

## Backup

```bash
./scripts/backup.sh
```

This dumps Postgres (`pg_dump`) and archives `data/` into `backups/<stamp>/`. A missing
`data/` produces an empty archive; database or archive errors fail the backup. Discard the
output directory of any failed run.

## Public single-VM deployment

`infra/compose/docker-compose.prod.yml` runs the hosted product with Postgres, the API, worker, web app,
and automatic HTTPS through Caddy. It uses E2B for bot computers, so the VM never exposes a Docker
supervisor or browser containers — `infra/compose/docker-compose.prod.docker.yml` is the opt-in
overlay that runs local Docker computers on the same stack (see below). The root-equivalent updater
sidecar is an explicit opt-in profile.

Before deploying to a new Ubuntu host, create and verify a key-only `deploy` account, then apply the
idempotent host-hardening baseline. It disables SSH passwords and root login, rate-limits SSH, allows
only SSH/HTTP/HTTPS through UFW, enables fail2ban, unattended security updates, AppArmor, audit rules,
and conservative kernel/network protections. Keep the provider console open until a fresh SSH login
succeeds after the script reloads SSH.

```bash
sudo DEPLOY_USER=deploy bash infra/compose/harden-host.sh
```

The production host also uses `infra/compose/docker-daemon.json` to enable live restore, bounded local
container logs, default no-new-privileges, and the kernel NAT path instead of Docker's userland proxy.

1. Point an `A`/`AAAA` record such as `app.example.com` at the VM and allow inbound TCP 80/443 and
   UDP 443. If you use Cloudflare, enable the proxy with **Full (strict)** TLS and copy
   `Caddyfile.cloudflare.example` to an operator-controlled path outside the public checkout. Set
   `CADDYFILE_PATH` to that absolute path. The example drops application requests that do not come
   from Cloudflare's [published IP ranges](https://www.cloudflare.com/ips/); reconcile those ranges
   whenever Cloudflare publishes a change. A Cloudflare Tunnel can replace the public web listeners.
2. Clone the repository on the VM and create a root `.env` with production-only values. At minimum set
   `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `SCREEN_PROXY_SECRET`,
   `OPENROUTER_API_KEY`, the API key for your selected sandbox provider,
   `BOBBOT_HOST`, and the three public origins. Set `BOBBOT_DEPLOY_DIR` when the checkout is not at
   the supported Linux default, `/srv/rakazo`. Use URL-safe random values for database credentials.
   If you enable the `updater` profile, also set a dedicated `BOBBOT_UPDATER_TOKEN` (at least 32
   characters) that differs from `BETTER_AUTH_SECRET`, `SANDBOX_SUPERVISOR_TOKEN`, and
   `SCREEN_PROXY_SECRET`.
3. Keep registration allowlisted while the service is private:

```env
NODE_ENV=production
BOBBOT_HOST=app.example.com
# Optional operator-owned override, for example the Cloudflare allowlist file:
# CADDYFILE_PATH=/etc/rakazo/Caddyfile.prod
BETTER_AUTH_URL=https://app.example.com
WEB_ORIGIN=https://app.example.com
API_URL=https://app.example.com
SIGNUPS_ENABLED=true
SIGNUP_ALLOWLIST=owner@example.com,reviewer@example.com
# e2b, daytona, or box
SANDBOX_PROVIDER=e2b
AGENT_RUNTIME=pi
WAKEUP_DRIVER=graphile
DATA_DIR=/data
# Absolute path of this checkout as the Docker daemon sees it. /srv/rakazo is the Linux default;
# set this explicitly for every other layout. See "The deploy directory must be one path" below.
BOBBOT_DEPLOY_DIR=/srv/rakazo
BOBBOT_IMAGE_TAG=local
# Optional: required only with `--profile updater`.
# BOBBOT_UPDATER_TOKEN=replace-with-32-plus-character-updater-token
```

4. Build the images from your checkout and start the stack, then verify its public health endpoint:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml \
  build --build-arg GIT_SHA=$(git rev-parse HEAD)
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml \
  up -d --wait --pull never
curl --fail https://app.example.com/health
```

**Build, do not pull, for a first deployment.** `BOBBOT_IMAGE_TAG` ships as `local`, a tag no
registry serves, so the commands above build `api`, `worker`, and `web` from the checkout you just
cloned. The opt-in command under [Updater sidecar](#updater-sidecar) builds `updater` when needed.

The public `/health` only reports liveness. Runtime, sandbox, and revision details stay on the API
port at `/internal/health`, which the edge does not route:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml exec api \
  node -e "fetch('http://127.0.0.1:3100/internal/health').then(r=>r.text()).then(console.log)"
```

Passing `GIT_SHA` is what makes `/internal/health` report a `"revision"`; a locally built image has no
other way to know its commit. Prebuilt images from the registry bake it in at publish time, so when
you switch to a release tag you should leave `GIT_SHA` unset — a value in `.env` would override what
the image already knows.

Once a release has been published you can switch this host to prebuilt images by setting
`BOBBOT_IMAGE_TAG` to that release tag and running `pull` followed by `up -d --wait --pull never`.
See [Published images and tags](#published-images-and-tags) for the tag contract.

The root `.env` is excluded from both Git and the Docker build context. The database, application data,
and Caddy certificates live in named Docker volumes.

The production Compose file pins Postgres and Caddy to multi-architecture manifest digests, and the
published application/updater builds pin their base-image digests. Refresh those pins deliberately
when taking upstream security updates; changing only the visible major tag does not change the
content while a digest is present.

For the single-VM production layout, install `infra/compose/backup-prod.sh` as
`/usr/local/sbin/rakazo-backup` and enable the supplied `rakazo-backup.timer`. It creates a verified
Postgres custom-format dump plus an application-data archive under `/var/backups/rakazo`, with mode
`0600` and seven-day rotation. These local snapshots help with operator mistakes but are not a
substitute for an encrypted off-host backup or provider snapshot.

The scheduled backup uses `/srv/rakazo` by default. For another deployment directory, set
`BOBBOT_DEPLOY_DIR=/absolute/path/to/checkout` in a root-owned `/etc/rakazo/backup.env`
(mode `0600`). The service reads this optional file on each run; the script uses the selected
checkout's `.env` and production Compose file. If the stack was started with a custom `-p`,
set the same `COMPOSE_PROJECT_NAME` in that file. For a manual run, export these variables instead.
When updating an existing backup installation, reinstall both the script and service unit,
then run `systemctl daemon-reload`.

<a id="rename-the-deployment"></a>

### Renaming the deployment to `bobbot` (optional)

Earlier releases named the deployment `rakazo`: the Compose project, the volumes Docker derives from
it, the deploy directory `/srv/rakazo`, `/etc/rakazo/backup.env`, and the `rakazo-backup` systemd
units. Nothing forces you to change that — every one of those names keeps working, and the Compose
files read the old volume prefix on purpose. If you want the new spelling anyway, do it in one go,
with the stack stopped:

```bash
cd /srv/rakazo
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml down
infra/compose/rename-deployment.sh --apply --systemd   # --systemd needs root
```

The script reads the volumes the running stack actually mounts (not a name rebuilt from the project
name), refuses to run while a container still holds one of them, copies each volume to
`bobbot-prod_<name>`, saves `.env` as `.env.rename-<timestamp>`, then writes
`BOBBOT_VOLUME_PREFIX=bobbot-prod` and `COMPOSE_PROJECT_NAME=bobbot-prod`. It never deletes the old
volumes, so the rollback is putting the old prefix back into `.env` and redeploying. It also installs
`bobbot-backup.service`/`.timer`, `/usr/local/sbin/bobbot-backup` and a readable
`/etc/bobbot/backup.env`, while `rakazo-backup.*` become symlinks to the new names so an existing
timer or CI key keeps working. Without `--apply` it only prints the plan.

For single-VM installs, install it as `/usr/local/sbin/rakazo-backup` today; after `--systemd` the same
command exists as `/usr/local/sbin/bobbot-backup` and `/usr/local/sbin/rakazo-backup` links to it. Set
`BOBBOT_DEPLOY_DIR` in `/etc/bobbot/backup.env`; the old `/etc/rakazo/backup.env` stays in the unit as
a fallback, and a value in the new file wins.

Not renamed, and not renameable: the published images `ghcr.io/elie222/rakazo/{app,updater,computer}`
come from the upstream project. The blog URLs in `apps/www/src/content/blog/` keep their slugs.

To deploy from CI, install `infra/compose/deploy-main.sh` as `/usr/local/sbin/rakazo-deploy-main`
and give CI a key restricted to it in the deploy user's `authorized_keys`
(`restrict,command="/usr/local/sbin/rakazo-deploy-main" ssh-ed25519 …`). CI waits for the checks on
`github.sha` and passes that full commit as the requested SSH command (`ssh … <sha>`); the script
deploys exactly that revision and refuses a branch name, a short SHA, or a commit that is not on
`origin/main`, so a `main` that moved after the checks cannot change what ships. It resets the
checkout to the revision, builds with `GIT_SHA` set to it, runs `up --wait`, then confirms the new
API revision on `/internal/health`, a ready worker, and the public `/health` before recording
success; any failure rolls back to the previous revision. Build and start are time-limited so a
stuck build fails the deploy instead of holding its lock; a deploy that finds the lock held exits
non-zero.

Because the API's start command runs `prisma migrate deploy`, a rollback returns the code but not
the schema. Before every real update the script therefore snapshots the live database with
`pg_dump` (custom format, `pg_restore --list` and checksum verified, mode `0600`) into
`<checkout>/.pre-deploy/<timestamp>-<revision>/`, keeping the newest three, and **refuses the whole
update** when a running database cannot be snapshotted. If the rollback itself never becomes ready
— the usual cause being that the new version migrated the schema past what the old code accepts —
the deploy does not claim recovery: it prints the snapshot path and the `restore-prod.sh` step from
[Restore](#restore) instead. Restore that snapshot, or restore the whole stack from your off-host
backup, before serving traffic again. On a first install with no running Postgres the snapshot is
skipped and the deploy says so.

By default it deploys `infra/compose/docker-compose.prod.yml`. To deploy an overlay stack, set
`BOBBOT_DEPLOY_COMPOSE_FILES` to the same space-separated `-f` list you run by hand (for example
the base file followed by `infra/compose/docker-compose.prod.docker.yml`); each path must be a
relative `.yml`/`.yaml` inside the checkout. For a checkout outside `/srv/rakazo`, put
`BOBBOT_DEPLOY_DIR=/absolute/path` in a root-owned `/etc/rakazo/deploy.env` readable by the
deploy user.

### Docker computers on the production stack

Layer `infra/compose/docker-compose.prod.docker.yml` after the base file in every Compose
invocation to run bot computers as local Docker containers instead of a remote provider:

```bash
# Pull only the pull-only dependency images (postgres, caddy, busybox);
# --pull never fails when they are absent locally.
docker compose --env-file .env \
  -f infra/compose/docker-compose.prod.yml \
  -f infra/compose/docker-compose.prod.docker.yml \
  pull --ignore-buildable
docker compose --env-file .env \
  -f infra/compose/docker-compose.prod.yml \
  -f infra/compose/docker-compose.prod.docker.yml \
  up -d --build --wait --wait-timeout 300 --pull never
```

In this topology `api`, `worker`, `web`, `supervisor`, and `computer` always build
from the checkout — `pull --ignore-buildable` only covers dependencies that have no
`build` section. To deploy published app images instead of building, use the base
file without the overlay. If `docker compose up --help` lacks `--wait-timeout`
(older Compose), drop `--wait` and verify with `docker compose ... ps` instead;
`--wait` alone can hang on one-shot services.

The overlay adds the supervisor (app image, `user: root`, Docker socket), the one-shot `computer`
image build and `data-init` ownership fix, points the API and worker at `http://supervisor:7091`,
and makes `SANDBOX_PROVIDER=docker` the default. It needs a dedicated `SANDBOX_SUPERVISOR_TOKEN`
in `.env`; `BOBBOT_COMPUTER_*` and the `SANDBOX_*` limits apply as documented in `.env.example`.
Like the updater, the supervisor is root-equivalent on the host: it publishes no port, joins only
the internal `app` network, and Caddy has no route to it. Bot computers are sibling containers on
per-bot networks that only the supervisor and the `web` screen proxy join.

When the `updater` profile is enabled too, give the sidecar the same file list and recreate set so
updates do not leave the supervisor on the previous app image:

```env
BOBBOT_COMPOSE_FILE=infra/compose/docker-compose.prod.yml:infra/compose/docker-compose.prod.docker.yml
BOBBOT_UPDATE_SERVICES=supervisor
```

The updater pulls and recreates services but cannot rebuild the `computer` stub image
(`pull_policy: build` is not pullable). Rebuild it on the host when the computer image
should change — for example after updating the checkout:

```bash
docker compose --env-file .env \
  -f infra/compose/docker-compose.prod.yml \
  -f infra/compose/docker-compose.prod.docker.yml \
  build computer
```

## Restore

For backups created by `scripts/backup.sh`, use an empty `rakazo` database in the development
Compose stack, with application services stopped. The SQL import runs in one transaction and
stops on the first error, including conflicts with existing tables. Files are restored and
application services started only after the import succeeds.

```bash
./scripts/restore.sh backups/<stamp>
```

For backups created by `infra/compose/backup-prod.sh` (custom-format `rakazo.dump` plus
`appdata.tgz` plus `SHA256SUMS`), use `infra/compose/restore-prod.sh` on the production layout:

```bash
sudo BOBBOT_RESTORE_DIR=/srv/rakazo \
  infra/compose/restore-prod.sh /var/backups/rakazo/<stamp>
```

The production restore verifies the dump with `pg_restore --list`, the archive with `tar -tzf`, and
`SHA256SUMS` before touching anything, refuses a dirty target checkout, and refuses to overwrite a
database it can reach unless you pass `BOBBOT_RESTORE_FORCE=1`. It then restores the database in a
single transaction, replaces the files inside the API container's `/data`, and starts the stack. It
never writes a new `ENCRYPTION_KEY`: the key that was active when the snapshot was taken must
already be in the target `.env`, and the restore refuses to start the application without it.
Restoring into an installation that used a different key silently produces undecryptable
credentials, so copy the original `.env` first and diff it.

For a fresh host, the order is: install the checkout and a production `.env` copied from the source
installation (same `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`,
`SCREEN_PROXY_SECRET`), start Postgres, then run `restore-prod.sh` and let it bring up the rest.

### Off-host copies and key recovery

Snapshots under `/var/backups/rakazo` die with the host, so copy them somewhere else on a schedule
you actually test. `restic` or `borg` over an SSH target gives encrypted, deduplicated copies
without a hosted vendor; `gpg` plus any object store works too. Encrypt before they leave the host,
limit the copy credentials to append-only where the target supports it, and keep the **recovery
path** with the copy, not on the host it protects:

1. The snapshot archive itself (`rakazo.dump`, `appdata.tgz`, `SHA256SUMS`).
2. The production `.env` (`ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`,
   `SCREEN_PROXY_SECRET`) — without it the restored data cannot be decrypted or served. Store it
   encrypted (a password manager, an encrypted note, a sealed printout), never beside the
   unencrypted snapshot, and never in the repository.
3. The Compose file list and image tag the stack ran with, plus the checkout revision
   (`.last-deployed-revision`), so the restored stack matches what produced the data.

Rehearse the full path on a scratch host or a scratch directory — restore the snapshot, then log in
and confirm a chat, a file artifact, and a connected model credential still decrypt. A backup you
have never restored from is a hypothesis, not a backup. Detect silent breakage by alerting on the
backup job's non-zero exit and on snapshot age (`find /var/backups/rakazo -maxdepth 1 -mtime +1`).

## Upgrade

A Compose deployment on a published release tag upgrades by moving that tag:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml pull api worker web
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml \
  up -d --wait --pull never api worker web
```

A deployment on the default `local` tag has no registry to pull from, so it upgrades by rebuilding
the checkout instead:

```bash
git pull
GIT_SHA=$(git rev-parse HEAD) docker compose --env-file .env -f infra/compose/docker-compose.prod.yml \
  up -d --wait --pull never --build api worker web
```

`up --wait` does not report success until the new API is healthy and the worker and web containers
are running. The API's start command runs `prisma migrate deploy` before it serves, so migration
failure keeps health red. A failed CLI recreate does not auto-roll back; recover with the previous
`BOBBOT_IMAGE_TAG` (or rebuild `local`) and `up -d --wait --pull never`.

The updater sidecar has its own image and tag so an update never recreates the process performing
it. Move it deliberately by setting `BOBBOT_UPDATER_IMAGE_TAG` to the full `sha-<commit>` tag, then
running `docker compose … pull updater && docker compose … up -d --wait --pull never updater`.
Sidecar `/apply` and `/rollback` recover a failed recreate by redeploying the previously cached
image when possible; if that also fails, they report a possible mixed-version runtime.

Source checkouts (not Compose) still upgrade the old way: pull, rebuild with
`GIT_SHA=$(git rev-parse HEAD)`, run `pnpm --filter @bobbot/db migrate`, then restart API and worker.
Product contracts stay compatible across cloud and self-hosted.

### Space privacy-boundary migration

Before upgrading across migration `20260830200000_space_scope_names_and_user_credentials`, check
that every existing model and voice credential still belongs to a member of its Space. This query
uses the pre-migration `workspaceId` column name and must return no rows:

```sql
SELECT 'model' AS credential_type, credential."id", credential."userId",
       credential."workspaceId" AS "spaceId"
FROM "user_model_credentials" AS credential
LEFT JOIN "space_members" AS membership
  ON membership."spaceId" = credential."workspaceId"
 AND membership."userId" = credential."userId"
WHERE membership."id" IS NULL
UNION ALL
SELECT 'voice', credential."id", credential."userId", credential."workspaceId"
FROM "user_voice_credentials" AS credential
LEFT JOIN "space_members" AS membership
  ON membership."spaceId" = credential."workspaceId"
 AND membership."userId" = credential."userId"
WHERE membership."id" IS NULL;
```

The migration renames columns used by the API and worker and is therefore a coordinated cutover,
not an online rolling migration. Stop the old API and worker, apply the migration, and start the new
versions together. Its lock waits are bounded so contention fails the migration instead of leaving
application traffic queued indefinitely.

### Published images and tags

`.github/workflows/publish-server-image.yml` publishes to `ghcr.io/<owner>/<repo>/…`, derived from
`${{ github.repository }}` rather than hardcoded, so a fork's CI fills the fork's own namespace. For
this repository that is:

| Image | Contents |
| --- | --- |
| `ghcr.io/elie222/rakazo/app` | api, worker, web, and sandbox supervisor — one image, multiple commands |
| `ghcr.io/elie222/rakazo/computer` | Linux desktop used as each bot computer |
| `ghcr.io/elie222/rakazo/updater` | the updater sidecar, plus the Docker CLI |

`infra/compose/docker-compose.images.yml` is the no-checkout path for those app and computer tags
plus Postgres. The supervisor runs from the app image on the internal network only (not a separate
published supervisor image, and no host port). Production Compose (`docker-compose.prod.yml`) can
also pull the same app tags once `BOBBOT_IMAGE_TAG` is set to a published value.

If you deploy from your own fork, set `BOBBOT_IMAGE` and `BOBBOT_UPDATER_IMAGE` to your namespace —
your CI cannot publish into someone else's.

| Tag | Published on | Moves? |
| --- | --- | --- |
| `local` | nothing — built locally by `up --build` | rebuilt in place |
| `local-<full-commit>` | nothing — built on the server by a fork update | never |
| `vX.Y.Z`, `vX.Y` | release tags | conventionally no / on patch releases |
| `latest` | stable `vX.Y.Z` tags only (not prereleases) | yes, to the newest stable release |
| `sha-<full-commit>` | every push and manual run | source-addressed; used by the updater sidecar |
| `edge` | pushes to main | yes, to the newest main build |

Every publish, including `edge` from main merges, is multi-arch (`amd64` + `arm64`): each
architecture builds natively on its own runner and one manifest is assembled per image. Until a
stable `vX.Y.Z` has been published, GHCR may only have `edge` and `sha-*` tags; do not pin
`latest` unless that tag exists in the registry.

Building the images yourself does not need QEMU. `docker compose up --build` builds for the host's
own architecture, and a fork publishing multi-arch images should do what `publish-server-image.yml`
does: build each architecture on a native runner (GitHub Actions provides `ubuntu-24.04-arm` for
public repositories) and merge the digests into one manifest. QEMU emulation
(`docker/setup-qemu-action`, `binfmt`) still works if you have no native arm64 machine, but it is
many times slower, hours rather than minutes for the `computer` image.

The updater resolves the newest stable `vX.Y.Z` source tag but deploys its `sha-<full-commit>` image,
not `latest` or a moving minor tag. A registry tag is not an OCI digest and GHCR package writers can
replace it, so the trust boundary remains this repository's publishing credentials. The workflow
reduces that boundary by using SHA-pinned actions, read-only pull-request jobs, digest-pinned base
images, SBOM/provenance output, and a GitHub build attestation. Operators who require registry-level
content addressing can pin `BOBBOT_IMAGE` outside the automatic updater to a verified digest.

Rollback never contacts the registry: it redeploys the previous tag from the local Docker cache,
so a later tag move cannot change rollback content. Do not prune the previous application image
until the next update has been accepted. If it is missing, rollback fails closed instead of pulling
new content under an old tag.

To populate the registry the first time, run the workflow manually (`workflow_dispatch`) or push a
`v*` tag. A manual run produces `sha-<full-commit>`; only a stable `vX.Y.Z` tag (no prerelease
suffix) produces `latest`, and any `v*` tag produces semver tags. The updater ignores prereleases
and refuses the official path until a stable `vX.Y.Z` exists.

### Updater sidecar

Compose production deployments offer an opt-in `updater` profile on a private `control` network.
Normal deployments do not start it or require its credential. To enable it, set a dedicated
`BOBBOT_UPDATER_TOKEN` and explicitly start the profile:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml \
  --profile updater up -d --build updater
```

It exposes `/health`, `/state`, `/plan`, `/apply`, and `/rollback` at `http://updater:7092` with
`BOBBOT_UPDATER_TOKEN`. Operator CLI upgrades above do not need it; the sidecar is for automated
apply/rollback over that private HTTP API.

The API cannot update itself — its image has no `.git`, and nothing inside the container would
restart it — so the work happens in a separate `updater` container that outlives the recreate:

- *Official repository:* resolves the newest stable release and its source commit with
  `git ls-remote --tags`, pins the corresponding full `sha-<commit>` image tag in `.env`, keeps the
  outgoing tag in `BOBBOT_IMAGE_TAG_PREVIOUS`, explicitly pulls the new image, then runs
  `up -d --wait --pull never`. No build runs on the server.
- *Fork (Advanced):* a fork has no published images, so the sidecar fast-forwards the checkout in
  `BOBBOT_DEPLOY_DIR` and runs `up -d --build`. This builds on the server and takes minutes rather
  than seconds. Point it only at a fork you control and have reviewed — the sidecar runs that
  Compose file through a root-equivalent Docker socket.

Updates and rollbacks run one at a time. A failed pull leaves running services alone; a failed recreate restores the previous environment
pin and attempts to redeploy the cached previous image. A failed fork build also restores the
pre-update branch and commit (including when checkout succeeded but merge did not) so a later
manual `--build` cannot deploy the rejected or unintended revision. Database migrations are not
reversed. The sidecar never recreates itself, never touches Postgres or Caddy, and never runs
migrations — that ordering belongs to the API start command.

Only `https://` and `ssh://` git remotes are accepted. Merges are fast-forward only. A dirty or
untracked source tree fails closed before anything runs (the application Dockerfile uses `COPY . .`).

### The deploy directory must be one path

`BOBBOT_DEPLOY_DIR` is bind-mounted into the updater at the same path it is read from
(`${BOBBOT_DEPLOY_DIR}:${BOBBOT_DEPLOY_DIR}`), and that is load-bearing rather than tidy. Production
Compose defaults both sides to `/srv/rakazo`; set the variable for any other layout. When the
updater runs `docker compose -p <project> --file $BOBBOT_DEPLOY_DIR/infra/compose/docker-compose.prod.yml up -d`,
the Compose CLI *inside* the container expands this file's relative bind mounts — `../../.env`,
`./Caddyfile.prod` — against that path and hands the results to the daemon. The daemon has to be
able to resolve the same strings, or it silently creates empty directories where your `.env` and
Caddyfile should be. Compose makes the effective `-p` value available for interpolation but does
not automatically put it in a container's environment, so the production file explicitly assigns
`COMPOSE_PROJECT_NAME` to the updater. A standalone sidecar can instead set
`BOBBOT_COMPOSE_PROJECT_NAME`; the final fallback is `rakazo-prod`. Without that propagation, a
stack started with `-p something-else` would be left alone while a second project with a new empty
Postgres volume came up beside it.

### Deployments that layer a Compose overlay

`BOBBOT_COMPOSE_FILE` takes a list, separated the way Compose's own `COMPOSE_FILE` is
(`:` by default, or whatever `COMPOSE_PATH_SEPARATOR` says). Each entry becomes its own `--file`,
in the order given, so the updater reconciles the same stack the operator runs by hand:

```
BOBBOT_COMPOSE_FILE=infra/compose/docker-compose.prod.yml:ops/compose/overlay.yml
```

Every entry is validated separately and must stay inside `BOBBOT_DEPLOY_DIR`.

If the overlay adds a service built from the application image, name it in
`BOBBOT_UPDATE_SERVICES` (comma separated) so it is pulled, recreated and rolled back with the
rest. Otherwise an update leaves that service running the previous code:

```
BOBBOT_UPDATE_SERVICES=supervisor
```

These names are appended to the built-in `api`, `worker`, `web`, never substituted for them, so no
value here can drop a core service from an update.

The value therefore has to be the path **the daemon** sees, which is not always the path your shell
sees:

- **Linux.** The daemon shares the host filesystem, so the checkout path is the answer:
  `/srv/rakazo` is the default and supported production layout. Set `BOBBOT_DEPLOY_DIR` explicitly
  when the checkout is elsewhere.
- **Docker Desktop (Windows/macOS).** The daemon runs in a VM that mounts your drive somewhere else.
  On Windows, `C:` appears at `/run/desktop/mnt/host/c`, so a checkout at `C:\Users\you\rakazo` is
  `BOBBOT_DEPLOY_DIR=/run/desktop/mnt/host/c/Users/you/rakazo`. Host Git may use `core.autocrlf=true`; the updater ignores CR-only diffs so that does not block `/apply`. Verify the mount before deploying:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml \
  --profile updater run --rm updater git -C "$BOBBOT_DEPLOY_DIR" log --oneline -1
```

  That must print your checkout's HEAD. The two tempting wrong answers both fail: a native Windows
  path is rejected by the daemon (`mount denied: … too many colons`, because the drive letter's
  colon collides with the bind-mount separator), and `/mnt/c/...` fails *silently* — the container
  starts, the mount is an empty directory, and the updater simply reports no checkout.

### The updater's privileges

The updater holds the Docker socket, which is root-equivalent on the host. It is scoped as narrowly
as that allows:

- No `ports`, so nothing is published on the host.
- Only on the dedicated `control` network shared with the API. Caddy is not attached, so the
  reverse proxy has no route to the updater.
- Every route except `/health` requires the shared bearer token, compared in constant time.
- The process environment carries only updater settings (`BOBBOT_UPDATER_TOKEN`, deploy path,
  image name, project name). Application secrets stay in the bind-mounted `.env` that Compose
  reads for interpolation; they are not loaded into this container.
- The Docker CLI lives only in the updater image. The api, worker, and web containers keep
  `cap_drop: ALL` and no socket.

Enabling the `updater` profile requires `BOBBOT_UPDATER_TOKEN` to be a dedicated random value (at
least 32 characters in production). It must differ from `BETTER_AUTH_SECRET`,
`SANDBOX_SUPERVISOR_TOKEN`, and `SCREEN_PROXY_SECRET`. Leave the profile disabled if you would
rather not grant the capability.

## Other deployment layouts

API and worker need always-on processes; serverless request handlers are not sufficient. Use a
Node.js version supported by the root `package.json`, Postgres 16 and a persistent `DATA_DIR` volume shared by API and worker, with encrypted off-host
backups. The current home store uses a local filesystem, so deployments on separate hosts need a
shared filesystem; an object-storage adapter is not available yet.

Use the same HTTPS origin for the web app, `/api`, and `/rpc`. Preserve the authenticated screen
proxy routes. Choose a [computer provider](#choosing-a-computer-provider) appropriate to the
service's trust boundary. `SIGNUPS_ENABLED` applies on the API's first start. A non-empty
`SIGNUP_ALLOWLIST` applies on every API start.
The optional marketing site in `apps/www` can be hosted separately.

## Connect mobile clients

The iOS and Android app can also point at a self-hosted origin at runtime. On the sign-in screen, tap **Use a custom server** and enter the same HTTPS origin as `WEB_ORIGIN` (for example `https://app.example.com`). Store builds still default to `EXPO_PUBLIC_API_URL`; the in-app setting is an override for people running their own API. Changing the server signs the device out of any previous session.
