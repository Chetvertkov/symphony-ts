import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "../../src/errors/codes.js";
import {
  type NotionIssuePropertyMap,
  type TrackerError,
  normalizeNotionIssue,
  normalizeNotionIssueState,
} from "../../src/index.js";

describe("notion-normalize", () => {
  it("normalizes title, description, priority, labels, blockers, and timestamps", () => {
    const issue = normalizeNotionIssue(
      {
        object: "page",
        id: "01234567-89ab-cdef-0123-456789abcdef",
        url: "https://www.notion.so/tasks/0123456789abcdef",
        created_time: "2026-03-01T00:00:00.000Z",
        last_edited_time: "2026-03-02T12:34:56.789Z",
        properties: {
          Name: {
            id: "title",
            type: "title",
            title: [{ plain_text: "Implement Notion adapter" }],
          },
          Status: {
            id: "status-id",
            type: "status",
            status: {
              name: "Todo",
            },
          },
          Key: {
            id: "key-id",
            type: "rich_text",
            rich_text: [{ plain_text: "NOTION-12" }],
          },
          Description: {
            id: "description-id",
            type: "rich_text",
            rich_text: [
              { plain_text: "Tracker " },
              { plain_text: "integration" },
            ],
          },
          Priority: {
            id: "priority-id",
            type: "select",
            select: {
              name: "High",
            },
          },
          Labels: {
            id: "labels-id",
            type: "multi_select",
            multi_select: [{ name: "Backend" }, { name: "TRACKER" }],
          },
          "Blocked by": {
            id: "blocked-id",
            type: "relation",
            relation: [{ id: "blocker-1" }, { id: "blocker-2" }],
            has_more: false,
          },
        },
      },
      {
        properties: createPropertyMap(),
        blockedByIds: ["blocker-1", "blocker-2"],
        blockerLookup: new Map([
          [
            "blocker-1",
            {
              identifier: "NOTION-1",
              state: "Done",
            },
          ],
        ]),
      },
    );

    expect(issue).toEqual({
      id: "01234567-89ab-cdef-0123-456789abcdef",
      identifier: "NOTION-12",
      title: "Implement Notion adapter",
      description: "Tracker integration",
      priority: 1,
      state: "Todo",
      branchName: null,
      url: "https://www.notion.so/tasks/0123456789abcdef",
      labels: ["backend", "tracker"],
      blockedBy: [
        {
          id: "blocker-1",
          identifier: "NOTION-1",
          state: "Done",
        },
        {
          id: "blocker-2",
          identifier: null,
          state: null,
        },
      ],
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T12:34:56.789Z",
    });
  });

  it("falls back to a short page id when identifier_property is not configured", () => {
    const issue = normalizeNotionIssue(
      {
        object: "page",
        id: "89abcdef-0123-4567-89ab-cdef01234567",
        properties: {
          Name: {
            id: "title",
            type: "title",
            title: [{ plain_text: "Fallback identifier" }],
          },
          Status: {
            id: "status-id",
            type: "status",
            status: {
              name: "In Progress",
            },
          },
        },
      },
      {
        properties: {
          ...createPropertyMap(),
          identifier: null,
          description: null,
          priority: null,
          labels: null,
          blockedBy: null,
        },
      },
    );

    expect(issue.identifier).toBe("89abcdef");
    expect(issue.description).toBeNull();
    expect(issue.labels).toEqual([]);
    expect(issue.blockedBy).toEqual([]);
  });

  it("normalizes minimal state snapshots for reconciliation", () => {
    expect(
      normalizeNotionIssueState(
        {
          object: "page",
          id: "01234567-89ab-cdef-0123-456789abcdef",
          properties: {
            Status: {
              id: "status-id",
              type: "status",
              status: {
                name: "Done",
              },
            },
            Key: {
              id: "key-id",
              type: "rich_text",
              rich_text: [{ plain_text: "NOTION-12" }],
            },
          },
        },
        {
          status: createPropertyMap().status,
          identifier: createPropertyMap().identifier,
        },
      ),
    ).toEqual({
      id: "01234567-89ab-cdef-0123-456789abcdef",
      identifier: "NOTION-12",
      state: "Done",
    });
  });

  it("treats trashed pages as inactive during normalization and reconciliation", () => {
    const page = {
      object: "page",
      id: "01234567-89ab-cdef-0123-456789abcdef",
      in_trash: true,
      properties: {
        Name: {
          id: "title",
          type: "title",
          title: [{ plain_text: "Trashed task" }],
        },
        Status: {
          id: "status-id",
          type: "status",
          status: {
            name: "In Progress",
          },
        },
        Key: {
          id: "key-id",
          type: "rich_text",
          rich_text: [{ plain_text: "NOTION-99" }],
        },
      },
    };

    expect(
      normalizeNotionIssue(page, {
        properties: {
          ...createPropertyMap(),
          description: null,
          priority: null,
          labels: null,
          blockedBy: null,
        },
      }).state,
    ).toBe("Trashed");

    expect(
      normalizeNotionIssueState(page, {
        status: createPropertyMap().status,
        identifier: createPropertyMap().identifier,
      }),
    ).toEqual({
      id: "01234567-89ab-cdef-0123-456789abcdef",
      identifier: "NOTION-99",
      state: "Trashed",
    });
  });

  it("reads number properties when they are configured as the issue identifier", () => {
    const properties: NotionIssuePropertyMap = {
      ...createPropertyMap(),
      identifier: {
        id: "key-id",
        name: "Key",
        type: "number",
      },
    };

    const page = {
      object: "page",
      id: "fedcba98-7654-3210-fedc-ba9876543210",
      properties: {
        Name: {
          id: "title",
          type: "title",
          title: [{ plain_text: "Numeric identifier" }],
        },
        Status: {
          id: "status-id",
          type: "status",
          status: {
            name: "Todo",
          },
        },
        Key: {
          id: "key-id",
          type: "number",
          number: 2048,
        },
      },
    };

    expect(
      normalizeNotionIssue(page, {
        properties: {
          ...properties,
          description: null,
          priority: null,
          labels: null,
          blockedBy: null,
        },
      }).identifier,
    ).toBe("2048");

    expect(
      normalizeNotionIssueState(page, {
        status: properties.status,
        identifier: properties.identifier,
      }).identifier,
    ).toBe("2048");
  });

  it("rejects malformed page payloads with a typed tracker error", () => {
    expect(() =>
      normalizeNotionIssue(null, {
        properties: createPropertyMap(),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<TrackerError>>({
        code: ERROR_CODES.notionUnknownPayload,
      }),
    );
  });
});

function createPropertyMap(): NotionIssuePropertyMap {
  return {
    title: {
      id: "title",
      name: "Name",
      type: "title",
    },
    status: {
      id: "status-id",
      name: "Status",
      type: "status",
    },
    identifier: {
      id: "key-id",
      name: "Key",
      type: "rich_text",
    },
    description: {
      id: "description-id",
      name: "Description",
      type: "rich_text",
    },
    priority: {
      id: "priority-id",
      name: "Priority",
      type: "select",
    },
    labels: {
      id: "labels-id",
      name: "Labels",
      type: "multi_select",
    },
    blockedBy: {
      id: "blocked-id",
      name: "Blocked by",
      type: "relation",
    },
  };
}
