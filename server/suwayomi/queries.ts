// GraphQL documents used against Suwayomi-Server (checked against v2.3.2363 / v2.4.2366).

export const ABOUT_SERVER = /* GraphQL */ `
  query About {
    aboutServer { name version buildType revision }
  }
`;

export interface AboutServer {
  aboutServer: { name: string; version: string; buildType: string; revision: string };
}

export const LIBRARY_PAGE = /* GraphQL */ `
  query Library($after: Cursor, $first: Int!) {
    mangas(condition: { inLibrary: true }, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        status
        realUrl
        sourceId
        thumbnailUrl
        initialized
        source {
          id
          displayName
          iconUrl
          extension { pkgName name isInstalled hasUpdate isObsolete }
        }
        chapters { totalCount }
        latestUploadedChapter { uploadDate }
        latestFetchedChapter { fetchedAt }
        categories { nodes { name } }
      }
    }
  }
`;

export interface LibraryManga {
  id: number;
  title: string;
  status: string;
  realUrl: string | null;
  sourceId: string;
  thumbnailUrl: string | null;
  initialized: boolean;
  source: {
    id: string;
    displayName: string;
    iconUrl: string;
    extension: { pkgName: string; name: string; isInstalled: boolean; hasUpdate: boolean; isObsolete: boolean } | null;
  } | null;
  chapters: { totalCount: number };
  latestUploadedChapter: { uploadDate: string } | null;
  latestFetchedChapter: { fetchedAt: string } | null;
  categories: { nodes: { name: string }[] };
}

export interface LibraryPage {
  mangas: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: LibraryManga[];
  };
}

/**
 * The health probe. fetchMangaAndChapters catches the refresh exception and returns it
 * in `errors` next to the data, instead of failing the whole request (MangaMutation.kt).
 */
export const REFRESH_MANGA = /* GraphQL */ `
  mutation Refresh($id: Int!) {
    fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) {
      manga { id status initialized }
      chapters { uploadDate fetchedAt }
    }
  }
`;

export interface RefreshResult {
  fetchMangaAndChapters: {
    manga: { id: number; status: string; initialized: boolean };
    chapters: { uploadDate: string; fetchedAt: string }[];
  } | null;
}

export const LIBRARY_UPDATE_RUNNING = /* GraphQL */ `
  query UpdateRunning {
    libraryUpdateStatus { jobsInfo { isRunning } }
  }
`;

export interface LibraryUpdateRunning {
  libraryUpdateStatus: { jobsInfo: { isRunning: boolean } };
}

/**
 * Newest chapter time in epoch seconds. uploadDate is epoch ms from the source and is
 * often 0; fetchedAt (epoch seconds) is when Suwayomi first saw the chapter.
 */
export function latestChapterTime(uploadDateMs: string | number | null | undefined, fetchedAtSec: string | number | null | undefined): number | null {
  const upload = Number(uploadDateMs ?? 0);
  if (upload > 0) return Math.floor(upload / 1000);
  const fetched = Number(fetchedAtSec ?? 0);
  return fetched > 0 ? fetched : null;
}

/** Removes a series from the library. Suwayomi keeps the series itself, its downloads and read progress. */
export const REMOVE_FROM_LIBRARY = /* GraphQL */ `
  mutation RemoveFromLibrary($id: Int!) {
    updateManga(input: { id: $id, patch: { inLibrary: false } }) {
      manga { id inLibrary }
    }
  }
`;

export interface RemoveFromLibraryResult {
  updateManga: { manga: { id: number; inLibrary: boolean } };
}

/** Looks series up by id, in or out of the library. Ids with no series are simply missing from the result. */
export const MANGA_BY_IDS = /* GraphQL */ `
  query MangaByIds($ids: [Int!]!) {
    mangas(filter: { id: { in: $ids } }) {
      nodes {
        id title inLibrary author artist description
        trackRecords { nodes { trackerId remoteId title } }
      }
    }
  }
`;

export interface MangaByIds {
  mangas: {
    nodes: {
      id: number;
      title: string;
      inLibrary: boolean;
      author: string | null;
      artist: string | null;
      description: string | null;
      trackRecords: { nodes: { trackerId: number; remoteId: string | number; title: string }[] };
    }[];
  };
}
