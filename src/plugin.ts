/**
 * Posts to a Discord webhook when an entry is published, a revision
 * goes live, or an entry is unpublished. Saving a draft sends nothing.
 *
 * Sandboxed format (built as format: "standard"): runs in process (`plugins: []`) and in the sandbox.
 * Settings live in the plugin's settings store; the webhook URL is a secret
 * field, encrypted by EmDash with EMDASH_ENCRYPTION_KEY.
 */
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import {
	DEFAULT_URL_PATTERN,
	buildBody,
	classifyPublish,
	entryUrl,
	heading,
	isDiscordWebhookUrl,
	parseCollections,
	resolveLanguage,
	text,
	type Kind,
	type Notice,
} from "./message.js";

interface Settings {
	webhookUrl: string | null;
	enabled: boolean;
	language: string;
	urlPattern: string;
	collections: string;
}

async function loadSettings(ctx: PluginContext): Promise<Settings> {
	return {
		webhookUrl: await ctx.settings.get<string>("webhookUrl"),
		enabled: (await ctx.settings.get<boolean>("enabled")) ?? true,
		language: (await ctx.settings.get<string>("language")) ?? "auto",
		urlPattern: (await ctx.settings.get<string>("urlPattern")) ?? DEFAULT_URL_PATTERN,
		collections: (await ctx.settings.get<string>("collections")) ?? "",
	};
}

