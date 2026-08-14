<div align="center">

# Deepseek Tag

**Bring DeepSeek Harness agents into Feishu and Lark.**

[![DeepSeek Harness](https://img.shields.io/badge/powered%20by-DeepSeek%20Harness-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

WebSocket transport · Durable conversations · Scoped memory · Harness-native sandboxing

</div>

Deepseek Tag is a community plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the
open-source agent harness developed by DeepSeek AI. It connects a Harness Agent
to Feishu or Lark through the platform's WebSocket long connection—no public
webhook, reverse proxy, or separate bot runtime required.

Deepseek Tag runs inside the active Harness composition. Models, credentials,
sessions, tools, working directories, and sandbox enforcement stay on the
Harness side; Feishu/Lark provides the conversation surface.

> [!NOTE]
> DeepSeek Harness is currently a developer preview and may introduce breaking
> changes. Deepseek Tag tracks its public plugin and service contracts.

## What you get

| Area | Behavior |
| --- | --- |
| Conversations | Direct messages, `@bot` group messages, topics, and reply trees |
| Sessions | One durable Harness session per DM, group topic, or reply tree |
| Live task UX | Working reaction, streamed answer card, tool status, and Agent todo list |
| Context | Up to 50 earlier messages when the bot joins an existing conversation |
| History | Chat-confined history tool with opaque sibling-topic references |
| Memory | Isolated DM memory, private group memory, and opt-in workspace sharing |
| Scope | Workspace defaults with exact group-level overrides |
| Sandbox | Harness-native `read-only` or `workspace-write`, frozen per thread |
| Models and files | Live Harness model picker and native working-directory chooser |
| Access | User and group allowlists enforced by the Lark channel SDK |
| Operations | Durable resume, reconnect handling, deduplication, and live settings reload |

For the researched Claude Tag behavior map and the remaining parity roadmap,
see [Claude Tag parity](docs/claude-tag-parity.md).

## Quick start

### 1. Requirements

- Node.js 22.19 or newer
- a working DeepSeek Harness `web` profile
- the standard Harness base bundle, including session persistence and the
  sandbox-aware shell/filesystem providers
- permission to create or update a Feishu/Lark custom app

If you do not have Harness yet, start with the
[official DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness)
and its Web UI:

```sh
npx @deepseek-ai/dsh web
```

### 2. Install Deepseek Tag

```sh
dsh plugin --profile web add --workspace-root github:KehaoC/deepseek-tag
```

For a Git installation, pnpm may ask you to allow the package's `prepare`
build. Review the source, follow the exact `allowBuilds` instruction printed by
`dsh`, and repeat the installation.

### 3. Start Harness

```sh
dsh --profile web
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080), then go to
**Settings → Deepseek Tag**.

### 4. Complete onboarding

1. Select **Create Lark app**. Deepseek Tag opens the official Feishu/Lark app
   page with the bot capability, long-connection event, and required
   permissions prefilled.
2. Confirm the app creation. App ID and App Secret are saved automatically.
3. If the permission preflight finds missing access, select
   **Open Lark and grant all access**, then publish the new app version.
4. Choose the default model, working directory, Sandbox mode, and conversation
   access.
5. Enable Deepseek Tag and select **Save and apply**.

Send the bot a direct message, or add it to a group and mention it.

## Scope and inheritance

Deepseek Tag follows a scope-first model: one app-wide Agent identity serves the
tenant, while Workspace defaults flow into each group.

| Level | Applies to | Can configure |
| --- | --- | --- |
| Onboarding | The entire Lark workspace | Connection, access, default model, working directory, Sandbox, and instructions |
| Group Scope | One selected group | Model, working directory, Sandbox, instructions, and response behavior |
| Thread snapshot | One DM/topic/reply tree | The resolved settings frozen when that conversation starts |

A group inherits every Workspace default unless it has an explicit override.
Changing a Scope affects new conversations; an existing thread keeps the
snapshot it started with so behavior does not shift midway through a task.

There is no separate logical-Agent profile layer. Per-scope Connections are
also intentionally absent until Harness can enforce them at every external
operation.

### Conversation identity

- A DM maps to one durable Agent session.
- A group topic or reply tree maps to an isolated Agent session.
- Replies resume that same session after its live runtime has been released.
- Independent topics in the same group can run concurrently; turns within one
  topic are serialized.

### Context and history

When first mentioned partway through an existing topic, the Agent receives up
to 50 earlier messages from the start of that topic. Messages from other bots
are filtered out.

The Agent can also read recent messages from the current chat. In topic groups,
it may open sibling topics returned by the history tool. Raw chat, thread,
message, and sender IDs are never exposed to the model; sibling topics use
opaque, per-run references and are checked against the triggering chat.

### Memory

| Place | Reads | Writes |
| --- | --- | --- |
| Direct message | Its own DM memory | Its own DM memory |
| Private group | Workspace + group memory | Group memory only |
| Workspace-sharing group | Workspace memory | Workspace memory |

Lark does not expose Slack-style public/private classification, so groups are
private by default. Only groups explicitly enabled for Workspace sharing can
write shared memory. Ask the Agent to remember, list, update, or forget a fact.

## Sandbox behavior

The Workspace Sandbox setting is inherited unless a group selects a different
policy. A new thread records the resolved mode as an official Harness
`sandbox/mode` session event:

- `read-only` allows inspection but blocks file mutations;
- `workspace-write` permits writes inside the configured working directory.

Deepseek Tag fails closed before connecting to Lark when the active shell or
filesystem provider does not advertise sandbox enforcement. The standard
Harness base bundle supplies `sandbox-local`, `sandbox-policy`,
`bash-sandbox`/`pwsh-sandbox`, and `fs-sandbox`.

The default local Sandbox is a filesystem and command policy—not a microVM and
not a network-egress boundary. A cloud or remote execution world remains a
Harness profile-level composition choice and must expose equivalent enforceable
policy before Deepseek Tag can use it.

## App and permission setup

The guided setup creates a Feishu/Lark PersonalAgent with bot capability. For a
manual app, subscribe to `im.message.receive_v1` through a WebSocket long
connection and grant:

```text
application:application:self_manage
im:message:readonly
im:message:send_as_bot
im:message.p2p_msg:readonly
im:message.group_msg
im:chat:read
im:chat.members:read
cardkit:card:write
im:message.reactions:write_only
```

The broader `im:message` and `im:chat:readonly` grants remain compatible.
Publish a new app version after changing permissions or events. No callback URL
or public port is needed.

Before enabling the bridge, restrict the app's availability and configure the
DM/group allowlists for the people and chats allowed to operate the Agent.

## Credential handling

The App Secret is write-only. During guided setup it moves directly from the
short-lived host registration session into Harness credentials and never
crosses a browser read response. During manual setup, a newly entered value is
sent directly to the Harness credential API.

Secrets are never stored in the settings document, prompts, logs, or committed
fixtures. The UI reports only whether a secret exists and whether its store is
writable.

## Profile configuration fallback

The Web UI is the recommended configuration surface. For profile-managed
deployments, store the secret in the environment or Harness credential provider
as `DEEPSEEK_TAG_LARK_APP_SECRET`, then override the installed row in
`cordis.patch.yml`:

```yaml
- override:
    id: deepseek-tag
    config:
      enabled: true
      appId: cli_xxxxxxxxxxxxxxxx
      appSecretEnv: DEEPSEEK_TAG_LARK_APP_SECRET
      tenant: feishu
      dmMode: open
      dmAllowlist: []
      groupAllowlist: []
      workspaceMemoryGroups: []
      requireMention: true
      cwd: ''
      sandboxMode: workspace-write
      provider: ''
      model: ''
      defaultInstructions: ''
      groupScopes: []
```

`tenant` is `feishu` for the China service and `lark` for the global service.
An empty model/provider pair uses the Harness Web profile default; an empty
`cwd` uses the Harness process working directory. Profile configuration forms
the base layer, with saved Web settings applied above it.

Validate the composed profile before starting:

```sh
dsh --profile web --dump-config
dsh --profile web
```

## Security defaults

- The installed bundle remains disabled until explicitly configured.
- Group messages require a direct mention by default.
- Replies in a Deepseek Tag-owned topic continue without another mention;
  unrelated group messages remain ignored.
- `respondToMentionAll` is disabled.
- Settings writes are revision-fenced and committed atomically.
- Transport IDs are hashed before place-memory keys reach durable storage.
- Private groups cannot modify Workspace memory; DMs cannot read group or
  Workspace memory.
- Lark SDK deduplication, reconnect handling, outbound validation, and SSRF
  defenses remain enabled.
- Connection replacements are serialized; a failed replacement restores the
  previous healthy configuration.

## Update

```sh
dsh plugin --profile web update deepseek-tag
dsh --profile web
```

## Development

```sh
pnpm install
pnpm check
pnpm pack
```

The package follows the official
[DeepSeek Harness bundle layout](https://github.com/deepseek-ai/deepseek-harness):
`package.json` declares `dsh.bundle.patch`, `cordis.patch.yml` inserts the
plugin row, and the module exports `name`, `inject`, `Config`, and `apply`.

## Upstream and attribution

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the
  upstream agent harness, runtime, plugin system, Web UI, session services, and
  Sandbox contracts used by this project
- [@larksuite/channel](https://www.npmjs.com/package/@larksuite/channel) — the
  Feishu/Lark WebSocket channel SDK used for transport

Deepseek Tag is an independent community project and is not an official
DeepSeek AI or ByteDance/Lark product.

## License

[MIT](LICENSE)
