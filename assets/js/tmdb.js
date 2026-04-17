/* ============================================================
   tmdb.js — TMDB API Client
   Greek-first with en-US fallback
   All calls wrapped in try/catch — safe to use with invalid key
   ============================================================ */

const TMDB_API_KEY  = "f6aeb62fa60713990edbc2894a8d1d5d";
const TMDB_BASE     = "https://api.themoviedb.org/3";
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p";

/* ── Timeout helper ──────────────────────────────────────── */
function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export const IMG = {
  poster:   (path) => path ? `${TMDB_IMG_BASE}/w500${path}`     : null,
  posterLg: (path) => path ? `${TMDB_IMG_BASE}/w780${path}`     : null,
  backdrop: (path) => path ? `${TMDB_IMG_BASE}/original${path}` : null,
  thumb:    (path) => path ? `${TMDB_IMG_BASE}/w300${path}`     : null,
};

export class TMDBClient {
  constructor() {
    this._cache = new Map();
  }

  /* ── Fetch TV details by ID — Greek first, en-US fallback ── */
  async fetchById(id) {
    const key = `id:${id}`;
    if (this._cache.has(key)) return this._cache.get(key);

    try {
      const res = await withTimeout(
        fetch(`${TMDB_BASE}/tv/${id}?api_key=${TMDB_API_KEY}&language=el-GR`),
        5000
      );
      if (!res || !res.ok) throw new Error(res ? `TMDB ${res.status}` : "Timeout");
      const grData = await res.json();

      let enData = null;
      const needsFallback = !grData.name?.trim() || !grData.overview?.trim();
      if (needsFallback) {
        try {
          const resEn = await withTimeout(
            fetch(`${TMDB_BASE}/tv/${id}?api_key=${TMDB_API_KEY}&language=en-US`),
            4000
          );
          if (resEn?.ok) enData = await resEn.json();
        } catch (_) { /* silent */ }
      }

      const normalized = this._normalize(grData, enData);
      this._cache.set(key, normalized);
      return normalized;
    } catch (err) {
      console.warn(`[TMDB] fetchById(${id}) failed:`, err.message);
      return null;
    }
  }

  /* ── Search by title ────────────────────────────────────── */
  async searchByTitle(title) {
    const key = `search:${title.toLowerCase()}`;
    if (this._cache.has(key)) return this._cache.get(key);

    try {
      const res = await withTimeout(
        fetch(`${TMDB_BASE}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=el-GR`),
        5000
      );
      if (!res || !res.ok) throw new Error(res ? `TMDB search ${res.status}` : "Timeout");
      const data = await res.json();

      if (!data.results?.length) {
        console.warn(`[TMDB] No results for "${title}"`);
        return null;
      }

      const best = data.results.reduce((a, b) => (b.popularity > a.popularity ? b : a));
      const full = await this.fetchById(best.id);
      this._cache.set(key, full);
      return full;
    } catch (err) {
      console.warn(`[TMDB] searchByTitle("${title}") failed:`, err.message);
      return null;
    }
  }

  /* ── Smart resolver: ID first, search fallback ─────────── */
  async getDetails(seriesEntry) {
    if (seriesEntry.tmdb_id) {
      const result = await this.fetchById(seriesEntry.tmdb_id);
      if (result) return result;
    }
    if (seriesEntry.title_fallback) {
      return this.searchByTitle(seriesEntry.title_fallback);
    }
    return null;
  }

  /* ── Normalize: Greek with en-US fallback ───────────────── */
  _normalize(gr, en = null) {
    const title    = gr.name?.trim()     || en?.name?.trim()     || gr.original_name || "Unknown";
    const overview = gr.overview?.trim() || en?.overview?.trim() || "";
    const genres   = (gr.genres?.length ? gr.genres : en?.genres ?? []).map(g => g.name);

    return {
      tmdbId:        gr.id,
      title,
      originalTitle: gr.original_name ?? gr.name,
      overview,
      poster:        IMG.poster(gr.poster_path),
      posterLg:      IMG.posterLg(gr.poster_path),
      backdrop:      IMG.backdrop(gr.backdrop_path),
      genres,
      year:          gr.first_air_date?.slice(0, 4) ?? null,
      rating:        gr.vote_average != null ? +gr.vote_average.toFixed(1) : null,
      seasons:       gr.number_of_seasons  ?? null,
      episodes:      gr.number_of_episodes ?? null,
      status:        gr.status             ?? null,
      networks:      (gr.networks ?? []).map(n => n.name),
      language:      gr.original_language  ?? null,
    };
  }

  /* ── Batch resolve — ALWAYS returns array ────────────────── */
  async batchResolve(entries) {
    try {
      const results = await Promise.allSettled(
        entries.map(({ slug, data }) =>
          this.getDetails(data).then(tmdb => ({ slug, data, tmdb }))
        )
      );
      return results
        .filter(r => r.status === "fulfilled")
        .map(r => r.value);
    } catch (err) {
      console.warn("[TMDB] batchResolve failed:", err.message);
      // Return entries with null tmdb — still renders from local data
      return entries.map(({ slug, data }) => ({ slug, data, tmdb: null }));
    }
  }

  cacheSize() { return this._cache.size; }
}

/* Singleton */
export const tmdb = new TMDBClient();
