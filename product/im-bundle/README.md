---
description: "An installable product profile layer for durable IM account and route configuration."
kind: "package-bundle"
---

# @gestaltrun/dsh-im-bundle

English | [中文](README.zh.md)

## Summary

This bundle adds durable IM account and route configuration to a base-backed dsh profile. It selects the product runtime and generated configuration API. The shipped Web template remains the underlying application; this bundle carries the backend subset and adds no UI or platform provider.

## Table of Contents

- [Install into a profile](#install-into-a-profile)
- [Layer behavior](#layer-behavior)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="install-into-a-profile"></a>
## Install into a profile

Build the three candidate archives with `pnpm --dir product run pack:im-bundle`. The [product workspace](../README.md) owns the build sequence and `product/dist` output directory. Candidate packages have not been published to the registry; a candidate installation must map their exact names and versions to the corresponding local archives.

The repeatable installation check uses an isolated, already-installed `@deepseek-ai/dsh@0.1.5-rc.2` consumer. Set `DSH_IM_SMOKE_INSTALL_ROOT` to that consumer directory and run `pnpm --dir product run smoke:im-profile`. The check creates a fresh profile from the shipped Web template, records candidate archive hashes, binds unpublished dependencies to their local archives, and invokes `dsh plugin --profile im-profile-smoke add`. The profile disables automatic peer installation and shares the consumer's Cordis instance.

`dsh --profile im-profile-smoke --dump-config` shows the two product rows after installation. The check also rejects malformed YAML in an extra overlay and runs `dsh plugin --profile im-profile-smoke remove @gestaltrun/dsh-im-bundle`; the product rows disappear while shared profile data remains. It does not launch a Web server, Electron, a model, or a provider.

<a id="layer-behavior"></a>
## Layer behavior

The [patch](cordis.patch.yml) inserts `gestaltrun-im-runtime` and `gestaltrun-im-api` once. The underlying base supplies storage, credentials, and Typert services. [Runtime](../im-runtime/README.md) owns durable configuration, and [API](../api-im/README.md) owns safe Remote commands and Client objects. A later profile patch may configure these named rows through the normal ordered patch rules. The bundle has no runtime entry or service of its own.

<a id="model-experience"></a>
## Model Experience

None. This configuration subset adds no model-facing tool or prompt.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Platform providers, IM UI, execution tools, and simulation composition are not included in this backend subset.
- Desktop does not yet select this bundle in its default product list.
- Package installation and configuration dumps do not prove the complete IM experience; live provider and Web/Desktop acceptance remain separate.

<a id="dev-note"></a>
## Dev Note

None.
