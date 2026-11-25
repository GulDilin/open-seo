import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BingConnectionRepository } from "./BingConnectionRepository";

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

const connection = (projectId: string, apiKey: string, siteUrl: string) => ({
  projectId,
  organizationId: "org1",
  apiKey,
  siteUrl,
  connectedByUserId: "u1",
});

beforeEach(() => {
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organization (id text PRIMARY KEY);
    CREATE TABLE projects (id text PRIMARY KEY);
    INSERT INTO organization VALUES ('org1');
    INSERT INTO projects VALUES ('p1'), ('p2');
  `);
  state.database.exec(
    readFileSync("drizzle/sqlite/0067_wakeful_eddie_brock.sql", "utf8"),
  );
});

describe("BingConnectionRepository", () => {
  it("keeps one row per project, replacing the site and key on reconnect", async () => {
    await BingConnectionRepository.upsert(
      connection("p1", "enc:old", "http://old.example.com/"),
    );
    await BingConnectionRepository.upsert(
      connection("p1", "enc:new", "http://new.example.com/"),
    );
    await BingConnectionRepository.upsert(
      connection("p2", "enc:other", "http://other.example.com/"),
    );

    const p1 = await BingConnectionRepository.getByProjectId("p1");
    expect(p1).toMatchObject({
      siteUrl: "http://new.example.com/",
      apiKey: "enc:new",
      projectId: "p1",
    });
    // Each project has its own row: p2's key and site never leak into p1's.
    expect(await BingConnectionRepository.getByProjectId("p2")).toMatchObject({
      apiKey: "enc:other",
    });
  });

  it("removes the connection when its project is deleted", async () => {
    await BingConnectionRepository.upsert(
      connection("p1", "enc:key", "http://example.com/"),
    );
    state.database!.exec("DELETE FROM projects WHERE id = 'p1'");
    expect(await BingConnectionRepository.getByProjectId("p1")).toBeNull();
  });

  it("drops the row on disconnect", async () => {
    await BingConnectionRepository.upsert(
      connection("p1", "enc:key", "http://example.com/"),
    );
    await BingConnectionRepository.deleteByProjectId("p1");
    expect(await BingConnectionRepository.getByProjectId("p1")).toBeNull();
  });
});
