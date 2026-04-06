# Web Auth Contract

This mod no longer treats anonymous client identity as authoritative.

The trusted identity source is your website auth backend.

## Base URLs

Configure these in the mod:

- `webAuthApiBaseUrl`
- `webAppBaseUrl`

Example:

- `webAuthApiBaseUrl = https://your-site.com/api/mod-auth`
- `webAppBaseUrl = https://your-site.com`

## Device Code Flow

### `POST /device/start`

Request:

```json
{
  "minecraft_name": "codeXceed",
  "loader": "fabric",
  "scope": "mcsr_mod"
}
```

Response:

```json
{
  "device_code": "dev_123",
  "user_code": "ABCD-1234",
  "verification_uri": "https://your-site.com/link",
  "verification_uri_complete": "https://your-site.com/link?code=ABCD-1234",
  "expires_in": 600,
  "interval": 3
}
```

### `POST /device/poll`

Request:

```json
{
  "device_code": "dev_123"
}
```

Pending response:

```json
{
  "status": "pending"
}
```

Approved response:

```json
{
  "status": "approved",
  "session": {
    "access_token": "mod_access_token",
    "refresh_token": "mod_refresh_token",
    "expires_at": 1778000000,
    "user": {
      "id": "web_user_uuid",
      "username": "codexceed",
      "display_name": "codeXceed",
      "elo": 1420,
      "rank_tier": "Gold I"
    }
  }
}
```

Denied response:

```json
{
  "status": "denied"
}
```

Expired response:

```json
{
  "status": "expired"
}
```

## Session Refresh

### `POST /refresh`

Request:

```json
{
  "refresh_token": "mod_refresh_token"
}
```

Response:

```json
{
  "access_token": "new_access_token",
  "refresh_token": "new_refresh_token",
  "expires_at": 1778000000,
  "user": {
    "id": "web_user_uuid",
    "username": "codexceed",
    "display_name": "codeXceed",
    "elo": 1452,
    "rank_tier": "Gold II"
  }
}
```

## Authenticated Profile

### `GET /me`

Headers:

```text
Authorization: Bearer <access_token>
```

Response:

```json
{
  "id": "web_user_uuid",
  "username": "codexceed",
  "display_name": "codeXceed",
  "elo": 1452,
  "rank_tier": "Gold II",
  "status": "active"
}
```

## Matchmaker Auth

All matchmaking endpoints should accept the same website-issued bearer access token.

The bearer token should represent:

- one exact website user id
- one revocable session id
- expiry
- optional scopes like `mcsr_mod`

The mod should never mint identity locally.

Every time the mod opens the matchmaking menu, it should validate the stored access token against `GET /me`. If that fails, it should attempt `POST /refresh`. If both fail, the user must authenticate again.

## Recommended Backend Ownership

Website backend should own:

- user auth
- device code issuance
- token minting and refresh
- bans / account state
- matchmaking authorization

Supabase should remain infrastructure:

- storage
- realtime
- queue / match state backing

## Competitive Rule

Ranks, Elo, and match history must key off the website user id, not the local Minecraft username.
