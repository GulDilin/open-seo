import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import { RankCheckWorkflow } from "./RankCheckWorkflow";

const mocks = vi.hoisted(() => ({
  getConfigById: vi.fn(),
  getRunById: vi.fn(),
  getKeywordsForConfig: vi.fn(),
  updateRun: vi.fn(),
  updateConfig: vi.fn(),
  getSnapshotsForRun: vi.fn(),
  autumnCheck: vi.fn(),
  createDataforseoClient: vi.fn(),
  runLiveCheck: vi.fn(),
  runProviderCheck: vi.fn(),
  failRunIfActive: vi.fn(),
  getOptionalEnvValue: vi.fn(),
  captureServerEvent: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: vi.fn(),
}));
vi.mock("cloudflare:workflows", () => ({
  NonRetryableError: class extends Error {},
}));
vi.mock("@/db", () => ({ withPgClient: (fn: () => unknown) => fn() }));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);
vi.mock("@/server/features/rank-tracking/services/rankCheckRunGuards", () => ({
  failRunIfActive: mocks.failRunIfActive,
}));
vi.mock("@/server/workflows/rankCheckPaths", () => ({
  runLiveCheck: mocks.runLiveCheck,
  runQueuedCheck: vi.fn(),
  runProviderCheck: mocks.runProviderCheck,
  retryRankChecks: vi.fn(),
}));
vi.mock("@/server/workflows/pgStep", () => ({
  pgStep: (
    _step: unknown,
    _name: string,
    _config: unknown,
    fn: () => unknown,
  ) => fn(),
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: mocks.createDataforseoClient,
}));
vi.mock("@/server/lib/posthog", () => ({
  captureServerEvent: mocks.captureServerEvent,
}));
vi.mock("@/server/billing/autumn", () => ({
  autumn: { check: mocks.autumnCheck },
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
  getOptionalEnvValue: mocks.getOptionalEnvValue,
  getRequiredEnvValue: () => Promise.resolve("test-key"),
}));

const billingCustomer = {
  userId: "user_1",
  userEmail: "user@example.com",
  organizationId: "org_1",
  projectId: "project_1",
};

const activeRun = {
  id: "run_1",
  status: "running",
};

const payload = {
  runId: "run_1",
  configId: "config_1",
  billingCustomer,
  projectId: "project_1",
  domain: "example.com",
  locationCode: 2840,
  languageCode: "en",
  searchEngine: "google" as "google" | "yandex" | "baidu" | "bing",
  devices: "desktop" as "desktop" | "mobile" | "both",
  serpDepth: 10,
  trigger: "manual" as const,
};

function keywords(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `kw_${index}`,
    keyword: `keyword ${index}`,
  }));
}

function runWorkflow(
  overrides: Partial<typeof payload> & {
    maxCostCredits?: number;
    locationName?: string;
  },
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked base class does not inspect Worker constructor context
  const workflow = new RankCheckWorkflow({} as ExecutionContext, {} as Env);
  return workflow.run(
    {
      instanceId: "run_1",
      timestamp: new Date(),
      payload: { ...payload, ...overrides },
    },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- workflow steps are executed directly by the pgStep mock
    {} as WorkflowStep,
  );
}

