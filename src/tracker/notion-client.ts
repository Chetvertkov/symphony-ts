import {
  DEFAULT_NOTION_ENDPOINT,
  DEFAULT_NOTION_NETWORK_TIMEOUT_MS,
  DEFAULT_NOTION_PAGE_SIZE,
  DEFAULT_NOTION_VERSION,
} from "../config/defaults.js";
import type { Issue } from "../domain/model.js";
import { ERROR_CODES } from "../errors/codes.js";
import { TrackerError, toTrackerRequestErrorWithCode } from "./errors.js";
import {
  type NotionIssuePropertyMap,
  type NotionPropertyDescriptor,
  normalizeNotionIssue,
  normalizeNotionIssueState,
  readNotionIssuePreview,
  readNotionRelationPropertyIds,
  relationPropertyHasMore,
} from "./notion-normalize.js";
import type { IssueStateSnapshot, IssueTracker } from "./tracker.js";

export interface NotionTrackerAdapterOptions {
  dataSourceId: string | null;
  titleProperty: string | null;
  statusProperty: string | null;
  identifierProperty: string | null;
  descriptionProperty: string | null;
  priorityProperty: string | null;
  labelsProperty: string | null;
  blockedByProperty: string | null;
}

export interface NotionTrackerClientOptions
  extends NotionTrackerAdapterOptions {
  endpoint?: string;
  apiKey: string | null;
  activeStates: string[];
  notionVersion?: string;
  pageSize?: number;
  networkTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface NotionDataSourceResponse {
  id?: unknown;
  properties?: unknown;
}

interface NotionQueryResponse {
  results?: unknown;
  has_more?: unknown;
  next_cursor?: unknown;
}

interface NotionPropertyListResponse {
  object?: unknown;
  results?: unknown;
  has_more?: unknown;
  next_cursor?: unknown;
}

interface NotionPageLike {
  object?: unknown;
  id?: unknown;
  properties?: unknown;
}

interface NotionErrorBody {
  code?: unknown;
  message?: unknown;
  additional_data?: unknown;
}

interface NotionResolvedSchema {
  properties: NotionIssuePropertyMap;
}

export class NotionTrackerClient implements IssueTracker {
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly activeStates: string[];
  private readonly notionVersion: string;
  private readonly pageSize: number;
  private readonly networkTimeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly adapterOptions: NotionTrackerAdapterOptions;
  private schemaPromise: Promise<NotionResolvedSchema> | null = null;

  constructor(options: NotionTrackerClientOptions) {
    this.endpoint = options.endpoint ?? DEFAULT_NOTION_ENDPOINT;
    this.apiKey = options.apiKey;
    this.activeStates = [...options.activeStates];
    this.notionVersion = options.notionVersion ?? DEFAULT_NOTION_VERSION;
    this.pageSize = clampPageSize(options.pageSize ?? DEFAULT_NOTION_PAGE_SIZE);
    this.networkTimeoutMs =
      options.networkTimeoutMs ?? DEFAULT_NOTION_NETWORK_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.adapterOptions = {
      dataSourceId: options.dataSourceId,
      titleProperty: options.titleProperty,
      statusProperty: options.statusProperty,
      identifierProperty: options.identifierProperty ?? null,
      descriptionProperty: options.descriptionProperty ?? null,
      priorityProperty: options.priorityProperty ?? null,
      labelsProperty: options.labelsProperty ?? null,
      blockedByProperty: options.blockedByProperty ?? null,
    };
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.fetchIssuesByStateNames(this.activeStates);
  }

  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    if (stateNames.length === 0) {
      return [];
    }

    return this.fetchIssuesByStateNames(stateNames);
  }

  async fetchIssueStatesByIds(
    issueIds: string[],
  ): Promise<IssueStateSnapshot[]> {
    if (issueIds.length === 0) {
      return [];
    }

    const schema = await this.getSchema();
    return Promise.all(
      issueIds.map(async (issueId) =>
        normalizeNotionIssueState(await this.retrievePage(issueId), {
          status: schema.properties.status,
          identifier: schema.properties.identifier,
        }),
      ),
    );
  }

  private async fetchIssuesByStateNames(
    stateNames: string[],
  ): Promise<Issue[]> {
    const schema = await this.getSchema();
    const pages = await this.queryAllPages({
      filter: buildStateFilter(schema.properties.status, stateNames),
      sorts: [
        {
          timestamp: "created_time",
          direction: "ascending",
        },
      ],
    });
    const relationIdsByPage = await this.loadBlockedByRelations(
      pages,
      schema.properties.blockedBy,
    );
    const blockerLookup = await this.loadBlockerLookup(
      pages,
      relationIdsByPage,
      schema.properties,
    );

    return pages.map((page) => {
      const pageId = requirePageId(page);
      return normalizeNotionIssue(page, {
        properties: schema.properties,
        blockedByIds: relationIdsByPage.get(pageId) ?? [],
        blockerLookup,
      });
    });
  }

  private async getSchema(): Promise<NotionResolvedSchema> {
    if (this.schemaPromise === null) {
      this.schemaPromise = this.loadSchema();
    }

    return this.schemaPromise;
  }

  private async loadSchema(): Promise<NotionResolvedSchema> {
    const dataSourceId = this.requireDataSourceId();
    const response = await this.requestJson<NotionDataSourceResponse>({
      method: "GET",
      path: `/data_sources/${encodeURIComponent(dataSourceId)}`,
    });

    if (
      !response.properties ||
      typeof response.properties !== "object" ||
      Array.isArray(response.properties)
    ) {
      throw new TrackerError(
        ERROR_CODES.notionUnknownPayload,
        "Notion data source payload was missing properties.",
        { details: response },
      );
    }

    const schemaProperties = response.properties as Record<string, unknown>;

    return {
      properties: {
        title: requireSchemaProperty(schemaProperties, {
          configured: this.adapterOptions.titleProperty,
          field: "tracker.title_property",
          allowedTypes: ["title"],
        }),
        status: requireSchemaProperty(schemaProperties, {
          configured: this.adapterOptions.statusProperty,
          field: "tracker.status_property",
          allowedTypes: ["status", "select"],
        }),
        identifier: resolveSchemaProperty(schemaProperties, {
          configured: this.adapterOptions.identifierProperty,
          field: "tracker.identifier_property",
          required: false,
          allowedTypes: [
            "formula",
            "number",
            "rich_text",
            "select",
            "status",
            "title",
            "unique_id",
          ],
        }),
        description: resolveSchemaProperty(schemaProperties, {
          configured: this.adapterOptions.descriptionProperty,
          field: "tracker.description_property",
          required: false,
          allowedTypes: ["rich_text", "title"],
        }),
        priority: resolveSchemaProperty(schemaProperties, {
          configured: this.adapterOptions.priorityProperty,
          field: "tracker.priority_property",
          required: false,
          allowedTypes: ["formula", "number", "select", "status"],
        }),
        labels: resolveSchemaProperty(schemaProperties, {
          configured: this.adapterOptions.labelsProperty,
          field: "tracker.labels_property",
          required: false,
          allowedTypes: ["multi_select", "select"],
        }),
        blockedBy: resolveSchemaProperty(schemaProperties, {
          configured: this.adapterOptions.blockedByProperty,
          field: "tracker.blocked_by_property",
          required: false,
          allowedTypes: ["relation"],
        }),
      },
    };
  }

  private async queryAllPages(input: {
    filter: Record<string, unknown>;
    sorts: readonly Record<string, unknown>[];
  }): Promise<unknown[]> {
    const results: unknown[] = [];
    let startCursor: string | null = null;

    while (true) {
      const response: NotionQueryResponse = await this.requestJson({
        method: "POST",
        path: `/data_sources/${encodeURIComponent(this.requireDataSourceId())}/query`,
        body: {
          filter: input.filter,
          sorts: input.sorts,
          page_size: this.pageSize,
          ...(startCursor === null ? {} : { start_cursor: startCursor }),
        },
      });

      if (!Array.isArray(response.results)) {
        throw new TrackerError(
          ERROR_CODES.notionUnknownPayload,
          "Notion query payload was missing results.",
          { details: response },
        );
      }

      results.push(
        ...response.results.filter(
          (entry: unknown) =>
            entry !== null &&
            typeof entry === "object" &&
            (entry as NotionPageLike).object === "page",
        ),
      );

      if (response.has_more !== true) {
        break;
      }

      if (
        typeof response.next_cursor !== "string" ||
        response.next_cursor.trim() === ""
      ) {
        throw new TrackerError(
          ERROR_CODES.notionMissingNextCursor,
          "Notion pagination indicated more results without a next_cursor.",
          { details: response },
        );
      }

      startCursor = response.next_cursor;
    }

    return results;
  }

  private async loadBlockedByRelations(
    pages: readonly unknown[],
    blockedByProperty: NotionPropertyDescriptor | null,
  ): Promise<Map<string, string[]>> {
    const relationIdsByPage = new Map<string, string[]>();
    if (blockedByProperty === null) {
      return relationIdsByPage;
    }

    await Promise.all(
      pages.map(async (page) => {
        const pageId = requirePageId(page);
        const propertyValue = getPagePropertyValue(page, blockedByProperty);
        if (propertyValue === null) {
          relationIdsByPage.set(pageId, []);
          return;
        }

        const relationIds = relationPropertyHasMore(propertyValue)
          ? await this.retrieveRelationPropertyIds(pageId, blockedByProperty.id)
          : readNotionRelationPropertyIds(propertyValue);
        relationIdsByPage.set(pageId, relationIds);
      }),
    );

    return relationIdsByPage;
  }

  private async loadBlockerLookup(
    pages: readonly unknown[],
    relationIdsByPage: ReadonlyMap<string, readonly string[]>,
    properties: NotionIssuePropertyMap,
  ): Promise<Map<string, { identifier: string | null; state: string | null }>> {
    const lookup = new Map<
      string,
      { identifier: string | null; state: string | null }
    >();

    for (const page of pages) {
      const preview = readNotionIssuePreview(page, {
        status: properties.status,
        identifier: properties.identifier,
      });
      lookup.set(preview.id, {
        identifier: preview.identifier,
        state: preview.state,
      });
    }

    const missingIds = new Set<string>();
    for (const relationIds of relationIdsByPage.values()) {
      for (const relationId of relationIds) {
        if (!lookup.has(relationId)) {
          missingIds.add(relationId);
        }
      }
    }

    await Promise.all(
      [...missingIds].map(async (relationId) => {
        try {
          const preview = readNotionIssuePreview(
            await this.retrievePage(relationId),
            {
              status: properties.status,
              identifier: properties.identifier,
            },
          );
          lookup.set(relationId, {
            identifier: preview.identifier,
            state: preview.state,
          });
        } catch {
          lookup.set(relationId, {
            identifier: null,
            state: null,
          });
        }
      }),
    );

    return lookup;
  }

  private async retrieveRelationPropertyIds(
    pageId: string,
    propertyId: string,
  ): Promise<string[]> {
    const relationIds: string[] = [];
    let startCursor: string | null = null;

    while (true) {
      const response: NotionPropertyListResponse = await this.requestJson({
        method: "GET",
        path: `/pages/${encodeURIComponent(pageId)}/properties/${encodeURIComponent(propertyId)}`,
        query:
          startCursor === null
            ? {
                page_size: String(this.pageSize),
              }
            : {
                page_size: String(this.pageSize),
                start_cursor: startCursor,
              },
      });

      if (!Array.isArray(response.results)) {
        throw new TrackerError(
          ERROR_CODES.notionUnknownPayload,
          "Notion relation property payload was missing results.",
          { details: response },
        );
      }

      relationIds.push(
        ...response.results
          .map((entry: unknown) => {
            if (
              entry &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              "relation" in entry
            ) {
              const relation = (entry as { relation?: { id?: unknown } })
                .relation;
              return typeof relation?.id === "string" ? relation.id : null;
            }

            return null;
          })
          .filter((entry: string | null): entry is string => entry !== null),
      );

      if (response.has_more !== true) {
        break;
      }

      if (
        typeof response.next_cursor !== "string" ||
        response.next_cursor.trim() === ""
      ) {
        throw new TrackerError(
          ERROR_CODES.notionMissingNextCursor,
          "Notion relation property pagination was missing next_cursor.",
          { details: response },
        );
      }

      startCursor = response.next_cursor;
    }

    return relationIds;
  }

  private async retrievePage(pageId: string): Promise<unknown> {
    return this.requestJson({
      method: "GET",
      path: `/pages/${encodeURIComponent(pageId)}`,
    });
  }

  private async requestJson<T>(input: {
    method: "GET" | "POST";
    path: string;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
  }): Promise<T> {
    const response = await this.fetchWithTimeout(input);
    const body = await parseNotionResponseBody(response);

    if (!response.ok) {
      const errorBody =
        body !== null && typeof body === "object" && !Array.isArray(body)
          ? (body as NotionErrorBody)
          : null;
      const message =
        typeof errorBody?.message === "string"
          ? `Notion API request failed with HTTP ${response.status}: ${errorBody.message}`
          : `Notion API request failed with HTTP ${response.status}.`;
      throw new TrackerError(ERROR_CODES.notionApiStatus, message, {
        status: response.status,
        details: body,
      });
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new TrackerError(
        ERROR_CODES.notionUnknownPayload,
        "Notion API returned a malformed JSON payload.",
        { details: body },
      );
    }

    return body as T;
  }

  private async fetchWithTimeout(input: {
    method: "GET" | "POST";
    path: string;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
  }): Promise<Response> {
    const apiKey = this.requireApiKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.networkTimeoutMs);

    try {
      return await this.fetchFn(
        buildNotionUrl(this.endpoint, input.path, input.query),
        {
          method: input.method,
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "notion-version": this.notionVersion,
          },
          ...(input.body === undefined
            ? {}
            : {
                body: JSON.stringify(input.body),
              }),
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw toTrackerRequestErrorWithCode(
        error,
        ERROR_CODES.notionApiRequest,
        "Notion request failed before a valid response was received.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireApiKey(): string {
    if (!this.apiKey || this.apiKey.trim() === "") {
      throw new TrackerError(
        ERROR_CODES.missingTrackerApiKey,
        "Notion tracker API key is required.",
      );
    }

    return this.apiKey;
  }

  private requireDataSourceId(): string {
    if (
      !this.adapterOptions.dataSourceId ||
      this.adapterOptions.dataSourceId.trim() === ""
    ) {
      throw new TrackerError(
        ERROR_CODES.missingTrackerDataSourceId,
        "Notion tracker data source ID is required.",
      );
    }

    return this.adapterOptions.dataSourceId;
  }
}

export function readNotionTrackerAdapterOptions(
  adapterOptions: Readonly<Record<string, unknown>>,
): NotionTrackerAdapterOptions {
  return {
    dataSourceId: readString(adapterOptions.dataSourceId),
    titleProperty: readString(adapterOptions.titleProperty),
    statusProperty: readString(adapterOptions.statusProperty),
    identifierProperty: readString(adapterOptions.identifierProperty),
    descriptionProperty: readString(adapterOptions.descriptionProperty),
    priorityProperty: readString(adapterOptions.priorityProperty),
    labelsProperty: readString(adapterOptions.labelsProperty),
    blockedByProperty: readString(adapterOptions.blockedByProperty),
  };
}

function requireSchemaProperty(
  schemaProperties: Record<string, unknown>,
  input: {
    configured: string | null;
    field: string;
    allowedTypes: readonly string[];
  },
): NotionPropertyDescriptor {
  return resolveSchemaProperty(schemaProperties, {
    ...input,
    required: true,
  }) as NotionPropertyDescriptor;
}

function resolveSchemaProperty(
  schemaProperties: Record<string, unknown>,
  input: {
    configured: string | null;
    field: string;
    required: boolean;
    allowedTypes: readonly string[];
  },
): NotionPropertyDescriptor | null {
  if (input.configured === null || input.configured.trim() === "") {
    if (input.required) {
      throw new TrackerError(
        ERROR_CODES.configInvalid,
        `${input.field} must be configured for tracker.kind: notion.`,
      );
    }

    return null;
  }

  const descriptor = findSchemaProperty(schemaProperties, input.configured);
  if (descriptor === null) {
    throw new TrackerError(
      ERROR_CODES.configInvalid,
      `${input.field} '${input.configured}' was not found in the Notion data source schema.`,
      { details: Object.keys(schemaProperties) },
    );
  }

  if (!input.allowedTypes.includes(descriptor.type)) {
    throw new TrackerError(
      ERROR_CODES.configInvalid,
      `${input.field} '${descriptor.name}' must have one of these Notion property types: ${input.allowedTypes.join(", ")}.`,
      { details: descriptor },
    );
  }

  return descriptor;
}

function findSchemaProperty(
  schemaProperties: Record<string, unknown>,
  configured: string,
): NotionPropertyDescriptor | null {
  for (const [name, value] of Object.entries(schemaProperties)) {
    const descriptor = toSchemaDescriptor(name, value);
    if (
      descriptor !== null &&
      (descriptor.name === configured || descriptor.id === configured)
    ) {
      return descriptor;
    }
  }

  return null;
}

function toSchemaDescriptor(
  name: string,
  value: unknown,
): NotionPropertyDescriptor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const descriptor = value as { id?: unknown; type?: unknown };
  if (
    typeof descriptor.id !== "string" ||
    typeof descriptor.type !== "string"
  ) {
    return null;
  }

  return {
    id: descriptor.id,
    name,
    type: descriptor.type,
  };
}

function getPagePropertyValue(
  page: unknown,
  descriptor: NotionPropertyDescriptor,
): unknown {
  if (!page || typeof page !== "object" || Array.isArray(page)) {
    return null;
  }

  const properties = (page as NotionPageLike).properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    return null;
  }

  const record = properties as Record<string, unknown>;
  if (descriptor.name in record) {
    return record[descriptor.name];
  }

  for (const value of Object.values(record)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "id" in value &&
      (value as { id?: unknown }).id === descriptor.id
    ) {
      return value;
    }
  }

  return null;
}

