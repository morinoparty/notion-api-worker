import {
  JSONData,
  NotionUserType,
  LoadPageChunkData,
  CollectionData,
  NotionSearchParamsType,
  NotionSearchResultsType,
} from "./types.js";

const NOTION_API = "https://www.notion.so/api/v3";

interface INotionParams {
  resource: string;
  body: JSONData;
  notionToken?: string;
  headers?: Record<string, string>;
}

// Notion recently started wrapping each recordMap entry in an additional
// `{ value: { value: <actual>, role }, ... }` layer. Collapse it back to the
// legacy `{ role, value: <actual> }` shape so downstream code keeps working.
// See https://github.com/NotionX/react-notion-x/issues/681 and
// https://github.com/splitbee/notion-api-worker/issues/94
const unwrapRecordEntry = (entry: any) => {
  if (!entry || typeof entry !== "object") return entry;
  const inner = entry.value;
  if (
    inner &&
    typeof inner === "object" &&
    "value" in inner &&
    inner.value &&
    typeof inner.value === "object" &&
    ("role" in inner || "id" in inner.value)
  ) {
    return {
      ...entry,
      role: entry.role ?? inner.role,
      value: inner.value,
    };
  }
  return entry;
};

const RECORD_MAP_TABLES = [
  "block",
  "collection",
  "collection_view",
  "notion_user",
  "space",
  "team",
  "bot",
  "discussion",
  "comment",
];

const normalizeRecordMap = <T extends Record<string, any> | undefined | null>(
  recordMap: T
): T => {
  if (!recordMap) return recordMap;
  for (const tableName of RECORD_MAP_TABLES) {
    const table = (recordMap as any)[tableName];
    if (!table) continue;
    for (const id of Object.keys(table)) {
      table[id] = unwrapRecordEntry(table[id]);
    }
  }
  return recordMap;
};

const loadPageChunkBody = {
  limit: 100,
  cursor: { stack: [] },
  chunkNumber: 0,
  verticalColumns: false,
};

const fetchNotionData = async <T extends any>({
  resource,
  body,
  notionToken,
  headers,
}: INotionParams): Promise<T> => {
  const res = await fetch(`${NOTION_API}/${resource}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(notionToken && { cookie: `token_v2=${notionToken}` }),
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return res.json() as Promise<T>;
};

export const fetchPageById = async (pageId: string, notionToken?: string) => {
  const res = await fetchNotionData<LoadPageChunkData>({
    resource: "loadPageChunk",
    body: {
      pageId,
      ...loadPageChunkBody,
    },
    notionToken,
  });

  normalizeRecordMap(res?.recordMap);
  return res;
};

const queryCollectionBody = {
  loader: {
    type: "reducer",
    reducers: {
      collection_group_results: {
        type: "results",
        limit: 999,
        loadContentCover: true,
      },
      "table:uncategorized:title:count": {
        type: "aggregation",
        aggregation: {
          property: "title",
          aggregator: "count",
        },
      },
    },
    searchQuery: "",
    userTimeZone: "Europe/Vienna",
  },
};

export const fetchTableData = async (
  collectionId: string,
  collectionViewId: string,
  notionToken?: string,
  spaceId?: string
) => {
  const headers: Record<string, string> = {};
  if (spaceId) {
    headers["x-notion-space-id"] = spaceId;
  }

  const table = await fetchNotionData<CollectionData>({
    resource: "queryCollection",
    body: {
      collection: {
        id: collectionId,
      },
      collectionView: {
        id: collectionViewId,
      },
      ...queryCollectionBody,
    },
    notionToken,
    headers,
  });

  normalizeRecordMap(table?.recordMap);
  return table;
};

export const fetchNotionUsers = async (
  userIds: string[],
  notionToken?: string
) => {
  const users = await fetchNotionData<{ results: NotionUserType[] }>({
    resource: "getRecordValues",
    body: {
      requests: userIds.map((id) => ({ id, table: "notion_user" })),
    },
    notionToken,
  });
  if (users && users.results) {
    users.results = users.results.map((u) => unwrapRecordEntry(u));
    return users.results.map((u) => {
      const user = {
        id: u.value.id,
        firstName: u.value.given_name,
        lastLame: u.value.family_name,
        fullName: u.value.given_name + " " + u.value.family_name,
        profilePhoto: u.value.profile_photo,
      };
      return user;
    });
  }
  return [];
};

export const fetchBlocks = async (
  blockList: string[],
  notionToken?: string
) => {
  const res = await fetchNotionData<LoadPageChunkData>({
    resource: "syncRecordValues",
    body: {
      requests: blockList.map((id) => ({
        id,
        table: "block",
        version: -1,
      })),
    },
    notionToken,
  });
  normalizeRecordMap(res?.recordMap);
  return res;
};

export const fetchNotionSearch = async (
  params: NotionSearchParamsType,
  notionToken?: string
) => {
  // TODO: support other types of searches
  const res = await fetchNotionData<{ results: NotionSearchResultsType }>({
    resource: "search",
    body: {
      type: "BlocksInAncestor",
      source: "quick_find_public",
      ancestorId: params.ancestorId,
      filters: {
        isDeletedOnly: false,
        excludeTemplates: true,
        isNavigableOnly: true,
        requireEditPermissions: false,
        ancestors: [],
        createdBy: [],
        editedBy: [],
        lastEditedTime: {},
        createdTime: {},
        ...params.filters,
      },
      sort: "Relevance",
      limit: params.limit || 20,
      query: params.query,
    },
    notionToken,
  });
  normalizeRecordMap((res?.results as any)?.recordMap);
  return res;
};
