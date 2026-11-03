import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import * as Equal from "effect/Equal";

export const SCOPED_MODEL_SETTING_KEYS = [
  "defaultModelSelection",
  "fallbackModelSelection",
  "textGenerationModelSelection",
  "sourceControlWriterModelSelection",
  "reviewGuideModelSelection",
] as const;

function accountIdentity(provider: ServerProvider): string | null {
  const { auth, driver } = provider;
  if (auth.status !== "authenticated" || !auth.email || !auth.type) return null;
  if (
    !(driver === "codex" && auth.type.startsWith("chatgpt")) &&
    !(driver === "claudeAgent" && ["pro", "max", "team", "enterprise"].includes(auth.type))
  )
    return null;
  return JSON.stringify([driver, auth.type, auth.email.toLowerCase(), auth.workspaceId ?? null]);
}

export function resolveScopedModelProvider(
  source: ServerProvider,
  destination: readonly ServerProvider[],
): ServerProvider | null {
  const sameId = destination.find(
    (provider) => provider.instanceId === source.instanceId && provider.driver === source.driver,
  );
  if (sameId) return sameId;
  const identity = accountIdentity(source);
  if (identity === null) return null;
  // Names and machine-local IDs cannot establish which subscription pays for a request.
  const matches = destination.filter((provider) => accountIdentity(provider) === identity);
  return matches.length === 1 ? matches[0]! : null;
}

export function scopedModelSelectionsEqual(
  first: ModelSelection | null,
  firstProviders: readonly ServerProvider[],
  second: ModelSelection | null,
  secondProviders: readonly ServerProvider[],
): boolean {
  if (first === null || second === null) return first === second;
  const source = firstProviders.find((provider) => provider.instanceId === first.instanceId);
  if (!source) return Equal.equals(first, second);
  const destination = source ? resolveScopedModelProvider(source, secondProviders) : null;
  return (
    destination !== null &&
    destination.instanceId === second.instanceId &&
    Equal.equals({ ...first, instanceId: destination.instanceId }, second)
  );
}
