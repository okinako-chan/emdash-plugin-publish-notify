# emdash-plugin-publish-notify

An [EmDash](https://emdashcms.com) plugin that posts to a **Discord** webhook when an entry is published, when a revision of a published entry goes live, and when an entry is unpublished. Saving a draft sends nothing.

- Uses the `content:afterPublish` and `content:afterUnpublish` hooks, so scheduled publishes are announced too
- Sends a Discord message with an embed (title, link, excerpt); mentions such as `@everyone` in a title never ping anyone
- The webhook URL is a secret setting, encrypted by EmDash
- Outbound requests are limited to `discord.com` and `discordapp.com`
- Sandboxed plugin format (built as `format: "standard"`): runs in process (`plugins: []`, works on the Cloudflare Workers free plan) or in the sandbox

[日本語の説明は下にあります。](#日本語)

## Install

The plugin is not on npm yet; install it from GitHub, pinned to a release tag. npm builds `dist/` during install (the `prepare` script).

```sh
npm install github:okinako-chan/emdash-plugin-publish-notify#v0.1.0
```

```js
// astro.config.mjs
import emdash from "emdash/astro";
import publishNotify from "emdash-plugin-publish-notify";

export default defineConfig({
	integrations: [
		emdash({
			// ...your database, storage, and other settings
			plugins: [publishNotify],
		}),
	],
});
```

Requires EmDash 1.3 or later (tested with 1.3.1).

### Encryption key

The webhook URL is stored as a secret setting, and EmDash refuses to save secret settings without `EMDASH_ENCRYPTION_KEY`. If your site does not have one yet:

```sh
npx emdash secrets generate                      # prints a key
npx wrangler secret put EMDASH_ENCRYPTION_KEY    # Cloudflare Workers
```

Keep a copy of the key somewhere safe: without it, saved secrets cannot be decrypted.

## Configure

Open **Plugins → Publish Notify** in the EmDash admin.

| Setting | Default | |
|---|---|---|
| Discord webhook URL | — | A Discord webhook URL (`https://discord.com/api/webhooks/…`). |
| Send notifications | on | Turn off to pause without removing the URL. |
| Language | Site locale | English or Japanese. "Site locale" picks Japanese when the site locale starts with `ja`. |
| Entry URL pattern | `/{collection}/{slug}` | How links to entries are built. Change it if your routes differ, e.g. `/blog/{slug}`. |
| Collections to notify | all | Comma-separated collection slugs, e.g. `posts`. |

**Send a test message** posts a sample message with the saved settings.

Settings are stored in each site's database, so a local copy of the site stays quiet until you save a URL there too.

## Messages

| Event | Heading (English) | 日本語 |
|---|---|---|
| First publish | `Post published` | `記事を公開しました` |
| A revision of a published entry goes live | `Post updated` | `記事の更新を反映しました` |
| Unpublish | `Post unpublished` | `記事を非公開にしました` |

`Post` becomes `Page` for the `pages` collection and `Entry` for any other collection. The message includes the entry title, a link (except on unpublish), and the excerpt when the entry has one.

EmDash keeps the original publish date when an entry is published again, so the plugin calls a publish "first" when the publish date is less than five minutes old. Republishing an entry that was unpublished, or a scheduled publish that runs more than five minutes late, is therefore reported as an update.

## Limitations

- Failed deliveries are logged (`ctx.log`) but not retried.
- Only Discord webhooks are supported.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build      # dist/index.mjs (descriptor), dist/plugin.mjs, dist/manifest.json
```

## 日本語

EmDash で記事を公開したとき、公開済みの記事の改訂を反映したとき、非公開にしたときに、Discord の webhook に知らせるプラグインです。下書きの保存では送りません。

- `npm install github:okinako-chan/emdash-plugin-publish-notify#v0.1.0` で GitHub から入れて（npm にはまだ出していません）、`astro.config.mjs` の `plugins: []` に足します（上の Install を参照）。Cloudflare Workers の無料プランでも動きます。
- 管理画面の **Plugins → Publish Notify** で Discord の webhook の URL を入れます。
- URL は暗号化して保存されるため、`EMDASH_ENCRYPTION_KEY` が必要です（`npx emdash secrets generate` で作れます）。
- 言語を「日本語」にするか、サイトのロケールが `ja` なら、日本語で通知します。
- 設定はサイトの DB ごとに保存されます。ローカルの開発環境では、URL を入れない限り送りません。

作った経緯は、ブログの記事に書いています: https://okinako.dev/posts/emdash-discord-publish-plugin

## License

MIT
