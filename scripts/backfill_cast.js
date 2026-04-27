#!/usr/bin/env node
/* ============================================================
   backfill_cast.js
   One-time migration: adds "cast" field to entries in
   data/movies.json and data/series.json that are missing it.

   Usage:
     TMDB_API_KEY=xxx node scripts/backfill_cast.js
   ============================================================ */

const fs = require("fs");
const path = require("path");

const moviesPath = path.join(__dirname, "../data/movies.json");
const seriesPath = path.join(__dirname, "../data/series.json");

const movies = JSON.parse(fs.readFileSync(moviesPath, "utf-8"));
const series = JSON.parse(fs.readFileSync(seriesPath, "utf-8"));

if (!process.env.TMDB_API_KEY) {
  console.error("[FATAL] TMDB_API_KEY environment variable is required.");
  process.exit(1);
}

async function fetchCast(type, id) {
  const url =
    type === "movie"
      ? `https://api.themoviedb.org/3/movie/${id}?api_key=${process.env.TMDB_API_KEY}&append_to_response=credits`
      : `https://api.themoviedb.org/3/tv/${id}?api_key=${process.env.TMDB_API_KEY}&append_to_response=credits`;

  const res = await fetch(url);
  const data = await res.json();

  return (data.credits?.cast || []).slice(0, 12).map(a => ({
    id: a.id,
    name: a.name,
    profile_path: a.profile_path
  }));
}

async function processCollection(collection, type) {
  let updated = 0;

  for (const key of Object.keys(collection)) {
    const item = collection[key];

    if (item.cast && item.cast.length) continue;
    if (!item.tmdb_id) continue;

    try {
      const cast = await fetchCast(type, item.tmdb_id);
      item.cast = cast;
      updated++;

      console.log(`[CAST] ${type} updated: ${item.title || key}`);

      await new Promise(r => setTimeout(r, 200)); // rate limit safety
    } catch (e) {
      console.log(`[ERROR] ${type} ${key}`, e.message);
    }
  }

  return updated;
}

(async () => {
  const m = await processCollection(movies, "movie");
  const s = await processCollection(series, "tv");

  fs.writeFileSync(moviesPath, JSON.stringify(movies, null, 2));
  fs.writeFileSync(seriesPath, JSON.stringify(series, null, 2));

  console.log(`[DONE] movies=${m}, series=${s}`);
})();