describe("rank check workflow credit ceiling", () => {
  beforeEach(() => {
    mocks.getConfigById.mockResolvedValue({ isActive: true });
    mocks.getRunById.mockResolvedValue(activeRun);
    mocks.getSnapshotsForRun.mockResolvedValue([]);
    mocks.updateRun.mockResolvedValue(undefined);
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.autumnCheck.mockResolvedValue({ balance: { remaining: 1_000 } });
    // No provider credentials by default: google falls back to DataForSEO.
    mocks.getOptionalEnvValue.mockResolvedValue(undefined);
  });

  it("rejects a keyword-list race before balance or DataForSEO calls", async () => {
    mocks.getKeywordsForConfig.mockResolvedValue(keywords(5));

    await expect(runWorkflow({ maxCostCredits: 20 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    expect(mocks.autumnCheck).not.toHaveBeenCalled();
    expect(mocks.createDataforseoClient).not.toHaveBeenCalled();
    expect(mocks.runLiveCheck).not.toHaveBeenCalled();
  });

  // Exactly at the ceiling is approved (the guard is strictly greater), and
  // callers without a ceiling — every scheduled check — must not be treated
  // as approving zero credits.
  it.each([
    ["at the approved ceiling", 20, 4],
    ["without a ceiling", undefined, 5],
  ])("checks the reloaded list %s", async (_label, maxCostCredits, count) => {
    mocks.getKeywordsForConfig.mockResolvedValue(keywords(count));

    await runWorkflow({ maxCostCredits });

    expect(mocks.updateRun).toHaveBeenCalledWith("run_1", {
      keywordsTotal: count,
    });
    expect(mocks.runLiveCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ keywords: keywords(count) }),
    );
  });
});

describe("rank check workflow provider selection", () => {
  beforeEach(() => {
    mocks.getConfigById.mockResolvedValue({ isActive: true });
    mocks.getRunById.mockResolvedValue(activeRun);
    mocks.getSnapshotsForRun.mockResolvedValue([]);
    mocks.updateRun.mockResolvedValue(undefined);
    mocks.getKeywordsForConfig.mockResolvedValue(keywords(3));
    mocks.isHostedServerAuthMode.mockResolvedValue(false);
    mocks.getOptionalEnvValue.mockImplementation(async (name: string) =>
      name === "SERPER_API_KEY" ? "serper-key" : undefined,
    );
    mocks.runProviderCheck.mockResolvedValue(undefined);
  });

  it("routes google checks to serper when its key is set", async () => {
    await runWorkflow({});

    expect(mocks.runProviderCheck).toHaveBeenCalledTimes(1);
    expect(mocks.runLiveCheck).not.toHaveBeenCalled();
    // The metered DataForSEO client must not even be constructed.
    expect(mocks.createDataforseoClient).not.toHaveBeenCalled();
  });

  it("keeps city-level google trackers on the DataForSEO path even with serper", async () => {
    await runWorkflow({ locationName: "Austin,Texas,United States" });

    expect(mocks.runProviderCheck).not.toHaveBeenCalled();
    expect(mocks.runLiveCheck).toHaveBeenCalledTimes(1);
  });

  it("keeps the DataForSEO path when no provider key is set", async () => {
    mocks.getOptionalEnvValue.mockResolvedValue(undefined);

    await runWorkflow({});

    expect(mocks.runProviderCheck).not.toHaveBeenCalled();
    expect(mocks.runLiveCheck).toHaveBeenCalledTimes(1);
  });

  it("fails a non-google engine with no provider before any check", async () => {
    await runWorkflow({ searchEngine: "yandex" });

    expect(mocks.failRunIfActive).toHaveBeenCalledTimes(1);
    expect(mocks.updateConfig).toHaveBeenCalledWith("config_1", "project_1", {
      lastSkipReason: "provider_not_configured",
    });
    expect(mocks.runProviderCheck).not.toHaveBeenCalled();
    expect(mocks.runLiveCheck).not.toHaveBeenCalled();
  });

  it("routes baidu checks to the brightdata adapter", async () => {
    mocks.getOptionalEnvValue.mockImplementation(async (name: string) =>
      name === "BRIGHTDATA_API_TOKEN" ? "token" : undefined,
    );

    await runWorkflow({ searchEngine: "baidu" });

    expect(mocks.runProviderCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: "brightdata" }),
      "baidu",
    );
    expect(mocks.runLiveCheck).not.toHaveBeenCalled();
  });
});

describe("rank check finalization", () => {
  beforeEach(() => {
    mocks.getConfigById.mockResolvedValue({ isActive: true });
    mocks.getRunById.mockResolvedValue({
      ...activeRun,
      keywordsTotal: 3,
      // Recorded by the batch step on the first rejected keyword.
      errorMessage: "Invalid Field: 'location_name'.",
    });
    mocks.getKeywordsForConfig.mockResolvedValue(keywords(3));
    mocks.getSnapshotsForRun.mockResolvedValue([]);
    mocks.updateRun.mockResolvedValue(undefined);
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.autumnCheck.mockResolvedValue({ balance: { remaining: 1_000 } });
  });

  it("fails a run where no keyword produced a snapshot, keeping the recorded reason", async () => {
    await runWorkflow({});

    expect(mocks.updateRun).toHaveBeenCalledWith(
      "run_1",
      expect.objectContaining({
        status: "failed",
        errorMessage: "Invalid Field: 'location_name'.",
      }),
    );
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });

  it("reports a run that missed a whole device as partial", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue(
      keywords(3).map((kw) => ({
        trackingKeywordId: kw.id,
        device: "desktop",
      })),
    );

    await runWorkflow({ devices: "both" });

    expect(mocks.updateRun).toHaveBeenCalledWith(
      "run_1",
      expect.objectContaining({
        status: "completed",
        keywordsChecked: 3,
        errorMessage:
          "Checked 3 of 3 desktop and 0 of 3 mobile keyword(s): Invalid Field: 'location_name'.",
      }),
    );
  });
});
