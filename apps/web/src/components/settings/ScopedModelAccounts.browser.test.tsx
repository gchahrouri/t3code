import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "../../index.css";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({
  environments: [] as Array<{
    environmentId: EnvironmentId;
    label: string;
    connection: { phase: "connected" };
    serverConfig: {
      settings: ServerSettings;
      environment: {
        platform: { machine: "server" };
        capabilities: { threadAutoSettlementScope: boolean };
      };
    };
  }>,
  providers: new Map<EnvironmentId, readonly ServerProvider[]>(),
  persist:
    vi.fn<
      (request: {
        environmentId: EnvironmentId;
        input: { patch: ServerSettingsPatch };
      }) => Promise<AsyncResult.Success<void>>
    >(),
}));

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: state.environments })) as never,
  useEnvironmentProviders: () => state.providers,
  usePrimaryEnvironmentId: () => state.environments[0]?.environmentId ?? null,
  usePrimaryEnvironment: (() => state.environments[0] ?? null) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useServerConfigs: (() =>
    new Map(
      state.environments.map((environment) => [
        environment.environmentId,
        environment.serverConfig,
      ]),
    )) as never,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
  useEnvironmentsWithScope: () =>
    new Set(state.environments.map((environment) => environment.environmentId)),
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.persist) as never,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useClientSettings: (() => DEFAULT_CLIENT_SETTINGS) as never,
  useMergedSettings: ((settings: ServerSettings, selector?: (settings: unknown) => unknown) => {
    const merged = { ...DEFAULT_CLIENT_SETTINGS, ...settings };
    return selector ? selector(merged) : merged;
  }) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => scope()) as never,
  useOptionalSettingsScope: (() => scope()) as never,
}));

import { ThreadsSettingsPanel } from "./SettingsPanels";

function scope() {
  const targets = state.environments.map((environment) => ({
    environmentId: environment.environmentId,
    label: environment.label,
    projectId: null,
    ...resolveProjectSettings(environment.serverConfig.settings, null),
  }));
  return {
    scope: {
      kind: "all",
      label: "All environments",
      members: [],
      environmentIds: state.environments.map((environment) => environment.environmentId),
    },
    target: targets[0],
    targets,
    environments: state.environments,
    connectedEnvironments: state.environments,
    environment: state.environments[0],
    groups: [],
    search: {},
    singleEnvironment: false,
    selectScope: () => {},
  };
}

function setup(duplicate = false) {
  state.providers.clear();
  state.persist.mockReset();
  state.environments = ["Laptop", "Server"].map((name) => {
    const environmentId = EnvironmentId.make(name);
    const instanceId = ProviderInstanceId.make(`codex_${name.toLowerCase()}_gmail`);
    const provider: ServerProvider = {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      displayName: "Gmail",
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: {
        status: "authenticated",
        type: "chatgpt",
        email: "gmail@example.test",
        workspaceId: "personal",
      },
      checkedAt: "2026-11-03T00:00:00.000Z",
      models: ["gpt-6-astra", "gpt-6-luna"].map((slug) => ({
        slug,
        name: slug === "gpt-6-luna" ? "Luna" : "Astra",
        isCustom: false,
        capabilities: {},
      })),
      slashCommands: [],
      skills: [],
    };
    state.providers.set(
      environmentId,
      duplicate && name === "Server"
        ? [provider, { ...provider, instanceId: ProviderInstanceId.make("codex_duplicate") }]
        : [provider],
    );
    return {
      environmentId,
      label: name,
      connection: { phase: "connected" as const },
      serverConfig: {
        environment: {
          platform: { machine: "server" as const },
          capabilities: { threadAutoSettlementScope: true },
        },
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          defaultModelSelection: { instanceId, model: "gpt-6-astra" },
          textGenerationModelSelection: { instanceId, model: "gpt-6-astra" },
          providerInstances: { [instanceId]: { driver: provider.driver, enabled: true } },
        },
      },
    };
  });
  state.persist.mockImplementation(async ({ environmentId, input }) => {
    const environment = state.environments.find((entry) => entry.environmentId === environmentId)!;
    environment.serverConfig.settings = applyServerSettingsPatch(
      environment.serverConfig.settings,
      input.patch,
    );
    return AsyncResult.success(undefined);
  });
}

