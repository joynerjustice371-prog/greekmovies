/* ============================================================
   tmdb.js — TMDB API Client  v4.0
   Greek-first with en-US fallback
   Exposes: networks (with logos), production_companies,
            origin_country — needed by Network + Genre systems
   ============================================================ */

const TMDB_API_KEY  = "f6aeb62fa60713990edbc2894a8d1d5d";
const TMDB_BASE     = "https://api.themoviedb.org/3";
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p";

function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export const IMG = {
  poster:   (p) => p ? `${TMDB_IMG_BASE}/w500${p}`     : null,
  posterLg: (p) => p ? `${TMDB_IMG_BASE}/w780${p}`     : null,
  backdrop: (p) => p ? `${TMDB_IMG_BASE}/original${p}` : null,
  thumb:    (p) => p ? `${TMDB_IMG_BASE}/w300${p}`     : null,
  logo:     (p) => p ? `${TMDB_IMG_BASE}/w185${p}`     : null,
};

export class TMDBClient {
  constructor() { this._cache = new Map(); }

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
      if (!grData.name?.trim() || !grData.overview?.trim()) {
        try {
          const resEn = await withTimeout(
            fetch(`${TMDB_BASE}/tv/${id}?api_key=${TMDB_API_KEY}&language=en-US`),
            4000
          );
          if (resEn?.ok) enData = await resEn.json();
        } catch (_) {}
      }

      const normalized = this._normalize(grData, enData);
      this._cache.set(key, normalized);
      return normalized;
    } catch (err) {
      console.warn(`[TMDB] fetchById(${id}) failed:`, err.message);
      return null;
    }
  }

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
      if (!data.results?.length) return null;
      const best = data.results.reduce((a, b) => (b.popularity > a.popularity ? b : a));
      const full = await this.fetchById(best.id);
      this._cache.set(key, full);
      return full;
    } catch (err) {
      console.warn(`[TMDB] searchByTitle("${title}") failed:`, err.message);
      return null;
    }
  }

  async getDetails(seriesEntry) {
    if (seriesEntry.tmdb_id) {
      const result = await this.fetchById(seriesEntry.tmdb_id);
      if (result) return result;
    }
    if (seriesEntry.title_fallback) return this.searchByTitle(seriesEntry.title_fallback);
    return null;
  }

  _normalize(gr, en = null) {
    const title    = gr.name?.trim()     || en?.name?.trim()     || gr.original_name || null;
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
      /* Networks now include id + logo for Network page */
      networks: (gr.networks ?? []).map(n => ({
        id:   n.id,
        name: n.name,
        logo: IMG.logo(n.logo_path),
      })),
      /* Production companies (useful for movies or missing-network fallback) */
      productionCompanies: (gr.production_companies ?? []).map(c => ({
        id:   c.id,
        name: c.name,
        logo: IMG.logo(c.logo_path),
      })),
      originCountry: gr.origin_country ?? [],
      language:      gr.original_language ?? null,
    };
  }

  async batchResolve(entries) {
    try {
      const results = await Promise.allSettled(
        entries.map(({ slug, data }) =>
          this.getDetails(data).then(tmdb => ({ slug, data, tmdb }))
        )
      );
      return results.filter(r => r.status === "fulfilled").map(r => r.value);
    } catch (err) {
      console.warn("[TMDB] batchResolve failed:", err.message);
      return entries.map(({ slug, data }) => ({ slug, data, tmdb: null }));
    }
  }

  async getCredits(tmdbId, type = 'tv') {
    const key = `credits:${type}:${tmdbId}`;
    if (this._cache.has(key)) return this._cache.get(key);
    try {
      const res = await withTimeout(
        fetch(`${TMDB_BASE}/${type}/${tmdbId}/credits?api_key=${TMDB_API_KEY}&language=el-GR`),
        5000
      );
      if (!res || !res.ok) throw new Error(res ? `TMDB ${res.status}` : 'Timeout');
      const data = await res.json();
      const cast = (data.cast || []).slice(0, 12).map(a => ({
        id: a.id,
        name: a.name,
        profile_path: a.profile_path ? IMG.thumb(a.profile_path) : null,
      }));
      this._cache.set(key, cast);
      return cast;
    } catch (err) {
      console.warn(`[TMDB] getCredits(${tmdbId}, ${type}) failed:`, err.message);
      return [];
    }
  }

  cacheSize() { return this._cache.size; }
}

export const tmdb = new TMDBClient();
