import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebmasterBacklinksRepository } from "./WebmasterBacklinksRepository";

const state = vi.hoisted(() => ({ database: null as DatabaseSync | null }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  db: drizzle(async (query, params, method) => {
    if (!state.database) throw new Error("Database not initialized");
    const statement = state.database.prepare(query);
    const values = params.map((value: unknown): SQLInputValue => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
      )
        return value;
      throw new Error("Unexpected SQL parameter");
    });
    if (method === "run") {
      statement.run(...values);
      return { rows: [] };
    }
    return { rows: statement.all(...values).map((row) => Object.values(row)) };
  }),
}));

beforeEach(() => {
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id text PRIMARY KEY);
    INSERT INTO projects VALUES ('p1'), ('p2');
  `);
  state.database.exec(
    readFileSync("drizzle/sqlite/0065_lethal_miss_america.sql", "utf8"),
  );
});

const snapshot = (date: string, count: number, capturedAt: string) => ({
  projectId: "p1",
  source: "yandex_webmaster" as const,
  date,
  linksTotalCount: count,
  capturedAt,
});

const sample = (sourceUrl: string, destinationUrl: string, seenAt: string) => ({
  projectId: "p1",
  source: "yandex_webmaster" as const,
  sourceUrl,
  destinationUrl,
  discoveryDate: "2026-01-02",
  sourceLastAccessDate: null,
  seenAt,
});

describe("WebmasterBacklinksRepository snapshots", () => {
  it("dedupes by (project, source, date): a re-collect refreshes count and capturedAt", async () => {
    await WebmasterBacklinksRepository.saveSnapshots([
      snapshot("2026-01-01", 10, "2026-01-01T10:00:00.000Z"),
      snapshot("2026-01-08", 12, "2026-01-08T10:00:00.000Z"),
    ]);
    await WebmasterBacklinksRepository.saveSnapshots([
      snapshot("2026-01-08", 15, "2026-01-09T10:00:00.000Z"),
    ]);

    const rows = await WebmasterBacklinksRepository.listSnapshots(
      "p1",
      "yandex_webmaster",
    );
    expect(rows).toEqual([
      { date: "2026-01-01", linksTotalCount: 10 },
      { date: "2026-01-08", linksTotalCount: 15 },
    ]);
    expect(
      await WebmasterBacklinksRepository.lastCollectedAt("p1", "yandex_webmaster"),
    ).toBe("2026-01-09T10:00:00.000Z");
  });

  it("keeps projects isolated and caps the series at 365 latest points", async () => {
    const base = Date.UTC(2024, 0, 1);
    const rows = Array.from({ length: 370 }, (_, i) => {
      const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
      return snapshot(date, i, "2026-01-01T00:00:00.000Z");
    });
    await WebmasterBacklinksRepository.saveSnapshots(rows);
    await WebmasterBacklinksRepository.saveSnapshots([
      { ...snapshot("2026-01-01", 1, "2026-01-01T00:00:00.000Z"), projectId: "p2" },
    ]);

    expect(
      (await WebmasterBacklinksRepository.listSnapshots("p2", "yandex_webmaster")).length,
    ).toBe(1);
    const p1 = await WebmasterBacklinksRepository.listSnapshots("p1", "yandex_webmaster");
    // The 365 latest points, oldest first: day 5 through day 369.
    expect(p1.length).toBe(365);
    expect(p1[0].date).toBe("2024-01-06");
    expect(p1[364].date).toBe("2025-01-04");
  });
});

describe("WebmasterBacklinksRepository samples", () => {
  it("upserts by (project, sourceUrl, destinationUrl), preserving firstSeenAt and moving lastSeenAt", async () => {
    await WebmasterBacklinksRepository.saveSamples([
      sample("https://a.example/", "https://site.example/x", "2026-01-01T00:00:00.000Z"),
    ]);
    await WebmasterBacklinksRepository.saveSamples([
      sample("https://a.example/", "https://site.example/x", "2026-02-01T00:00:00.000Z"),
      sample("https://b.example/", "https://site.example/y", "2026-02-01T00:00:00.000Z"),
    ]);

    expect(await WebmasterBacklinksRepository.countSamples("p1", "yandex_webmaster")).toBe(2);
    const rows = await WebmasterBacklinksRepository.listSamples(
      "p1",
      "yandex_webmaster",
      100,
    );
    // Newest discovery first.
    expect(rows.map((row) => row.sourceUrl)).toEqual([
      "https://b.example/",
      "https://a.example/",
    ]);
    // firstSeenAt survives re-observation; lastSeenAt moves.
    expect(
      state.database!.prepare(
        "SELECT first_seen_at, last_seen_at FROM webmaster_backlink_samples WHERE source_url = 'https://a.example/'",
      ).get(),
    ).toEqual({
      first_seen_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: "2026-02-01T00:00:00.000Z",
    });
  });

  it("sorts samples with null discovery dates last and respects the limit", async () => {
    await WebmasterBacklinksRepository.saveSamples([
      { ...sample("https://newest.example/", "https://site.example/", "2026-01-01T00:00:00.000Z"), discoveryDate: "2026-03-01" },
      { ...sample("https://older.example/", "https://site.example/", "2026-01-01T00:00:00.000Z"), discoveryDate: "2026-02-01" },
      { ...sample("https://unknown.example/", "https://site.example/", "2026-01-01T00:00:00.000Z"), discoveryDate: null },
    ]);

    const rows = await WebmasterBacklinksRepository.listSamples(
      "p1",
      "yandex_webmaster",
      2,
    );
    expect(rows.map((row) => row.sourceUrl)).toEqual([
      "https://newest.example/",
      "https://older.example/",
    ]);
    const all = await WebmasterBacklinksRepository.listSamples(
      "p1",
      "yandex_webmaster",
      100,
    );
    expect(all[all.length - 1].sourceUrl).toBe("https://unknown.example/");
  });

  it("removes snapshots and samples when their project is deleted", async () => {
    await WebmasterBacklinksRepository.saveSnapshots([snapshot("2026-01-01", 5, "2026-01-01T00:00:00.000Z")]);
    await WebmasterBacklinksRepository.saveSamples([sample("https://a.example/", "https://site.example/x", "2026-01-01T00:00:00.000Z")]);
    state.database!.exec("DELETE FROM projects WHERE id = 'p1'");
    expect(
      state.database!.prepare("SELECT * FROM webmaster_backlink_snapshots").all(),
    ).toEqual([]);
    expect(
      state.database!.prepare("SELECT * FROM webmaster_backlink_samples").all(),
    ).toEqual([]);
  });
});
