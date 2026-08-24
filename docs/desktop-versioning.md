# Client versioning (desktop / mobile / web)

## Goals

Allow multiple Jibbr client builds to talk to the same backend safely, while giving operations a way to declare a **per-client** minimum supported version and force outdated clients to update.

Supported client IDs (header `X-Jibbr-Client`):

| Client | ID | Env prefix | Default latest / min |
|--------|----|------------|----------------------|
| Electron | `desktop` | `JIBBR_DESKTOP_*` | `0.1.1` / `0.1.0` |
| React Native | `mobile` | `JIBBR_MOBILE_*` | `1.0.0` / `0.0.0` |
| Website | `web` | `JIBBR_WEB_*` | `0.0.0` / `0.0.0` |

Policies are **independent** — raising desktop min never blocks web `0.0.0` or mobile `1.0.0`.

## Concepts

| Term | Meaning |
|------|---------|
| `latestVersion` | Newest published build for that client |
| `minimumSupportedVersion` | Oldest build still allowed for that client |
| `updateAvailable` | `current < latest` |
| `updateRequired` | `current < minimum` (or force-update policy) |
| `supported` | Client may continue using the product |

## Environment variables

Configure the **same values on every HTTP/WebSocket service**:

```env
# Desktop (Electron)
JIBBR_DESKTOP_LATEST_VERSION=0.1.1
JIBBR_DESKTOP_MIN_VERSION=0.1.0
JIBBR_DESKTOP_UPDATE_URL=https://jibbr-releases.blr1.digitaloceanspaces.com
JIBBR_DESKTOP_FORCE_UPDATE=false
JIBBR_DESKTOP_REQUIRE_VERSION=false

# Mobile (React Native / Expo)
JIBBR_MOBILE_LATEST_VERSION=1.0.0
JIBBR_MOBILE_MIN_VERSION=0.0.0
JIBBR_MOBILE_UPDATE_URL=
JIBBR_MOBILE_FORCE_UPDATE=false
JIBBR_MOBILE_REQUIRE_VERSION=false

# Web (jibbr-website)
JIBBR_WEB_LATEST_VERSION=0.0.0
JIBBR_WEB_MIN_VERSION=0.0.0
JIBBR_WEB_UPDATE_URL=
JIBBR_WEB_FORCE_UPDATE=false
JIBBR_WEB_REQUIRE_VERSION=false
```

- `FORCE_UPDATE=true` treats any client behind `latest` as required-update.
- `REQUIRE_VERSION=true` rejects identified clients that omit/invalid version metadata (**phase 2 only**). Keep `false` until all supported builds send headers.

## First rollout (do not lock out existing users)

Production Electron `0.1.0` did **not** send `X-Jibbr-*` headers. Therefore:

1. Deploy backend that **accepts** requests without version metadata (`REQUIRE_VERSION=false`).
2. Ship clients that send headers (+ WS metadata for desktop/mobile).
3. Observe adoption (`GET /internal/desktop-versions` on socket-service with `X-Internal-Secret`).
4. Only then raise `*_MIN_VERSION` and optionally set `REQUIRE_VERSION=true` **per client**.

## Normal release order

1. Additive DB migrations (if any).
2. Backward-compatible backend deploy (min stays ≤ oldest supported client).
3. Publish client release (Electron Spaces / App Store / website deploy).
4. Coexist old + new clients.
5. Raise minimum when adoption is safe.

## API

`GET /api/client/version-status` (auth, messaging, upload, call, socket) — unauthenticated.

Headers on identified HTTP clients:

```http
X-Jibbr-Client: desktop|mobile|web
X-Jibbr-Version: 1.0.0
X-Jibbr-Platform: ios|android|darwin|win32|web
X-Jibbr-Arch: arm64
```

Unsupported APIs return **426** with:

```json
{
  "error": {
    "code": "CLIENT_VERSION_UNSUPPORTED",
    "message": "This version of Jibbr is no longer supported.",
    "currentVersion": "0.0.9",
    "minimumSupportedVersion": "0.1.0",
    "latestVersion": "0.1.1",
    "updateRequired": true
  }
}
```

Clients **without** a known `X-Jibbr-Client` are never version-blocked (phase 1).

## WebSocket

Desktop / mobile clients send version via:

- Query: `/ws?client=mobile&version=…&platform=…&arch=…`
- Auth payload fields and/or `client_info` event

Unsupported clients receive `client_version_unsupported` then close **4403**. Clients must stop reconnecting.

## Admin stats

```http
GET /internal/desktop-versions
X-Internal-Secret: <INTERNAL_SERVICE_SECRET>
```

## Local simulation

| Client | Override (dev only) |
|--------|---------------------|
| Electron (unpackaged) | `JIBBR_DEV_CLIENT_VERSION=0.0.9` |
| React Native | `EXPO_PUBLIC_DEV_CLIENT_VERSION=0.9.0` (`__DEV__` only) |
| Website | `VITE_DEV_CLIENT_VERSION=0.0.0` (dev builds) |

## Source of truth

- Desktop: Electron `app.getVersion()`
- Mobile: Expo `app.json` / `expo-constants` version
- Web: `package.json` version (injected via Vite `define` / `VITE_APP_VERSION`)
- Policy (latest/min): backend env, evaluated in `@jibbr/shared-utils`

## Rollout checklist

Staging verify → production coexistence → force newer mins: see [desktop-versioning-rollout.md](./desktop-versioning-rollout.md).
