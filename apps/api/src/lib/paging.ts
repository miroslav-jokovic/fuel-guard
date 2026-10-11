/**
 * The PostgREST paging helpers live in `@silvicom/shared` since IE-ADMIN (§4 Q-FSV17): the platform
 * console's service reads past the same 1,000-row cap and may not import `apps/api`. This file keeps
 * the forty-odd `../lib/paging.js` imports here pointing at the one definition.
 */
export { DEFAULT_PAGE_SIZE, IN_LIST_CHUNK, chunks, eachPage, fetchAllPaged } from "@silvicom/shared";
