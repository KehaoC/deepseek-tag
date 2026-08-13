# Deepseek Tag

Deepseek Tag connects a DeepSeek Harness agent to Feishu or Lark over the
platform's WebSocket long connection. It runs inside the same Harness process,
so it works with both local and cloud-hosted runtimes and does not require a
public webhook endpoint.

The current release provides the phase-one text conversation path:

- direct messages and `@bot` group messages;
- one Harness session per DM, group topic, or reply tree;
- replies returned to the originating Feishu/Lark conversation;
- sender-aware shared group context;
- Harness credential references instead of secrets in plugin configuration;
- user and group allowlists enforced by the Lark channel SDK.

## Requirements

- Node.js 22.19 or newer;
- a working DeepSeek Harness Web profile;
- a Feishu/Lark custom app with bot capability, long-connection event delivery,
  and message receive/send permissions;
- the app's App ID and App Secret.

## Install

```sh
dsh plugin --profile web add github:KehaoC/deepseek-tag
```

For a git installation, pnpm may ask you to allow the package's `prepare`
build. Follow the exact `allowBuilds` instruction printed by `dsh`, review the
source, and repeat the install.

## Configure

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
      requireMention: true
      cwd: ''
      provider: ''
      model: ''
```

`tenant` is `feishu` for the China service and `lark` for the global service.
An empty provider/model pair uses the Harness Web profile's current default.
An empty `cwd` uses the Harness process working directory.

Validate the composed profile before starting it:

```sh
dsh --profile web --dump-config
dsh --profile web
```

The next increment will add the dedicated Web UI configuration and pairing
surface; the host settings and credential boundaries are kept separate so the
UI never needs to read a stored App Secret.

## Security defaults

- The installed bundle is disabled until explicitly configured.
- Group messages require a direct mention by default.
- `respondToMentionAll` is disabled.
- App secrets are resolved through the Harness credential seam or the named
  environment variable and are never logged.
- Lark SDK message deduplication, per-chat serialization, reconnect handling,
  outbound validation, and SSRF defenses remain enabled.

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
