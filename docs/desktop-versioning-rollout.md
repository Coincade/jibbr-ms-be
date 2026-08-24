# Desktop versioning rollout checklist

Hand this to whoever deploys. Companion guide: [desktop-versioning.md](./desktop-versioning.md).

## Policy defaults (coexistence)

```env
JIBBR_DESKTOP_LATEST_VERSION=0.1.1
JIBBR_DESKTOP_MIN_VERSION=0.1.0
JIBBR_DESKTOP_UPDATE_URL=https://jibbr-releases.blr1.digitaloceanspaces.com
JIBBR_DESKTOP_FORCE_UPDATE=false
JIBBR_DESKTOP_REQUIRE_VERSION=false
```

Set the **same values** on every service: auth, messaging, upload, call, socket.

---

## Phase A — Staging verify (coexistence)

### A1. Env
- [x] Staging App Platform / droplet has the five `JIBBR_DESKTOP_*` vars above
- [x] `REQUIRE_VERSION=false`
- [x] `MIN_VERSION=0.1.0`

Verified 2026-08-24 against live staging.

### A2. Deploy backend
- [x] Deploy auth, messaging, upload, call, socket with those vars
- [x] Confirm each service health is OK

`origin/dev` commit `ec08e0e` (`version compatiblity`) is already serving staging. Health 200 on auth, messaging, upload, socket, and `call.jibbr.in`.

### A3. Curl smoke (staging)

```bash
AUTH=https://jibbr-dev-auth-6ib5s.ondigitalocean.app
SOCKET=https://jibbr-dev-socket-emtnf.ondigitalocean.app
# export INTERNAL_SERVICE_SECRET from staging socket-service env (do not commit)
```

- [x] Web / no desktop headers → supported

```bash
curl -sS "$AUTH/api/client/version-status" | jq
```

- [x] Desktop `0.1.0` → supported + update available

```bash
curl -sS "$AUTH/api/client/version-status" \
  -H 'X-Jibbr-Client: desktop' \
  -H 'X-Jibbr-Version: 0.1.0' \
  -H 'X-Jibbr-Platform: darwin' \
  -H 'X-Jibbr-Arch: arm64' | jq
```

- [x] Desktop `0.1.1` → supported, no update

```bash
curl -sS "$AUTH/api/client/version-status" \
  -H 'X-Jibbr-Client: desktop' \
  -H 'X-Jibbr-Version: 0.1.1' \
  -H 'X-Jibbr-Platform: darwin' \
  -H 'X-Jibbr-Arch: arm64' | jq
```

- [x] Desktop `0.0.9` → unsupported flags, HTTP **200** on version-status

```bash
curl -sS "$AUTH/api/client/version-status" \
  -H 'X-Jibbr-Client: desktop' \
  -H 'X-Jibbr-Version: 0.0.9' \
  -H 'X-Jibbr-Platform: win32' \
  -H 'X-Jibbr-Arch: x64' | jq
```

- [x] Stats endpoint authorized

Staging `/internal/desktop-versions` returned `latest=0.1.1`, `min=0.1.0`, and one active `0.1.1` user. Messaging, upload, socket, and call also serve `/api/client/version-status`.

```bash
curl -sS "$SOCKET/internal/desktop-versions" \
  -H "X-Internal-Secret: $INTERNAL_SERVICE_SECRET" | jq
```

### A4. Electron smoke (staging)
- [ ] Unpackaged / staging build with `JIBBR_DEV_CLIENT_VERSION=0.1.0` → login + chat OK, optional update
- [ ] `JIBBR_DEV_CLIENT_VERSION=0.1.1` → normal
- [ ] `JIBBR_DEV_CLIENT_VERSION=0.0.9` → blocking update screen, no socket reconnect loop

### A5. Ship metadata-sending Electron
- [ ] Publish staging/prod Electron build that sends `X-Jibbr-*` + WS client metadata
- [ ] Confirm Spaces update feed has the new version

---

## Phase B — Production coexistence

### B1. Env + deploy
- [ ] Production has the same coexistence vars (`MIN=0.1.0`, `REQUIRE_VERSION=false`)
- [ ] Deploy all five production services
- [ ] Run the same curl checks against:

```bash
AUTH=https://jibbr-prod-auth-ircsh.ondigitalocean.app
SOCKET=https://jibbr-prod-socket-rq392.ondigitalocean.app
```

### B2. Observe adoption
- [ ] Watch for several days:

```bash
curl -sS "$SOCKET/internal/desktop-versions" \
  -H "X-Internal-Secret: $INTERNAL_SERVICE_SECRET" | jq
```

- [ ] Confirm active users move onto `0.1.1` (or later)
- [ ] No unexpected `426` / `CLIENT_VERSION_UNSUPPORTED` for normal users
- [ ] Web/mobile unaffected

**Ready to force when:** remaining `0.1.0` (and older) is small enough to block, and support can handle update requests.

---

## Phase C — Force `0.1.1+` (staging first)

### C1. Staging policy change
```env
JIBBR_DESKTOP_LATEST_VERSION=0.1.1
JIBBR_DESKTOP_MIN_VERSION=0.1.1
JIBBR_DESKTOP_REQUIRE_VERSION=false
```

- [ ] Apply on all staging services
- [ ] Restart / redeploy so env is live

### C2. Staging force verify
- [ ] `0.1.0` Electron → blocked / update required
- [ ] `0.1.1` Electron → works
- [ ] Protected messaging call with desktop `0.1.0` headers → **426**
- [ ] Unsupported WS → `client_version_unsupported`, close `4403`, no reconnect spam
- [ ] Requests **without** desktop headers still succeed

### C3. Production force
- [ ] Set production `JIBBR_DESKTOP_MIN_VERSION=0.1.1` on all services
- [ ] Keep `REQUIRE_VERSION=false` unless every supported build sends headers
- [ ] Announce briefly: “Jibbr 0.1.0 is no longer supported; update to continue.”
- [ ] Re-check `/internal/desktop-versions` and error rates

---

## Phase D — Optional strict headers (later)

Only after **all** remaining supported installs send version metadata:

```env
JIBBR_DESKTOP_REQUIRE_VERSION=true
```

- [ ] Do **not** enable while any real supported clients omit headers

---

## Rollback

If force causes incidents, immediately set on all services:

```env
JIBBR_DESKTOP_MIN_VERSION=0.1.0
JIBBR_DESKTOP_REQUIRE_VERSION=false
```

Redeploy/restart env. Coexistence returns without rolling back Electron.

---

## Owners / notes

| Item | Value |
|------|--------|
| Staging auth | `https://jibbr-dev-auth-6ib5s.ondigitalocean.app` |
| Staging socket | `https://jibbr-dev-socket-emtnf.ondigitalocean.app` |
| Prod auth | `https://jibbr-prod-auth-ircsh.ondigitalocean.app` |
| Prod socket | `https://jibbr-prod-socket-rq392.ondigitalocean.app` |
| Update feed | `https://jibbr-releases.blr1.digitaloceanspaces.com` |

Never commit `INTERNAL_SERVICE_SECRET`. Export it from the socket-service env for the environment you are testing.
