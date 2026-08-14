# Deepseek Tag development rules

Deepseek Tag is an evidence-driven DeepSeek Harness plugin. Do not invent a
Cordis, Harness, Claude Tag, or Lark contract from memory when a primary source
or pinned reference implementation exists.

## Local reference archive

`reference/` is the local reference root and is intentionally excluded from
Git. Never stage or commit it. Its source inventory and pinned revisions are in
`reference/README.md`.

Before implementation work, verify that the required paths below exist. If a
required page, repository, or upstream link is missing or cannot be read, stop
and ask the user for access or a copy. Do not guess and continue.

Use sources in this order of authority:

1. The pinned DeepSeek Harness official documentation and source.
2. The exact `@larksuite/channel` version used by this package and its API
   documentation.
3. Claude Tag's official documentation for observable product behavior.
4. The pinned `lark-coding-agent-bridge` implementation for Lark-specific
   operational patterns.
5. `dsh-plugin` marketplace repositories for discovery only. Recheck every
   borrowed pattern against items 1–4 before using it.

## Mandatory DeepSeek Harness reading

Before changing plugin composition, injection, configuration, packaging,
lifecycle, services, or events, read the relevant source file in full. For any
new plugin surface, read both tutorial sets in full before coding:

- `reference/upstreams/deepseek-harness/docs/user/develop/basic/`
- `reference/upstreams/deepseek-harness/docs/cordis-tutorial/`

Use these official implementations for the corresponding contracts:

- Bundle/profile installation and publishing:
  `docs/user/develop/basic/publish.md` and `apps/cli/reference/README.md`.
- Cordis services, effects, configuration, composition, and HMR:
  `docs/cordis-tutorial/03-services.md` through
  `docs/cordis-tutorial/07-into-the-harness.md`.
- Default Agent model routing:
  `packages/core/agent-default-model/src/index.ts` and the
  `defaultModelSelection` flow in `packages/host/apiproxy/src/`.
- Agent creation and session lifecycle: `packages/core/agent/`,
  `packages/core/agent-loop/`, `packages/core/session/`, and
  `packages/session/`.
- Host HTTP routes: `packages/host/webserver/README.md` and
  `packages/host/webserver/src/index.ts`.
- Web settings and visual conventions:
  `packages/client/ui-settings/`, `packages/client/ui-settings-models/`,
  `packages/client/ui-slots/`, and `packages/client/ui-theme/`.
- Cloud/local isolation and permission policy: `packages/sandbox/`,
  `packages/fs/fs-sandbox/`, and the sandbox-backed shell packages.

Paths in this section are relative to
`reference/upstreams/deepseek-harness/` unless stated otherwise. Follow the
public service seams and injection contracts demonstrated there. Do not reach
through private implementation state merely because it works in one profile.

## Mandatory Claude Tag reading

Claude Tag is the behavior reference, not an API implementation to imitate
blindly. Its complete local document set is indexed by:

- `reference/claude-tag/urls.txt`
- `reference/claude-tag/docs/`
- `reference/claude-tag/introducing-claude-tag.md`
- `docs/claude-tag-parity.md`

Before changing the phase-two roadmap or implementing a parity feature, read
the complete relevant Claude Tag page, then update the parity ledger with the
observed behavior, the Lark equivalent, dependencies, security implications,
and acceptance criteria. At minimum:

- Runtime/session behavior: `concepts/how-it-works.md`.
- Identity and credentials: `concepts/agent-identity.md`.
- Sandbox, egress, and data boundaries: `concepts/security-and-data.md`.
- Settings surfaces: `concepts/settings-map.md`.
- Invocation and response behavior: `users/getting-started.md`,
  `users/commands.md`, and `users/when-claude-responds.md`.
- Routines, memory, and models: `users/proactivity.md`, `users/memory.md`, and
  `users/models.md`.
- Administration and audit: the relevant page under `admins/`.

Do not label a feature as Claude Tag parity based on the announcement or a
summary alone. Verify it against the detailed official page.

## Mandatory Lark reading

The production transport is `@larksuite/channel`. Before changing events,
permissions, normalization, replies, cards, media, policy, queuing, reconnects,
or regional endpoints, read:

- `reference/upstreams/larksuite-channel-0.4.1/README.md` or `README.zh.md`.
- Its exact public types in `dist/index.d.mts`.
- The relevant implementation in `dist/index.mjs` when documentation is not
  sufficient.

Then compare the behavior with the pinned bridge implementation:

- Transport and permissions: `src/bot/channel.ts` and `src/bot/lark-info.ts`.
- Admission policy: `src/policy/` and `src/bot/scope.ts`.
- Chat/thread identity: `src/bot/thread-id.ts` and `src/session/`.
- Runtime supervision: `src/runtime/` and `src/bot/run-flow.ts`.
- Progress and rich replies: `src/card/`, `src/bot/cot.ts`, and
  `src/bot/interactive-card.ts`.
- Commands and steering: `src/commands/`, `src/bot/pending-queue.ts`, and
  `src/bot/active-runs.ts`.
- Attachments: `src/media/`.
- Secrets and local state: `src/config/keystore.ts`,
  `src/config/secret-resolver.ts`, and `src/platform/atomic-write.ts`.

Paths in the list above are relative to
`reference/upstreams/lark-coding-agent-bridge/`.

## Implementation and commit gates

- State which primary paths govern a change before implementation.
- Preserve the separation between Lark transport, conversation identity,
  Harness Agent/runtime creation, result projection, settings, and policy.
- Prefer an official Harness service or plugin seam over local fallback logic.
- Treat secrets as write-only credentials; never place them in settings,
  prompts, logs, browser responses, or committed fixtures.
- For behavior that differs between local and cloud runtimes, define the
  capability boundary explicitly and fail closed where security is involved.
- Add only tests needed to pin the changed contract and its failure mode. Run
  `pnpm check` before every commit.
- Each commit must be independently production-usable, narrowly scoped, and
  have a concise message describing the change. Do not add author annotations
  to commit messages.
- Keep `reference/` ignored. A reference refresh is local research work, not a
  product change, unless the user explicitly requests otherwise.
