/* ============================================================
   tmdb.js — TMDB API Client (Greek-first with en-US fallback)
   ============================================================ */

const TMDB_API_KEY  = "YOUR_TMDB_API_KEY";
const TMDB_BASE     = "https://api.themoviedb.org/3";
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p";

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
      // PART 1 FIX: always request Greek first
      const res = await fetch(
        `${TMDB_BASE}/tv/${id}?api_key=${TMDB_API_KEY}&language=el-GR`
      );
      if (!res.ok) throw new Error(`TMDB ${res.status}`);
      const grData = await res.json();

      // PART 1 FIX: fallback — if Greek title/overview is empty, fetch en-US
      let enData = null;
      const needsFallback = !grData.name?.trim() || !grData.overview?.trim();
      if (needsFallback) {
        try {
          const resEn = await fetch(
            `${TMDB_BASE}/tv/${id}?api_key=${TMDB_API_KEY}&language=en-US`
          );
          if (resEn.ok) enData = await resEn.json();
        } catch (_) { /* silent — best effort */ }
      }

      const normalized = this._normalize(grData, enData);
      this._cache.set(key, normalized);
      return normalized;
    } catch (err) {
      console.warn(`[TMDB] fetchById(${id}) failed:`, err.message);
      return null;
    }
  }

  /* ── Search by title — Greek first ────────────────────────── */
  async searchByTitle(title) {
    const key = `search:${title.toLowerCase()}`;
    if (this._cache.has(key)) return this._cache.get(key);

    try {
      // PART 1 FIX: Greek language for search
      const res = await fetch(
        `${TMDB_BASE}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=el-GR`
      );
      if (!res.ok) throw new Error(`TMDB search ${res.status}`);
      const data = await res.json();

      if (!data.results?.length) {
        console.warn(`[TMDB] No results for "${title}"`);
        return null;
      }

      const best = data.results.reduce((a, b) =>
        (b.popularity > a.popularity ? b : a)
      );

      const full = await this.fetchById(best.id);
      this._cache.set(key, full);
      return full;
    } catch (err) {
      console.warn(`[TMDB] searchByTitle("${title}") failed:`, err.message);
      return null;
    }
  }

  /* ── Smart resolver: ID first, search fallback ─────────────── */
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

  /* ── Normalize: Greek data with en-US fallback for blanks ─── */
  _normalize(gr, en = null) {
    // PART 1 FIX: title → gr.name, fallback to en.name, then original_name
    const title    = gr.name?.trim()     || en?.name?.trim()          || gr.original_name || "Unknown";
    // PART 1 FIX: overview → gr.overview, fallback to en.overview
    const overview = gr.overview?.trim() || en?.overview?.trim()      || "";
    // Genres from Greek response (may be empty); fallback to English
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

  /* ── Batch resolve ─────────────────────────────────────────── */
  async batchResolve(entries) {
    const results = await Promise.allSettled(
      entries.map(({ slug, data }) =>
        this.getDetails(data).then(tmdb => ({ slug, data, tmdb }))
      )
    );
    return results
      .filter(r => r.status === "fulfilled")
      .map(r => r.value);
  }

  cacheSize() { return this._cache.size; }
}

/* Singleton */
export const tmdb = new TMDBClient();
