import type { ErrorKind } from '../shared/api-types.js';

/**
 * Classifies the error text Suwayomi returns from a refresh.
 *
 * Messages come from Suwayomi-Server itself:
 *  - "Missing source <id>"          manga/impl/Manga.kt (updateMangaAndChapters)
 *  - "Source not installed: <id>"   manga/impl/util/source/StubSource.kt
 *  - "No chapters found"            manga/impl/Chapter.kt (the source returned an empty chapter list)
 *  - "HTTP error <code>"            eu/kanade/tachiyomi/network/HttpException.kt and OkHttp.kt
 * Anything else is an extension-level failure (parse error, timeout, SSL...).
 */
export function classifyError(message: string): { kind: ErrorKind; httpStatus: number | null } {
  const http = /HTTP error (\d{3})/i.exec(message);
  const httpStatus = http?.[1] ? Number(http[1]) : null;

  if (/Missing source|Source not installed|Source not found/i.test(message)) {
    return { kind: 'source_missing', httpStatus };
  }
  if (/No chapters found/i.test(message)) return { kind: 'no_chapters', httpStatus };
  if (httpStatus === 404 || httpStatus === 410) return { kind: 'not_found', httpStatus };
  if (httpStatus === 403 || httpStatus === 429 || httpStatus === 503 || /cloudflare|captcha|flaresolverr|byparr/i.test(message)) {
    return { kind: 'blocked', httpStatus };
  }
  return { kind: 'error', httpStatus };
}

/** Trims Kotlin exception noise ("java.lang.Exception: ...") for display. */
export function cleanErrorMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  return firstLine
    .replace(/^Exception while fetching data \([^)]*\)\s*:\s*/i, '')
    .replace(/^([a-z0-9_]+\.)+[A-Za-z0-9_]*(Exception|Error):\s*/, '')
    .trim()
    .slice(0, 500);
}
