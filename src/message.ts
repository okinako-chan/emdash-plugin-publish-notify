/**
 * Pure helpers: whether a URL is a Discord webhook, how to word a notice,
 * and the JSON body Discord expects. No EmDash APIs here, so everything is
 * unit-testable.
 */

export type Kind = "published" | "updated" | "unpublished";
export type Language = "en" | "ja";

/** Hosts the plugin may post to; mirrors `allowedHosts` in emdash-plugin.jsonc */
export const ALLOWED_HOSTS = ["discord.com", "discordapp.com"];

/** A publish whose publishedAt is this recent is a first publish; older means a revision went live */
export const NEW_PUBLISH_WINDOW_MS = 5 * 60 * 1000;

export const DEFAULT_URL_PATTERN = "/{collection}/{slug}";

/** True for an https Discord webhook URL (discord.com or discordapp.com /api/webhooks/…) */
export function isDiscordWebhookUrl(webhookUrl: string): boolean {
	let url: URL;
	try {
		url = new URL(webhookUrl);
	} catch {
		return false;
	}
	return (
		url.protocol === "https:" &&
		(url.hostname === "discord.com" || url.hostname === "discordapp.com") &&
		url.pathname.startsWith("/api/webhooks/")
	);
}

/**
 * EmDash keeps the first publishedAt when an entry is published again, so a
 * recent publishedAt means a first publish and an older one a revision.
 */
export function classifyPublish(publishedAt: unknown, now: number): Kind {
	const time = Date.parse(String(publishedAt ?? ""));
	return Number.isNaN(time) || now - time < NEW_PUBLISH_WINDOW_MS ? "published" : "updated";
}

/** Builds the public URL of an entry from a pattern such as "/{collection}/{slug}" */
export function entryUrl(siteUrl: string, pattern: string, collection: string, slug: string | undefined): string | undefined {
	if (!slug || !siteUrl) return undefined;
	const path = (pattern.trim() || DEFAULT_URL_PATTERN)
		.replaceAll("{collection}", encodeURIComponent(collection))
		.replaceAll("{slug}", encodeURIComponent(slug));
	try {
		return new URL(path, siteUrl).href;
	} catch {
		return undefined;
	}
}

/** Comma-separated collection slugs; empty means every collection */
export function parseCollections(value: string | null | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export function resolveLanguage(setting: string | null | undefined, siteLocale: string | undefined): Language {
	if (setting === "en" || setting === "ja") return setting;
	return siteLocale?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

const NOUNS: Record<Language, Record<string, string>> = {
	en: { posts: "Post", pages: "Page" },
	ja: { posts: "記事", pages: "固定ページ" },
};

export function heading(kind: Kind, collection: string, lang: Language): string {
	if (lang === "ja") {
		const noun = NOUNS.ja[collection] ?? "コンテンツ";
		if (kind === "published") return `${noun}を公開しました`;
		if (kind === "updated") return `${noun}の更新を反映しました`;
		return `${noun}を非公開にしました`;
	}
	const noun = NOUNS.en[collection] ?? "Entry";
	if (kind === "published") return `${noun} published`;
	if (kind === "updated") return `${noun} updated`;
	return `${noun} unpublished`;
}

export interface Notice {
	kind: Kind;
	heading: string;
	title: string;
	url?: string;
	excerpt?: string;
	siteName?: string;
}

const COLORS: Record<Kind, number> = { published: 0x2ecc71, updated: 0x3498db, unpublished: 0x95a5a6 };

/** Discord caps embed titles at 256 and descriptions at 4096 characters */
function clip(text: string | undefined, max: number): string | undefined {
	if (!text) return undefined;
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildBody(notice: Notice): Record<string, unknown> {
	return {
		content: clip(`${notice.heading}: ${notice.title}`, 2000),
		embeds: [
			{
				title: clip(notice.title, 256),
				url: notice.url,
				description: clip(notice.excerpt, 4096),
				color: COLORS[notice.kind],
				footer: notice.siteName ? { text: clip(notice.siteName, 2048) } : undefined,
				timestamp: new Date().toISOString(),
			},
		],
		// A title containing @everyone must not ping anyone
		allowed_mentions: { parse: [] },
	};
}

export function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
