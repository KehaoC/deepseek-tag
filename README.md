# Deepseek Tag

Deepseek Tag connects a DeepSeek Harness agent to Feishu or Lark over the
platform's WebSocket long connection. It runs inside the same Harness process,
so it works with both local and cloud-hosted runtimes and does not require a
public webhook endpoint.

The current release provides the phase-one text conversation path:

- direct messages and `@bot` group messages;
- one Harness session per DM, group topic, or reply tree;
- raw-message topic-id recovery when Feishu omits `thread_id` from a root event;
- durable session resume across turns and Web runtime restarts;
- one live Agent/sandbox activation per request, released after the turn becomes idle;
- place-scoped durable memory with DM isolation, private-group memory, and
  explicitly enabled workspace-sharing groups;
- replies returned to the originating Feishu/Lark conversation;
- sender-aware shared group context;
- a dedicated **Settings > Deepseek Tag** Web UI with live reconfiguration;
- Harness credential references instead of secrets in plugin configuration;
- user and group allowlists enforced by the Lark channel SDK.

The researched Claude Tag feature inventory, extension architecture, and
dependency-ordered phase-two ledger live in
[`docs/claude-tag-parity.md`](docs/claude-tag-parity.md).

## Requirements

- Node.js 22.19 or newer;
- a working DeepSeek Harness Web profile;
- a Feishu/Lark custom app with bot capability, long-connection event delivery,
  and message receive/send permissions;
- the app's App ID and App Secret.

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
3. Enter the app's `cli_...` App ID and App Secret, and select Feishu or Lark.
4. Review the DM/group access policy, workspace-memory groups, and Agent runtime fields.
5. Enable Deepseek Tag and choose **Save and apply**.

The App Secret is a write-only field. The browser sends a newly entered value
directly to the Harness credential API; neither the settings document nor any
later browser response contains it. A saved settings change is applied live.
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

Memory follows the same place hierarchy. A DM reads and writes only its own
memory. An ordinary group reads workspace memory but writes only its own group
memory. Because Lark does not expose Slack's public/private classification,
groups remain private unless their `chat_id` is explicitly listed under
**Workspace-sharing groups**. Those groups read and write the app workspace's
shared memory. In conversation, ask the Agent to remember, list, update, or
forget a fact.

## App setup

Use a Feishu/Lark PersonalAgent or custom app with bot capability. Configure
event delivery through WebSocket long connection and enable message receive and
send permissions. No callback URL, public port, or reverse proxy is required.

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
      provider: ''
      model: ''
```

`tenant` is `feishu` for the China service and `lark` for the global service.
An empty provider/model pair uses the Harness Web profile's current default.
An empty `cwd` uses the Harness process working directory. Profile values are
the composition base; values saved in **Settings > Deepseek Tag** layer over
them.

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
- Private groups cannot modify workspace memory; DMs cannot read group or
  workspace memory.
- Lark SDK message deduplication, per-chat serialization, reconnect handling,
  outbound validation, and SSRF defenses remain enabled.

Deepseek Tag uses the sandbox/runtime composed by the active Harness profile.
Each request owns a fresh live Agent handle and disposes it after idle. A cloud
profile may provide a truly ephemeral isolated runtime; the default local
profile provides Harness filesystem/command policy around the configured
working directory, not a microVM. Files in that local working directory are
therefore durable workspace files and are not represented as ephemeral.

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