it.each(["default-model", "text-generation-model"] as const)(
  "%s saves local account IDs and stays uniform after saving",
  async (rowId) => {
    setup();
    await using screen = await render(<ThreadsSettingsPanel />);
    const model = screen.container.querySelector(`#${rowId}`)!;
    await userEvent.click(
      page.elementLocator(model.querySelector("[data-chat-provider-model-picker]")!),
    );
    const luna = page.getByRole("option", { name: /Luna/ });
    await page.screenshot({ path: `__screenshots__/${rowId}-picker.png` });
    await expect.element(luna).not.toHaveAttribute("aria-disabled", "true");
    await page.screenshot({ path: `__screenshots__/${rowId}-available.png` });
    await userEvent.click(luna);
    await vi.waitFor(() => expect(state.persist).toHaveBeenCalledTimes(2));
    const key =
      rowId === "default-model" ? "defaultModelSelection" : "textGenerationModelSelection";
    expect(state.environments.map((environment) => environment.serverConfig.settings[key])).toEqual(
      [
        { instanceId: "codex_laptop_gmail", model: "gpt-6-luna" },
        { instanceId: "codex_server_gmail", model: "gpt-6-luna" },
      ],
    );
    await screen.rerender(<ThreadsSettingsPanel key="after-save" />);
    const savedModel = screen.container.querySelector(`#${rowId}`)!;
    await expect
      .element(page.elementLocator(savedModel).getByRole("button", { name: /Luna/ }))
      .toBeVisible();
    await expect
      .element(page.getByText("Defaults differ.", { exact: false }))
      .not.toBeInTheDocument();
  },
);

it("leaves an ambiguous account disabled and makes no settings writes", async () => {
  setup(true);
  await using screen = await render(<ThreadsSettingsPanel />);
  const model = screen.container.querySelector("#default-model")!;
  await userEvent.click(
    page.elementLocator(model.querySelector("[data-chat-provider-model-picker]")!),
  );
  await expect
    .element(page.getByRole("option", { name: /Luna/ }))
    .toHaveAttribute("aria-disabled", "true");
  expect(state.persist).not.toHaveBeenCalled();
});

it.each([false, true])(
  "preserves an existing ID for bulk choices and resets (alternate match: %s)",
  async (alternateMatch) => {
    setup();
    const instanceId = ProviderInstanceId.make("codex");
    for (const [index, environment] of state.environments.entries()) {
      const previous = state.providers.get(environment.environmentId)![0]!;
      const provider = {
        ...previous,
        instanceId,
        auth: {
          ...previous.auth,
          email: index === 0 ? "first@example.test" : "second@example.test",
        },
      };
      const alternateId = ProviderInstanceId.make("codex_matching_email");
      state.providers.set(
        environment.environmentId,
        index === 1 && alternateMatch
          ? [
              provider,
              {
                ...provider,
                instanceId: alternateId,
                auth: { ...provider.auth, email: "first@example.test" },
              },
            ]
          : [provider],
      );
      environment.serverConfig.settings = {
        ...environment.serverConfig.settings,
        defaultModelSelection: { instanceId, model: "gpt-6-astra" },
        textGenerationModelSelection: { instanceId, model: "gpt-6-astra" },
        providerInstances: {
          [instanceId]: { driver: provider.driver, enabled: true },
          [alternateId]: { driver: provider.driver, enabled: true },
        },
      };
    }
    await using screen = await render(<ThreadsSettingsPanel />);
    const row = screen.container.querySelector("#text-generation-model")!;
    await userEvent.click(
      page.elementLocator(row.querySelector("[data-chat-provider-model-picker]")!),
    );
    const luna = page.getByRole("option", { name: /Luna/ });
    await expect.element(luna).not.toHaveAttribute("aria-disabled", "true");
    await userEvent.click(luna);
    await vi.waitFor(() => expect(state.persist).toHaveBeenCalledTimes(2));
    expect(
      state.environments.map(
        (environment) => environment.serverConfig.settings.textGenerationModelSelection.instanceId,
      ),
    ).toEqual([instanceId, instanceId]);
    await screen.rerender(<ThreadsSettingsPanel key="before-reset" />);
    await userEvent.click(
      page.getByRole("button", { name: "Reset text generation model to default" }),
    );
    await vi.waitFor(() => expect(state.persist).toHaveBeenCalledTimes(4));
    expect(
      state.environments.map(
        (environment) => environment.serverConfig.settings.textGenerationModelSelection,
      ),
    ).toEqual([
      DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
      DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
    ]);
  },
);
