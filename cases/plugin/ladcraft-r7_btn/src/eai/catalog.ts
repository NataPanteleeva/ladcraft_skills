import type { EaiClient } from "./client";

export interface CatalogApp {
  id: string;
  name: string;
  description?: string;
}

export interface CatalogResult {
  agents: CatalogApp[];
  errors: string[];
}

const PAGE_SIZE = 100;

/** Prefer orchestrator agent_id over marketplace application id. */
function mapApplicationItem(item: Record<string, unknown>): CatalogApp | null {
  const id = String(
    item.agent_id ?? item.id ?? item.app_id ?? item.application_id ?? item.uuid ?? "",
  );
  if (!id) return null;
  return {
    id,
    name: String(item.name ?? item.title ?? item.hint ?? "Агент"),
    description: item.description ? String(item.description) : undefined,
  };
}

function mapOrchestratorItem(item: Record<string, unknown>): CatalogApp | null {
  const id = String(item.agent_id ?? "");
  if (!id) return null;
  const kind = item.kind ? String(item.kind) : undefined;
  return {
    id,
    name: String(item.title ?? "Агент"),
    description: kind,
  };
}

async function listMarketplaceAgents(
  client: EaiClient,
  extra: Record<string, string>,
): Promise<CatalogApp[]> {
  const params = new URLSearchParams({
    type: "agent",
    limit: String(PAGE_SIZE),
    ...extra,
  });
  const res = await client.request<Record<string, unknown>>(
    `/v1/application/list?${params}`,
  );
  return extractApplications(res)
    .map((item) => mapApplicationItem(item))
    .filter((app): app is CatalogApp => app != null);
}

/** Agents from orchestrator (includes private / unpublished). */
async function listOrchestratorAgents(client: EaiClient): Promise<CatalogApp[]> {
  const agents: CatalogApp[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      page: String(page),
      size: String(PAGE_SIZE),
      status: "active",
    });
    const res = await client.request<Record<string, unknown>>(`/v1/agent?${params}`);
    const items = extractOrchestratorItems(res);
    for (const item of items) {
      const mapped = mapOrchestratorItem(item);
      if (mapped) agents.push(mapped);
    }

    const pagination = res.pagination as { total?: number } | undefined;
    const total = pagination?.total ?? items.length;
    if (items.length === 0 || page * PAGE_SIZE >= total) break;
    page += 1;
  }

  return agents;
}

function extractApplications(res: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(res.data)) {
    return res.data as Array<Record<string, unknown>>;
  }
  const result = res.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const applications = (result as Record<string, unknown>).applications;
    if (Array.isArray(applications)) {
      return applications as Array<Record<string, unknown>>;
    }
  }
  if (Array.isArray(res.applications)) {
    return res.applications as Array<Record<string, unknown>>;
  }
  return [];
}

function extractOrchestratorItems(res: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(res.items)) {
    return res.items as Array<Record<string, unknown>>;
  }
  const result = res.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const items = (result as Record<string, unknown>).items;
    if (Array.isArray(items)) {
      return items as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function mergeAgents(lists: CatalogApp[][]): CatalogApp[] {
  const byId = new Map<string, CatalogApp>();
  for (const list of lists) {
    for (const app of list) {
      const existing = byId.get(app.id);
      if (!existing) {
        byId.set(app.id, app);
        continue;
      }
      if (!existing.description && app.description) {
        byId.set(app.id, { ...existing, description: app.description });
      }
      if (existing.name === "Агент" && app.name !== "Агент") {
        byId.set(app.id, { ...existing, name: app.name });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

async function loadSource(
  client: EaiClient,
  label: string,
  loader: () => Promise<CatalogApp[]>,
  partial: CatalogApp[][],
  errors: string[],
): Promise<void> {
  try {
    partial.push(await loader());
  } catch (err) {
    errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Load all agents for the current user:
 * orchestrator (private + workspace) and marketplace applications (installed / authored).
 */
export async function loadCatalog(client: EaiClient): Promise<CatalogResult> {
  const errors: string[] = [];
  const partial: CatalogApp[][] = [];

  await loadSource(client, "Агенты (оркестратор)", () => listOrchestratorAgents(client), partial, errors);
  await loadSource(
    client,
    "Агенты (установленные)",
    () => listMarketplaceAgents(client, { return_installed: "true" }),
    partial,
    errors,
  );
  await loadSource(
    client,
    "Агенты (мои приложения)",
    () => listMarketplaceAgents(client, { authored_by_me: "true" }),
    partial,
    errors,
  );
  await loadSource(
    client,
    "Агенты (черновики)",
    () =>
      listMarketplaceAgents(client, {
        authored_by_me: "true",
        status: "private",
      }),
    partial,
    errors,
  );

  return { agents: mergeAgents(partial), errors };
}