/** Returns an error message, or undefined when the webhook accepted the message */
async function post(ctx: PluginContext, webhookUrl: string, notice: Notice): Promise<string | undefined> {
	if (!isDiscordWebhookUrl(webhookUrl)) return "The webhook URL is not a Discord webhook URL";
	if (!ctx.http) return "The network:request capability is missing";
	try {
		const res = await ctx.http.fetch(webhookUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(buildBody(notice)),
		});
		// Never log the URL itself: it is the credential
		return res.ok ? undefined : `Discord webhook returned HTTP ${res.status}`;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

async function notify(kind: Kind, content: Record<string, unknown>, collection: string, ctx: PluginContext) {
	const settings = await loadSettings(ctx);
	// An environment without a saved URL (a local copy of the site, say) stays quiet
	if (!settings.enabled || !settings.webhookUrl) return;
	const only = parseCollections(settings.collections);
	if (only.length > 0 && !only.includes(collection)) return;

	const data = (content.data ?? {}) as Record<string, unknown>;
	const slug = text(content.slug);
	const lang = resolveLanguage(settings.language, ctx.site.locale);
	const error = await post(ctx, settings.webhookUrl, {
		kind,
		heading: heading(kind, collection, lang),
		title: text(data.title) ?? slug ?? String(content.id),
		url: kind === "unpublished" ? undefined : entryUrl(ctx.site.url, settings.urlPattern, collection, slug),
		excerpt: text(data.excerpt),
		siteName: text(ctx.site.name),
	});
	if (error) ctx.log.error(`Publish notice not delivered: ${error}`, { collection, id: content.id });
}

const HOOK = { priority: 210, timeout: 10000, errorPolicy: "continue" } as const;

export default {
	hooks: {
		"content:afterPublish": {
			...HOOK,
			handler: async ({ content, collection }, ctx) => {
				await notify(classifyPublish(content.publishedAt, Date.now()), content, collection, ctx);
			},
		},
		"content:afterUnpublish": {
			...HOOK,
			handler: async ({ content, collection }, ctx) => {
				await notify("unpublished", content, collection, ctx);
			},
		},
	},
	routes: {
		admin: {
			handler: async (routeCtx, ctx) => {
				const interaction = routeCtx.input as {
					type?: string;
					page?: string;
					action_id?: string;
					values?: Record<string, unknown>;
				};
				if (interaction.type === "page_load" && interaction.page === "/settings") {
					return settingsPage(ctx);
				}
				if (interaction.type === "form_submit" && interaction.action_id === "save") {
					return saveSettings(ctx, interaction.values ?? {});
				}
				if (interaction.type === "block_action" && interaction.action_id === "test") {
					return sendTest(ctx);
				}
				return { blocks: [] };
			},
		},
	},
} satisfies SandboxedPlugin;

// ── Admin page (Block Kit) ──

async function settingsPage(ctx: PluginContext) {
	const settings = await loadSettings(ctx);
	const saved = !!settings.webhookUrl && isDiscordWebhookUrl(settings.webhookUrl);
	return {
		blocks: [
			{ type: "header", text: "Publish notifications" },
			{
				type: "context",
				text: "Posts to a Discord webhook when an entry is published, a revision goes live, or an entry is unpublished. Saving a draft sends nothing.",
			},
			{
				type: "fields",
				fields: [
					{ label: "Webhook", value: saved ? "Discord (saved)" : "Not set" },
					{ label: "Status", value: settings.enabled && saved ? "Active" : "Inactive" },
				],
			},
			{ type: "divider" },
			{
				type: "form",
				block_id: "settings",
				fields: [
					{
						type: "secret_input",
						action_id: "webhookUrl",
						label: "Discord webhook URL",
						has_value: !!settings.webhookUrl,
					},
					{ type: "toggle", action_id: "enabled", label: "Send notifications", initial_value: settings.enabled },
					{
						type: "select",
						action_id: "language",
						label: "Language",
						options: [
							{ label: "Site locale", value: "auto" },
							{ label: "English", value: "en" },
							{ label: "日本語", value: "ja" },
						],
						initial_value: settings.language,
					},
					{
						type: "text_input",
						action_id: "urlPattern",
						label: "Entry URL pattern ({collection} and {slug} are replaced)",
						initial_value: settings.urlPattern,
					},
					{
						type: "text_input",
						action_id: "collections",
						label: "Collections to notify (comma-separated, empty for all)",
						initial_value: settings.collections,
					},
				],
				submit: { label: "Save", action_id: "save" },
			},
			{
				type: "actions",
				elements: [{ type: "button", label: "Send a test message", action_id: "test" }],
			},
		],
	};
}

async function saveSettings(ctx: PluginContext, values: Record<string, unknown>) {
	const url = text(values.webhookUrl);
	// The secret field comes back empty unless edited; keep the saved URL then
	if (url) {
		if (!isDiscordWebhookUrl(url)) {
			return {
				...(await settingsPage(ctx)),
				toast: { message: "Enter a Discord webhook URL (https://discord.com/api/webhooks/…)", type: "error" },
			};
		}
		try {
			await ctx.settings.set("webhookUrl", url);
		} catch (error) {
			// Secret fields fail closed without EMDASH_ENCRYPTION_KEY (PLUGIN_SETTING_ENCRYPTION_KEY_MISSING)
			ctx.log.error("Could not save the webhook URL", { error: error instanceof Error ? error.message : String(error) });
			return {
				...(await settingsPage(ctx)),
				toast: { message: "Could not save the webhook URL. Secret settings need EMDASH_ENCRYPTION_KEY (generate one with `npx emdash secrets generate`).", type: "error" },
			};
		}
	}
	if (typeof values.enabled === "boolean") await ctx.settings.set("enabled", values.enabled);
	if (values.language === "auto" || values.language === "en" || values.language === "ja") {
		await ctx.settings.set("language", values.language);
	}
	if (typeof values.urlPattern === "string") {
		await ctx.settings.set("urlPattern", values.urlPattern.trim() || DEFAULT_URL_PATTERN);
	}
	if (typeof values.collections === "string") await ctx.settings.set("collections", values.collections.trim());
	return { ...(await settingsPage(ctx)), toast: { message: "Settings saved", type: "success" } };
}

async function sendTest(ctx: PluginContext) {
	const settings = await loadSettings(ctx);
	const page = await settingsPage(ctx);
	if (!settings.webhookUrl) return { ...page, toast: { message: "Save a webhook URL first", type: "error" } };
	const lang = resolveLanguage(settings.language, ctx.site.locale);
	const error = await post(ctx, settings.webhookUrl, {
		kind: "published",
		heading: lang === "ja" ? "テスト送信" : "Test message",
		title: lang === "ja" ? "EmDash の公開通知の設定ができました" : "EmDash publish notifications are set up",
		url: ctx.site.url || undefined,
		siteName: text(ctx.site.name),
	});
	return error
		? { ...page, toast: { message: `Test failed: ${error}`, type: "error" } }
		: { ...page, toast: { message: "Test message sent", type: "success" } };
}