function buildStateFilter(
  statusProperty: NotionPropertyDescriptor,
  stateNames: string[],
): Record<string, unknown> {
  const normalizedStateNames = stateNames.filter(
    (state) => state.trim() !== "",
  );
  return {
    property: statusProperty.id,
    [statusProperty.type]: {
      equals:
        normalizedStateNames.length === 1
          ? normalizedStateNames[0]
          : normalizedStateNames,
    },
  };
}

function buildNotionUrl(
  endpoint: string,
  path: string,
  query?: Record<string, string>,
): string {
  const url = new URL(
    path.replace(/^\//, ""),
    endpoint.endsWith("/") ? endpoint : `${endpoint}/`,
  );

  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function clampPageSize(pageSize: number): number {
  return Math.max(1, Math.min(pageSize, 100));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function requirePageId(page: unknown): string {
  if (
    page &&
    typeof page === "object" &&
    !Array.isArray(page) &&
    typeof (page as NotionPageLike).id === "string"
  ) {
    return (page as NotionPageLike).id as string;
  }

  throw new TrackerError(
    ERROR_CODES.notionUnknownPayload,
    "Notion page payload was missing id.",
    { details: page },
  );
}

async function parseNotionResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TrackerError(
      ERROR_CODES.notionUnknownPayload,
      "Notion API returned a non-JSON payload.",
      { cause: error },
    );
  }
}
