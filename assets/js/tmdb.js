/* ============================================================
   tmdb.js — TMDB API Client
   Replace TMDB_API_KEY with your key from themoviedb.org
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

  /* ── Mode A: fetch by TMDB ID ────────────────────────────── */
  async fetchById(id) {
    const key = `id:${id}`;
    if (this._cache.has(key)) return this._cache.get(key);

    try {
      const res = await fetch(
        `${TMDB_BASE}/tv/${id}?api_key=${TMDB_API_KEY}&language=en-US`
      );
      if (!res.ok) throw new Error(`TMDB ${res.status}`);
      const data = await res.json();
      const normalized = this._normalize(data);
      this._cache.set(key, normalized);
      return normalized;
    } catch (err) {
      console.warn(`[TMDB] fetchById(${id}) failed:`, err.message);
      return null;
    }
  }

  /* ── Mode B: search by title, pick best match ────────────── */
  async searchByTitle(title) {
    const key = `search:${title.toLowerCase()}`;
    if (this._cache.has(key)) return this._cache.get(key);

    try {
      const res = await fetch(
        `${TMDB_BASE}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=en-US`
      );
      if (!res.ok) throw new Error(`TMDB search ${res.status}`);
      const data = await res.json();

      if (!data.results?.length) {
        console.warn(`[TMDB] No results for "${title}"`);
        return null;
      }

      // Best match: highest popularity from first page
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

  /* ── Smart resolver: tries ID first, falls back to search ── */
  async getDetails(seriesEntry) {
    if (seriesEntry.tmdb_id) {
      const result = await this.fetchById(seriesEntry.tmdb_id);
      if (result) return result;
      // ID failed — fall through to search
    }
    if (seriesEntry.title_fallback) {
      return this.searchByTitle(seriesEntry.title_fallback);
    }
    return null;
  }

  /* ── Normalize raw TMDB response ────────────────────────── */
  _normalize(raw) {
    return {
      tmdbId:        raw.id,
      title:         raw.name               ?? "Unknown",
      originalTitle: raw.original_name      ?? raw.name,
      overview:      raw.overview           ?? "",
      poster:        IMG.poster(raw.poster_path),
      posterLg:      IMG.posterLg(raw.poster_path),
      backdrop:      IMG.backdrop(raw.backdrop_path),
      genres:        (raw.genres ?? []).map(g => g.name),
      year:          raw.first_air_date?.slice(0, 4) ?? null,
      rating:        raw.vote_average != null ? +raw.vote_average.toFixed(1) : null,
      seasons:       raw.number_of_seasons  ?? null,
      episodes:      raw.number_of_episodes ?? null,
      status:        raw.status             ?? null,
      networks:      (raw.networks ?? []).map(n => n.name),
      language:      raw.original_language  ?? null,
    };
  }

  /* ── Batch resolve many series entries ───────────────────── */
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

/* Singleton export */
export const tmdb = new TMDBClient();
