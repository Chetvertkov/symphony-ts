import type { BlockerRef, Issue } from "../domain/model.js";
import { ERROR_CODES } from "../errors/codes.js";
import { TrackerError } from "./errors.js";
import type { IssueStateSnapshot } from "./tracker.js";

export interface NotionPropertyDescriptor {
  id: string;
  name: string;
  type: string;
}

export interface NotionIssuePropertyMap {
  title: NotionPropertyDescriptor;
  status: NotionPropertyDescriptor;
  identifier: NotionPropertyDescriptor | null;
  description: NotionPropertyDescriptor | null;
  priority: NotionPropertyDescriptor | null;
  labels: NotionPropertyDescriptor | null;
  blockedBy: NotionPropertyDescriptor | null;
}

export interface NotionBlockerPreview {
  identifier: string | null;
  state: string | null;
}

export function normalizeNotionIssue(
  page: unknown,
  options: {
    properties: NotionIssuePropertyMap;
    blockedByIds?: readonly string[];
    blockerLookup?: ReadonlyMap<string, NotionBlockerPreview>;
  },
): Issue {
  const notionPage = asNotionPage(page);
  const id = requireString(notionPage.id, "page.id");
  const titleProperty = requireProperty(
    notionPage.properties,
    options.properties.title,
  );
  const statusProperty = requireProperty(
    notionPage.properties,
    options.properties.status,
  );
  const title = requireNonEmptyString(
    readPlainTextProperty(titleProperty),
    options.properties.title.name,
  );
  const state = requireNonEmptyString(
    readStateName(statusProperty),
    options.properties.status.name,
  );
  const identifier =
    readIdentifier(notionPage.properties, options.properties.identifier) ??
    toShortNotionPageId(id);
  const description = readDescription(
    notionPage.properties,
    options.properties.description,
  );
  const priority = readPriority(
    notionPage.properties,
    options.properties.priority,
  );
  const labels = readLabels(notionPage.properties, options.properties.labels);
  const blockedByIds =
    options.blockedByIds ??
    readBlockedByIds(notionPage.properties, options.properties.blockedBy);

  return {
    id,
    identifier,
    title,
    description,
    priority,
    state,
    branchName: null,
    url: optionalString(notionPage.url),
    labels,
    blockedBy: blockedByIds.map((blockerId) =>
      toBlockedByRef(blockerId, options.blockerLookup),
    ),
    createdAt: normalizeTimestamp(notionPage.created_time),
    updatedAt: normalizeTimestamp(notionPage.last_edited_time),
  };
}

export function normalizeNotionIssueState(
  page: unknown,
  options: {
    status: NotionPropertyDescriptor;
    identifier: NotionPropertyDescriptor | null;
  },
): IssueStateSnapshot {
  const notionPage = asNotionPage(page);
  const id = requireString(notionPage.id, "page.id");
  const statusProperty = requireProperty(notionPage.properties, options.status);
  const identifier =
    readIdentifier(notionPage.properties, options.identifier) ??
    toShortNotionPageId(id);
  const state = requireNonEmptyString(
    readStateName(statusProperty),
    options.status.name,
  );

  return {
    id,
    identifier,
    state,
  };
}

export function readNotionIssuePreview(
  page: unknown,
  options: {
    status: NotionPropertyDescriptor;
    identifier: NotionPropertyDescriptor | null;
  },
): { id: string; identifier: string; state: string } {
  const snapshot = normalizeNotionIssueState(page, options);
  return snapshot;
}

export function readNotionRelationPropertyIds(
  propertyValue: unknown,
): string[] {
  if (!propertyValue || typeof propertyValue !== "object") {
    return [];
  }

  const relation = (propertyValue as NotionPropertyValue).relation;
  if (!Array.isArray(relation)) {
    return [];
  }

  return relation
    .map((entry) => (typeof entry?.id === "string" ? entry.id : null))
    .filter((entry): entry is string => entry !== null);
}

export function relationPropertyHasMore(propertyValue: unknown): boolean {
  return (
    propertyValue !== null &&
    typeof propertyValue === "object" &&
    (propertyValue as NotionPropertyValue).has_more === true
  );
}

export function toShortNotionPageId(pageId: string): string {
  return pageId.replaceAll("-", "").slice(0, 8);
}

