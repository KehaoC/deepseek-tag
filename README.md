# Deepseek Tag

Deepseek Tag connects a DeepSeek Harness agent to Feishu or Lark over the
platform's WebSocket long connection. It runs inside the same Harness process,
so it works with both local and cloud-hosted runtimes and does not require a
public webhook endpoint.

The current release provides the phase-one conversation path and live task UX:

- direct messages and `@bot` group messages;
- one Harness session per DM, group topic, or reply tree;
- raw-message topic-id recovery when Feishu omits `thread_id` from a root event;
- durable session resume across turns and Web runtime restarts;
- one live Agent scope per request, released after the turn becomes idle;
- official Harness sandbox policy pinned per thread, with Workspace and group-level read-only/workspace-write selection;
- first-engagement context from up to 50 prior messages in an existing topic;
- an Agent history tool confined to the current chat, with access to channel
  messages and explicitly selected sibling topics;
- place-scoped durable memory with DM isolation, private-group memory, and
  explicitly enabled workspace-sharing groups;
- immediate working reaction, streamed answer card, visible tool status, and
  real Agent todo checklist in the originating Feishu/Lark conversation;
- sender-aware shared group context;
- a dedicated **Settings > Deepseek Tag** Web UI with live reconfiguration;
- guided one-click app creation and incremental permission authorization;
- a live Harness model picker and native working-directory chooser;
- Harness credential references instead of secrets in plugin configuration;
- user and group allowlists enforced by the Lark channel SDK.

The researched Claude Tag feature inventory, extension architecture, and
dependency-ordered phase-two ledger live in
[`docs/claude-tag-parity.md`](docs/claude-tag-parity.md).

## Requirements

- Node.js 22.19 or newer;
- a working DeepSeek Harness Web profile;
- a Harness session-persistence backend (included by the standard Web profile);
- the official sandbox-aware shell and filesystem providers included by the standard Harness base bundle;
- permission to create or update a Feishu/Lark custom app. Existing App ID and
  App Secret credentials remain supported as a manual fallback.

## Install

```sh
dsh plugin --profile web add --workspace-root github:KehaoC/deepseek-tag
```

For a git installation, pnpm may ask you to allow the package's `prepare`
build. Follow the exact `allowBuilds` instruction printed by `dsh`, review the
source, and repeat the install.

## Configure in the Web UI

1. Start or restart the `web` profile after installation.
2. Open **Settings > Deepseek Tag**.
3. Choose **Create Lark app**. The official Feishu/Lark page opens with the bot
   capability, long-connection event, and required permissions prefilled. Confirm
   there; App ID and App Secret are saved automatically on this page.
4. Review the permission preflight. If an existing app is missing a grant or
   the message event, choose **Open Lark and grant all access**. One official
   incremental authorization page requests the complete runtime bundle.
5. Select the group/DM scope, one of the models discovered from Harness, and a
   working directory. Then enable Deepseek Tag and choose **Save and apply**.

The App Secret is write-only. In one-click setup, it moves directly from the
short-lived host registration session into Harness credentials and never
crosses a browser response. In manual setup, the browser sends a newly entered
value directly to the Harness credential API. Neither path places a secret in
the settings document or any later read response. A saved settings change is applied live.
Deepseek Tag serializes connection changes and restores the previous healthy
configuration if a replacement fails.

Harness intentionally does not expose third-party settings namespaces through
its generic configuration API. Deepseek Tag therefore serves its own
same-origin, loopback-only Web endpoint and still stores the validated value in
the standard Harness settings provider. The page is read-only when opened from
a non-loopback host.

In Feishu/Lark, send the bot a direct message or add it to a group and mention
it. A direct-message chat shares one Agent session. A group topic or reply tree
gets an isolated session. Replies rebuild the same durable session after its
previous live runtime has been released.

Each isolated Agent can read up to 50 recent messages from its current chat.
For topic groups, the chat timeline contains topic roots; the Agent can open
any returned topic reference to read up to 50 messages from that sibling topic.
History results do not expose raw chat, thread, message, or sender IDs. When
the bot is first mentioned partway through an existing topic, up to 50
messages from the start of that topic are included automatically, with other
bots' messages filtered out.

Memory follows the same place hierarchy. A DM reads and writes only its own
memory. An ordinary group reads workspace memory but writes only its own group
memory. Because Lark does not expose Slack's public/private classification,
groups remain private unless their `chat_id` is explicitly listed under
**Workspace-sharing groups**. Those groups read and write the app workspace's
shared memory. In conversation, ask the Agent to remember, list, update, or
forget a fact.

