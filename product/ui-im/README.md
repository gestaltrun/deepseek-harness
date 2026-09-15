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

Accounts display separate authorization and listener facts. Setup uses provider-discovered identities and sends credential fields only to the write-only verification operation. The UI clears secret input after provider verification returns or fails and displays the verified identity and authorization before confirmation. Cancellation distinguishes released, confirming, and already confirmed setups. An unknown confirmation reuses the same Host setup and operation identifiers. Pause, disconnect, reconnect, and authorization refresh send lifecycle commands using the displayed account revision. Disconnect confirmation uses the account name, route count, and revision captured when it opens. Pending or unknown lifecycle operations disable further account commands; the retained operation identity drives receipt lookup instead of repeating the command.

The route editor preserves every specific target. New routes start disabled. Existing ownership transfers require confirmation containing the observed owner and revision. Each target keeps its operation identity and outcome; partial and unknown results retain the draft. Unknown outcomes are queried before retry. Confirmed targets are not resent. Rebinding preserves the existing enabled state and applies the requested trigger settings using the returned revision.

## Workspace presentation

The product replaces only the public `sidebar.workspaces` presentation at a higher slot priority. Its settings action carries the actual clicked Workspace identity. Search, grouping, drag ordering, rename, delete, Session actions, navigation, and directory picking retain the pinned upstream presentation recorded in [UPSTREAM.json](UPSTREAM.json). Product child slots avoid redeclaring the upstream directory-flow slot; unloading restores the original browser and leaves its directory contribution intact. Workspace settings keep their header inside the viewport while the cards scroll in a bounded content region; narrow cards place actions below their text. The [browser layout check](tests/browser/check-settings-layout.mjs) exercises long-list selection, confirmation, and closing at narrow and wide viewport sizes.

Focused tests cover endpoint admission, credential clearing, identity confirmation, setup cancellation races, confirmation replay, lifecycle receipt lookup, multi-target partial results, and the adapted Workspace browser. These checks do not constitute full installed GUI acceptance. Simulation-target selection and clearing use the runtime's guarded route references and receipt lookup; an unknown response keeps its operation identity for reconciliation. The target picker shows real connection intent, authorization expiry, rule enablement, and identity availability separately; a stopped listener alone does not disable simulation. The Session list follows durable instances and labels both sides, including the stopped state. The IM tab creates from the selected simulated-user Session, uses Host-provided peer and delivery scopes, injects allow-listed participant or managed-human messages, and confirms stopping before awaiting the terminal result. The public Tool-view slot renders all four simulation calls with a purple channel marker and the durable input/result plus isolation copy. Frozen target facts and later configuration drift remain visible while stopped and failed instances stay read-only.

## Model Experience

The UI adds no model-visible input. Host runtime commands own any subsequent Session behavior.

### KV Cache effect

None directly.

## Dev Note

No invariant companion is published: the UI owns presentation and editable drafts, while authoritative records remain in the IM Client object. Slot ownership, restoration tests, and typed props enforce presentation composition. Account/provider and simulation acceptance remain distinct from these tests.
