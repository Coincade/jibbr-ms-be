# Desktop Electron versioning & backward compatibility

## Goals

Allow multiple Jibbr Electron builds (e.g. `0.1.0` and `0.1.1`) to talk to the same production backend safely, while giving operations a way to later declare a minimum supported version and force outdated clients to update.

## Concepts

| Term | Meaning |
|------|---------|
| `latestVersion` | Newest published desktop build (`JIBBR_DESKTOP_LATEST_VERSION`) |
| `minimumSupportedVersion` | Oldest desktop build still allowed (`JIBBR_DESKTOP_MIN_VERSION`) |
| `updateAvailable` | `current < latest` |
| `updateRequired` | `current < minimum` (or force-update policy) |
| `supported` | Client may continue using the product |

## Environment variables

Configure the **same values on every HTTP/WebSocket service**:

```env
JIBBR_DESKTOP_LATEST_VERSION=0.1.1
JIBBR_DESKTOP_MIN_VERSION=0.1.0
JIBBR_DESKTOP_UPDATE_URL=https://jibbr-releases.blr1.digitaloceanspaces.com
JIBBR_DESKTOP_FORCE_UPDATE=false
JIBBR_DESKTOP_REQUIRE_VERSION=false
```

- `FORCE_UPDATE=true` treats any client behind `latest` as required-update.
- `REQUIRE_VERSION=true` rejects identified desktop clients that omit/invalid version metadata (**phase 2 only**). Keep `false` until all supported builds send headers.

## First rollout (do not lock out existing users)

Production `0.1.0` did **not** send `X-Jibbr-*` headers. Therefore:

1. Deploy backend that **accepts** desktop requests without version metadata (`REQUIRE_VERSION=false`).
2. Ship Electron that sends headers + WS metadata.
3. Observe adoption (`GET /internal/desktop-versions` on socket-service with `X-Internal-Secret`).
4. Only then raise `JIBBR_DESKTOP_MIN_VERSION` and optionally set `REQUIRE_VERSION=true`.

## Normal release order

1. Additive DB migrations (if any).
2. Backward-compatible backend deploy (min stays ≤ oldest supported client).
3. Publish Electron release + Spaces update feed.
4. Coexist old + new clients.
5. Raise minimum when adoption is safe.
6. Remove temporary compatibility code later.

## API

`GET /api/client/version-status` (auth, messaging, upload, call, socket) — unauthenticated.

Headers on desktop HTTP:

```http
X-Jibbr-Client: desktop
X-Jibbr-Version: 0.1.0
X-Jibbr-Platform: darwin
X-Jibbr-Arch: arm64
```

Unsupported desktop APIs return **426** with:

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

Web/mobile/internal clients without `X-Jibbr-Client: desktop` are never version-blocked.

## WebSocket

Desktop clients send version via:

- Query: `/ws?client=desktop&version=…&platform=…&arch=…`
- Auth payload fields and/or `client_info` event

Unsupported clients receive `client_version_unsupported` then close **4403**. Electron must stop reconnecting.

## Admin stats

```http
GET /internal/desktop-versions
X-Internal-Secret: <INTERNAL_SERVICE_SECRET>
```

## Electron local simulation

Unpackaged only:

```env
JIBBR_DEV_CLIENT_VERSION=0.0.9
```

Spoofs the reported client version for headers, WS, and version-status checks. Ignored when `app.isPackaged`.

## Source of truth

- Installed app version: Electron `app.getVersion()` (from `package.json` / builder).
- Policy (latest/min): backend env, evaluated in `@jibbr/shared-utils`.
