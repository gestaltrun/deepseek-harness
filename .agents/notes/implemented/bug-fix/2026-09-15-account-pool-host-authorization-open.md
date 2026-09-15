# Agent Note: Host-owned account-pool authorization open

Status: implemented

English | [中文](2026-09-15-account-pool-host-authorization-open.zh.md)

## Problem

Desktop enrollment starts device and PKCE logins and offers Open authorization in browser, but the Client opened those HTTPS URLs with `window.open`. The Electron shell denies every `window.open` request, so neither starting login nor retrying the button opened the system browser.

## Decision

The product Client posts the admitted HTTPS URL to an authenticated Host route. The Host launches the OS protocol handler (`open`, `rundll32`, or `xdg-open`) without shell interpolation. The Client still rejects non-HTTPS URLs and URLs with userinfo before the request, and a Host refusal is an error rather than a blocked popup. Starting a login that returns a URL also opens that URL immediately.

The [account-pool architecture](../../proposed/architecture/2026-09-14-plugin-account-pool.md) still forbids `window.dshDesktop` and generic URL proxies. The new route admits only HTTPS authorization URLs and launches them; it does not return credentials or accept arbitrary methods.

## Alternatives considered

**Ask Electron `shell.openExternal` through `window.dshDesktop`.** The product architecture forbids that bridge, and Web would still need a second opener.

**Change Desktop `setWindowOpenHandler` to allow HTTPS popups.** That would reopen every `window.open` in the renderer, including untrusted plugin pages, and would still not launch the user's default browser as a separate application.

**Leave the URL on screen for copy-only enrollment.** Device and PKCE flows expect the browser to open; requiring a manual copy after every login is the defect users reported.

## Consequences

Desktop and Web share one Host opener. Renderer popup policy stays deny-all. Tests cover Client Host POST, Host URL admission, and login-start plus retry open. Spawn failures remain credential-free 502 responses.
