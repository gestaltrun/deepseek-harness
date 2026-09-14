---
description: "Product IM account and Workspace configuration through public Client objects and UI slots."
kind: "package-plugin"
---

# @gestaltrun/dsh-ui-im

English | [中文](README.zh.md)

## Summary

This product plugin adds IM Accounts to Settings and takeover configuration to the selected Workspace's settings. It consumes the IM API's configuration and candidate objects; components receive only localized props and commands. The right-sidebar IM entry uses the existing tab registry and body slot.

## Table of Contents

- [Product composition](#product-composition)
- [Account and route operations](#account-and-route-operations)
- [Workspace presentation](#workspace-presentation)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

## Product composition

Compose this package with the product IM API, the existing Workspace UI, settings, locale, and right sidebar. Client configuration `directoryPicker` selects `browse` by default or `native` when the Host supplies its native chooser. The Node companion owns no domain services. The Client requests the shell's shared React, Cordis, store, slots, and primitives; package-private utilities and CSS are bundled. Development dependencies for the published primitive library are test/build inputs, not additional browser module requests.

## Account and route operations

Accounts display separate authorization and listener facts. Setup uses provider-discovered identities and sends credential fields only through the write-only Host operation. A failed setup stays visible; it never marks an account connected. Pause uses the displayed account revision. Disconnect and reconnect controls are disabled until corresponding provider lifecycle commands are available.

The route editor preserves every specific target. New routes start disabled. Existing ownership transfers require confirmation containing the observed owner and revision. Each target keeps its operation identity and outcome; partial and unknown results retain the draft. Unknown outcomes are queried before retry. Confirmed targets are not resent. Rebinding preserves the existing enabled state and applies the requested trigger settings using the returned revision.

## Workspace presentation

The product replaces only the public `sidebar.workspaces` presentation at a higher slot priority. Its settings action carries the actual clicked Workspace identity. Search, grouping, drag ordering, rename, delete, Session actions, navigation, and directory picking retain the pinned upstream presentation recorded in [UPSTREAM.json](UPSTREAM.json). Product child slots avoid redeclaring the upstream directory-flow slot; unloading restores the original browser and leaves its directory contribution intact.

Focused tests cover credentials, confirmation, multi-target partial results, and the adapted Workspace browser. These checks do not constitute full installed GUI acceptance. Simulation-target controls, authoritative conversation history, double-Session navigation, and stop actions remain pending their Host APIs; the IM tab currently reports that conversation viewing is unavailable.

## Model Experience

The UI adds no model-visible input. Host runtime commands own any subsequent Session behavior.

### KV Cache effect

None directly.

## Dev Note

No invariant companion is published: the UI owns presentation and editable drafts, while authoritative records remain in the IM Client object. Slot ownership, restoration tests, and typed props enforce presentation composition. Account/provider and simulation acceptance remain distinct from these tests.