interface NotionPageObject {
  object?: unknown;
  id?: unknown;
  url?: unknown;
  created_time?: unknown;
  last_edited_time?: unknown;
  properties?: unknown;
}

interface NotionRichTextLike {
  plain_text?: unknown;
}

interface NotionSelectOptionLike {
  name?: unknown;
}

interface NotionRelationLike {
  id?: unknown;
}

interface NotionFormulaLike {
  type?: unknown;
  string?: unknown;
  number?: unknown;
}

interface NotionUniqueIdLike {
  prefix?: unknown;
  number?: unknown;
}

interface NotionPropertyValue {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  rich_text?: unknown;
  select?: NotionSelectOptionLike | null;
  status?: NotionSelectOptionLike | null;
  multi_select?: unknown;
  relation?: NotionRelationLike[];
  has_more?: unknown;
  number?: unknown;
  formula?: NotionFormulaLike | null;
  unique_id?: NotionUniqueIdLike | null;
}

function asNotionPage(page: unknown): NotionPageObject & {
  properties: Record<string, unknown>;
} {
  if (!page || typeof page !== "object" || Array.isArray(page)) {
    throw new TrackerError(
      ERROR_CODES.notionUnknownPayload,
      "Notion page payload was not an object.",
      { details: page },
    );
  }

  const notionPage = page as NotionPageObject;
  if (
    !notionPage.properties ||
    typeof notionPage.properties !== "object" ||
    Array.isArray(notionPage.properties)
  ) {
    throw new TrackerError(
      ERROR_CODES.notionUnknownPayload,
      "Notion page payload was missing properties.",
      { details: page },
    );
  }

  return notionPage as NotionPageObject & {
    properties: Record<string, unknown>;
  };
}

function requireProperty(
  properties: Record<string, unknown>,
  descriptor: NotionPropertyDescriptor,
): NotionPropertyValue {
  const property = findProperty(properties, descriptor);
  if (property !== null) {
    return property;
  }

  throw new TrackerError(
    ERROR_CODES.notionUnknownPayload,
    `Notion page payload was missing property '${descriptor.name}'.`,
    { details: descriptor },
  );
}

function findProperty(
  properties: Record<string, unknown>,
  descriptor: NotionPropertyDescriptor | null,
): NotionPropertyValue | null {
  if (descriptor === null) {
    return null;
  }

  const byName = properties[descriptor.name];
  if (isPropertyValue(byName)) {
    return byName;
  }

  for (const candidate of Object.values(properties)) {
    if (
      isPropertyValue(candidate) &&
      typeof candidate.id === "string" &&
      candidate.id === descriptor.id
    ) {
      return candidate;
    }
  }

  return null;
}

function isPropertyValue(value: unknown): value is NotionPropertyValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readIdentifier(
  properties: Record<string, unknown>,
  descriptor: NotionPropertyDescriptor | null,
): string | null {
  const property = findProperty(properties, descriptor);
  if (property === null) {
    return null;
  }

  const stringValue = readStringLikeProperty(property);
  if (stringValue !== null) {
    return stringValue;
  }

  const uniqueId = property.unique_id;
  if (uniqueId && typeof uniqueId === "object") {
    const prefix =
      typeof uniqueId.prefix === "string" && uniqueId.prefix.trim() !== ""
        ? uniqueId.prefix.trim()
        : null;
    const number =
      typeof uniqueId.number === "number" && Number.isFinite(uniqueId.number)
        ? Math.trunc(uniqueId.number)
        : null;
    if (number !== null) {
      return prefix === null ? String(number) : `${prefix}-${number}`;
    }
  }

  return null;
}

function readDescription(
  properties: Record<string, unknown>,
  descriptor: NotionPropertyDescriptor | null,
): string | null {
  const property = findProperty(properties, descriptor);
  if (property === null) {
    return null;
  }

  return readPlainTextProperty(property);
}

function readPriority(
  properties: Record<string, unknown>,
  descriptor: NotionPropertyDescriptor | null,
): number | null {
  const property = findProperty(properties, descriptor);
  if (property === null) {
    return null;
  }

  const directNumber = readNumberProperty(property);
  if (directNumber !== null) {
    return directNumber;
  }

  const formula = property.formula;
  if (
    formula &&
    typeof formula === "object" &&
    formula.type === "number" &&
    typeof formula.number === "number" &&
    Number.isFinite(formula.number)
  ) {
    return Math.trunc(formula.number);
  }

  const namedValue =
    readStateName(property) ?? readStringLikeProperty(property);
  if (namedValue === null) {
    return null;
  }

  return mapPriorityLabel(namedValue);
}

