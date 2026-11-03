import { describe, expect, it } from "vitest";

import {
	NEW_PUBLISH_WINDOW_MS,
	buildBody,
	classifyPublish,
	entryUrl,
	heading,
	isDiscordWebhookUrl,
	parseCollections,
	resolveLanguage,
} from "../src/message.js";

describe("isDiscordWebhookUrl", () => {
	it("accepts Discord webhook URLs", () => {
		expect(isDiscordWebhookUrl("https://discord.com/api/webhooks/1/abc")).toBe(true);
		expect(isDiscordWebhookUrl("https://discordapp.com/api/webhooks/1/abc")).toBe(true);
	});

	it("rejects anything else", () => {
		expect(isDiscordWebhookUrl("http://discord.com/api/webhooks/1/abc")).toBe(false);
		expect(isDiscordWebhookUrl("https://discord.com/channels/1/2")).toBe(false);
		expect(isDiscordWebhookUrl("https://example.com/api/webhooks/1/abc")).toBe(false);
		expect(isDiscordWebhookUrl("https://discord.com.evil.example/api/webhooks/1")).toBe(false);
		expect(isDiscordWebhookUrl("not a url")).toBe(false);
	});
});

describe("classifyPublish", () => {
	const now = Date.parse("2026-11-03T00:00:00Z");

	it("treats a recent publishedAt as a first publish", () => {
		expect(classifyPublish(new Date(now - 1000).toISOString(), now)).toBe("published");
	});

	it("treats an older publishedAt as a revision going live", () => {
		expect(classifyPublish(new Date(now - NEW_PUBLISH_WINDOW_MS - 1).toISOString(), now)).toBe("updated");
	});

	it("falls back to a first publish when publishedAt is missing", () => {
		expect(classifyPublish(undefined, now)).toBe("published");
	});
});

describe("entryUrl", () => {
	it("fills the pattern", () => {
		expect(entryUrl("https://example.com", "/{collection}/{slug}", "posts", "hello")).toBe("https://example.com/posts/hello");
		expect(entryUrl("https://example.com/", "/blog/{slug}/", "posts", "a b")).toBe("https://example.com/blog/a%20b/");
	});

	it("falls back to the default pattern and skips entries without a slug", () => {
		expect(entryUrl("https://example.com", " ", "pages", "about")).toBe("https://example.com/pages/about");
		expect(entryUrl("https://example.com", "/{slug}", "posts", undefined)).toBeUndefined();
	});
});

describe("settings helpers", () => {
	it("parses the collection filter", () => {
		expect(parseCollections(" posts, pages ,")).toEqual(["posts", "pages"]);
		expect(parseCollections(null)).toEqual([]);
	});

	it("resolves the language from the setting or the site locale", () => {
		expect(resolveLanguage("en", "ja-JP")).toBe("en");
		expect(resolveLanguage("auto", "ja-JP")).toBe("ja");
		expect(resolveLanguage(null, "en")).toBe("en");
	});

	it("words headings per collection and language", () => {
		expect(heading("published", "posts", "en")).toBe("Post published");
		expect(heading("updated", "pages", "ja")).toBe("固定ページの更新を反映しました");
		expect(heading("unpublished", "products", "ja")).toBe("コンテンツを非公開にしました");
	});
});

describe("buildBody", () => {
	const notice = {
		kind: "published" as const,
		heading: "Post published",
		title: "Hello <@everyone>",
		url: "https://example.com/posts/hello",
		excerpt: "First line\nSecond line",
	};

	it("builds a Discord message with an embed and no mentions", () => {
		const body = buildBody(notice) as { content: string; embeds: Array<Record<string, unknown>>; allowed_mentions: unknown };
		expect(body.content).toBe("Post published: Hello <@everyone>");
		expect(body.embeds[0]).toMatchObject({ title: notice.title, url: notice.url, description: notice.excerpt });
		expect(body.embeds[0]?.footer).toBeUndefined();
		expect(body.allowed_mentions).toEqual({ parse: [] });
	});

	it("clips long Discord titles", () => {
		const body = buildBody({ ...notice, title: "x".repeat(300) }) as { embeds: Array<{ title: string }> };
		expect(body.embeds[0]?.title).toHaveLength(256);
	});
});
