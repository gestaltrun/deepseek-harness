# Agent Note: Replay product IM admission through Web

Status: implemented

English | [中文](2026-09-14-product-im-runtime-web-snapshot.zh.md)

## Problem

The product IM runtime creates an Agent and root Session when a Provider admits a message. Existing headless and SDK snapshot adapters create their own root Session, so they cannot replay this ownership path without adding a second root or changing the Session relationship being tested. An installed-profile smoke exercises the path but does not provide the repository snapshot corpus's complete Session, prompt, schema, and replay checks.

## Decision

The Web snapshot adapter mounts the shipped Web composition and inserts the product IM runtime with a synthetic test Provider. The IM bundle manifest supplies the product package installation anchor. The Provider registers an account and route, then contributes one inbound page only through `receivePage`; the runtime remains the sole Agent and Session owner. The authored replay drives the `standard` preset through three scripted model responses: `im_query_history`, `im_send_message`, and a final response.

The adapter subscribes to the next settled turn before triggering the Provider and requires that result to identify the one runtime-owned root Session. It compares the complete persisted Session, system prompt, tool schemas, and replay consumption. Separate assertions cover the three model steps, tool order and results, completed turn, one transport send, and the sent outbox record.

Runtime-generated IM identifiers are stabilized through the shared Session refresh and normalization functions. The scenario supplies only the known opaque fields in the admitted source and send result. It requires one admitted message, consistent source and admission message IDs, distinct identities, equal field inventories, and a one-to-one fresh-to-fixture mapping; all other values remain authoritative from the fresh run.

## Alternatives considered

**Use a headless or SDK adapter.** Rejected because those adapters own the root Session and would change the relationship under test.

**Keep only the installed-profile smoke.** Rejected because a smoke does not enforce the repository's recorded-session corpus semantics or compare the complete model-visible inputs.

**Add an IM normalizer to the shared snapshot package.** Rejected because the identifier fields belong to this product-only scenario, and the existing public refresh and normalization exports already provide the required mechanism.

## Consequences

The product CI lane builds the root Web artifacts and product packages before running this keyless replay and the corpus inventory check. The scenario uses an authored FixtureLLM script and synthetic Provider, so it proves profile composition and deterministic runtime behavior without proving a real model or platform account. Its Host-side test stays outside the Web Client compiler face and inside the root Host test program.