function readLabels(
  properties: Record<string, unknown>,
  descriptor: NotionPropertyDescriptor | null,
): string[] {
  const property = findProperty(properties, descriptor);
  if (property === null) {
    return [];
  }

  if (Array.isArray(property.multi_select)) {
    return property.multi_select
      .map((entry) => (typeof entry?.name === "string" ? entry.name : null))
      .filter((entry): entry is string => entry !== null)
      .map((entry) => entry.toLowerCase());
  }

  const singleLabel = readOptionName(property.select);
  return singleLabel === null ? [] : [singleLabel.toLowerCase()];
}

function readBlockedByIds(
  properties: Record<string, unknown>,
  descriptor: NotionPropertyDescriptor | null,
): string[] {
  const property = findProperty(properties, descriptor);
  return property === null ? [] : readNotionRelationPropertyIds(property);
}

function toBlockedByRef(
  blockerId: string,
  blockerLookup: ReadonlyMap<string, NotionBlockerPreview> | undefined,
): BlockerRef {
  const preview = blockerLookup?.get(blockerId);
  return {
    id: blockerId,
    identifier: preview?.identifier ?? null,
    state: preview?.state ?? null,
  };
}

function readStateName(property: NotionPropertyValue): string | null {
  return readOptionName(property.status) ?? readOptionName(property.select);
}

function readOptionName(option: unknown): string | null {
  return option !== null &&
    typeof option === "object" &&
    typeof (option as NotionSelectOptionLike).name === "string"
    ? normalizeOptionalString((option as NotionSelectOptionLike).name as string)
    : null;
}

function readStringLikeProperty(property: NotionPropertyValue): string | null {
  return (
    readPlainTextProperty(property) ??
    readStateName(property) ??
    readFormulaString(property.formula)
  );
}

function readPlainTextProperty(property: NotionPropertyValue): string | null {
  const richTextValue = Array.isArray(property.title)
    ? property.title
    : Array.isArray(property.rich_text)
      ? property.rich_text
      : null;
  if (richTextValue === null) {
    return null;
  }

  const text = richTextValue
    .map((entry) =>
      typeof entry?.plain_text === "string" ? entry.plain_text : "",
    )
    .join("");

  return normalizeOptionalString(text);
}

function readFormulaString(formula: unknown): string | null {
  if (!formula || typeof formula !== "object") {
    return null;
  }

  const notionFormula = formula as NotionFormulaLike;
  if (
    notionFormula.type === "string" &&
    typeof notionFormula.string === "string"
  ) {
    return normalizeOptionalString(notionFormula.string);
  }

  if (
    notionFormula.type === "number" &&
    typeof notionFormula.number === "number" &&
    Number.isFinite(notionFormula.number)
  ) {
    return String(Math.trunc(notionFormula.number));
  }

  return null;
}

function readNumberProperty(property: NotionPropertyValue): number | null {
  if (typeof property.number === "number" && Number.isFinite(property.number)) {
    return Math.trunc(property.number);
  }

  return null;
}

function mapPriorityLabel(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "") {
    return null;
  }

  if (/^p?[0-4]$/.test(normalized)) {
    return Number.parseInt(normalized.replace("p", ""), 10);
  }

  switch (normalized) {
    case "critical":
    case "urgent":
    case "highest":
      return 0;
    case "high":
      return 1;
    case "medium":
    case "med":
      return 2;
    case "low":
      return 3;
    case "none":
    case "no priority":
      return 4;
    default:
      return null;
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  throw new TrackerError(
    ERROR_CODES.notionUnknownPayload,
    `Notion payload field '${field}' was missing or invalid.`,
    { details: value },
  );
}

function requireNonEmptyString(
  value: string | null,
  propertyName: string,
): string {
  if (value !== null && value.trim() !== "") {
    return value;
  }

  throw new TrackerError(
    ERROR_CODES.notionUnknownPayload,
    `Notion property '${propertyName}' was missing or empty.`,
    { details: propertyName },
  );
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeOptionalString(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}
