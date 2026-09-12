# Issue automation configuration

English | [中文](README.zh.md)

## Summary

The Issue workflows use a repository-specific GitHub App and an organization Project to manage Issue metadata. The target organization, Project, fields, and automation actor are defined in [config.json](config.json).

## Table of Contents

- [GitHub configuration](#github-configuration)
- [Validation](#validation)
- [Dev Note](#dev-note)

<a id="github-configuration"></a>

## GitHub configuration

The repository variable `DSH_ISSUE_APP_CLIENT_ID` and secret `DSH_ISSUE_APP_PRIVATE_KEY` identify the `gestaltrun-harness-issues` App. Its installation grants access only to `gestaltrun/deepseek-harness`. The App has Issue write, pull-request read, metadata read, and organization Project write permissions. The [Issue policy workflow](../workflows/issue-policy.yml) requests a token with read-only Issue and Project permissions; the [lifecycle workflow](../workflows/issue-lifecycle.yml) uses the installation's write permissions.

The [DSH Issue Management Project](https://github.com/orgs/gestaltrun/projects/1) has the configured Status choices, a single-select Priority field with P0–P3 choices, and a Start Date field of type Date. Issue Type is GitHub's native Issue Type, not a Project custom field.

Both workflows check out policy from the default branch. Changes to the policy configuration take effect there; changing only a pull-request branch does not replace the trusted policy.

<a id="validation"></a>

## Validation

`node --test .github/issue-management/policy.test.mjs` validates metadata rules and lifecycle transitions. `pnpm exec vitest run scripts/ci-workflow.spec.ts` checks the workflow configuration. These local checks do not verify the installed App or Project access; the repository workflows report that integration result.

<a id="dev-note"></a>

## Dev Note

None.
