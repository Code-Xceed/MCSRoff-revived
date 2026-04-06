# MCSR Auth Website

This folder contains a simple local website and auth backend for the mod.

It provides:

- website account creation with unique `username`
- unique `display_name`
- password-based sign-in
- device-code linking for the Minecraft mod
- revocable access and refresh tokens for the mod

## Run

```powershell
cd website
npm start
```

Smoke-test the full local auth flow:

```powershell
cd website
npm run test-auth
```

The service starts on:

- website: `http://localhost:8080`
- mod auth API: `http://localhost:8080/mod-auth`

## Mod Defaults

The mod is configured to use:

- `webAppBaseUrl = http://localhost:8080`
- `webAuthApiBaseUrl = http://localhost:8080/mod-auth`

So once this server is running, the in-game auth flow should point to the correct local website automatically.

## Routes

Website pages:

- `/`
- `/register`
- `/login`
- `/dashboard`
- `/link`

Mod auth API:

- `POST /mod-auth/device/start`
- `POST /mod-auth/device/poll`
- `POST /mod-auth/refresh`
- `GET /mod-auth/me`

## Storage

Data is stored locally in JSON files under `website/data`.

This is good for local development and integration testing. Before public deployment, move these records to a real database and a properly managed backend runtime.