## App setup

The guided Settings flow creates a Feishu/Lark PersonalAgent with bot capability.
For manual setup, use a PersonalAgent or custom app with bot capability and
subscribe to `im.message.receive_v1` through WebSocket long connection. The
least-privilege runtime bundle is `application:application:self_manage`,
`im:message:readonly`, `im:message:send_as_bot`,
`im:message.p2p_msg:readonly`, `im:message.group_msg`, `im:chat:read`,
`im:chat.members:read`, `cardkit:card:write`, and
`im:message.reactions:write_only`. The broader `im:message` and
`im:chat:readonly` grants remain compatible. Publish a new app version after
changing permissions or events. No callback URL, public port, or reverse proxy
is required.

Before enabling the bridge, restrict the app's availability and configure the
DM/group allowlists to match the people and chats that may operate the Agent.
`dmAllowlist` accepts sender IDs such as `ou_...`; `groupAllowlist` accepts chat
IDs such as `oc_...`.

## Profile configuration fallback

Store the secret in the environment or in the Harness credential provider
under `DEEPSEEK_TAG_LARK_APP_SECRET`. Then override the installed row in the
profile's `cordis.patch.yml`:

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
An empty provider/model pair uses the Harness Web profile's current default.
An empty `cwd` uses the Harness process working directory. Profile values are
the composition base; values saved in **Settings > Deepseek Tag** layer over
them.

Deepseek Tag follows Claude Tag's scope-first behavior model: one app-wide
Agent identity serves the tenant, workspace defaults inherit into every group,
and an exact `chat_id` scope can append instructions or override the model,
working directory, and response behavior. There is no separate logical-Agent
profile layer. Per-scope Connections are intentionally absent until the
Harness runtime can enforce them at each external operation.

The Workspace sandbox setting is inherited by every group unless that group
selects a narrower policy. A new thread freezes the resolved mode into the
official Harness `sandbox/mode` session event. Deepseek Tag refuses to start
against bare local shell or filesystem providers that do not advertise sandbox
enforcement.

Validate the composed profile before starting it:

```sh
dsh --profile web --dump-config
dsh --profile web
```

## Security defaults

- The installed bundle is disabled until explicitly configured.
- Group messages require a direct mention by default.
- Replies inside a Deepseek Tag-owned group topic/reply tree continue without
  another mention; unrelated group messages remain ignored.
- `respondToMentionAll` is disabled.
- App secrets are resolved through the Harness credential seam or the named
  environment variable and are never logged.
- The Web UI reports only whether a secret is configured and whether its store
  is writable; it cannot retrieve the secret.
- Settings writes are revision-fenced and committed atomically.
- Transport ids are hashed before place-memory keys reach durable storage.
- History tools are bound to the triggering chat; sibling threads are addressed
  by per-run opaque references and every thread response is checked against the
  current chat before its content reaches the Agent.
- Private groups cannot modify workspace memory; DMs cannot read group or
  workspace memory.
- The active shell and filesystem providers must both be sandbox-aware. The
  standard Harness base bundle supplies `sandbox-local`, `sandbox-policy`,
  `bash-sandbox`/`pwsh-sandbox`, and `fs-sandbox`; missing enforcement fails
  closed before the Lark bridge connects.
- Lark SDK message deduplication, reconnect handling, outbound validation, and
  SSRF defenses remain enabled. Deepseek Tag serializes one topic/reply tree at
  a time while allowing independent topics in the same group to run concurrently.

Deepseek Tag uses the sandbox/runtime composed by the active Harness profile.
Each request owns a fresh live Agent handle and disposes it after idle. A cloud
profile may provide a truly ephemeral isolated runtime; the default local
profile provides Harness filesystem/command policy around the configured
working directory, not a microVM. The local policy governs file effects, not
network egress. Files in that local working directory are therefore durable
workspace files and are not represented as ephemeral. A remote execution-world
provider remains a profile-level Harness composition choice and must expose an
equivalent enforceable policy before Deepseek Tag can accept it.

## Development

```sh
pnpm install
pnpm check
pnpm pack
```

The package follows the official DeepSeek Harness bundle layout: `package.json`
declares `dsh.bundle.patch`, `cordis.patch.yml` inserts the plugin row, and the
module exports `name`, `inject`, `Config`, and `apply`.

## License

MIT
