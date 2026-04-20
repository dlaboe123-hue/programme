import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus, Check, Sparkles, Trash2, X, Star, Tv,
  Loader2, RefreshCw, SlidersHorizontal, Search, Settings,
  Clock, Library, TrendingUp,
} from 'lucide-react';

/* =============================================================================
   PROGRAMME — a shared film programme.
   Config comes from env vars (VITE_TMDB_API_KEY, VITE_USERS) with an in-app
   settings fallback. No secrets or personal data are hardcoded.
   ============================================================================= */

const STORAGE_KEYS = {
  watchlist: 'programme-watchlist-v1',
  seen:      'programme-seen-v1',
  discover:  'programme-discover-v2',
  filters:   'programme-filters-v1',
  services:  'programme-services-v1',
  settings:  'programme-settings-v1',
};

/* =============================================================================
   Environment + settings
   ============================================================================= */

function readEnvUsers() {
  const raw = import.meta.env?.VITE_USERS;
  if (!raw) return null;
  const list = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

const ENV_API_KEY = import.meta.env?.VITE_TMDB_API_KEY || '';
const ENV_USERS   = readEnvUsers();

const ENV_SYNC_URL = import.meta.env?.VITE_SYNC_URL || '';

function resolveSettings(saved) {
  return {
    apiKey: ENV_API_KEY || saved?.apiKey || '',
    users: ENV_USERS || (saved?.users?.length ? saved.users : []),
    syncUrl: ENV_SYNC_URL || saved?.syncUrl || '',
  };
}

/* =============================================================================
   Sync — generic HTTP JSON store (Firebase RTDB REST, JSONbox, Supabase REST,
   any endpoint supporting GET/PUT of JSON at a single URL). Keeps the 5-file
   structure; swap the transport later without touching the rest of the app.

   Merge policy:
     - Lists (watchlist, seen): union by film id; per-entry latest-wins via
       the _updatedAt stamp each entry carries.
     - Objects (filters, services, settings): latest-wins on the whole blob.
   ============================================================================= */

const DEVICE_ID = (() => {
  try {
    const k = 'programme-device-id';
    const existing = typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
    if (existing) return existing;
    const fresh = Math.random().toString(36).slice(2, 10);
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, fresh);
    return fresh;
  } catch { return 'anon'; }
})();

function stampEntry(entry) {
  return { ...entry, _updatedAt: Date.now(), _updatedBy: DEVICE_ID };
}

function mergeList(local = [], remote = []) {
  const byId = new Map();
  for (const f of local || [])  if (f?.id) byId.set(f.id, f);
  for (const f of remote || []) {
    if (!f?.id) continue;
    const cur = byId.get(f.id);
    if (!cur) { byId.set(f.id, f); continue; }
    const lt = cur._updatedAt || 0;
    const rt = f._updatedAt || 0;
    byId.set(f.id, rt >= lt ? f : cur);
  }
  // Preserve display order: newly added (by _updatedAt desc) first
  return Array.from(byId.values())
    .sort((a, b) => (b._updatedAt || 0) - (a._updatedAt || 0));
}

function mergeBlob(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const lt = local?._updatedAt || 0;
  const rt = remote?._updatedAt || 0;
  return rt >= lt ? remote : local;
}

function mergeState(local, remote) {
  if (!remote) return { state: local, changed: false };
  return {
    state: {
      watchlist: mergeList(local.watchlist, remote.watchlist),
      seen:      mergeList(local.seen,      remote.seen),
      filters:   mergeBlob(local.filters,   remote.filters),
      services:  mergeBlob(local.services,  remote.services),
    },
    changed: true,
  };
}

function makeSync(url) {
  if (!url) {
    return { enabled: false, pull: async () => null, push: async () => {} };
  }
  return {
    enabled: true,
    async pull() {
      const res = await fetch(url, { method: 'GET', cache: 'no-store' });
      if (!res.ok) throw new Error(`Sync pull ${res.status}`);
      const txt = await res.text();
      if (!txt || txt === 'null') return null;
      try { return JSON.parse(txt); } catch { return null; }
    },
    async push(state) {
      const body = JSON.stringify({
        ...state,
        _updatedAt: Date.now(),
        _updatedBy: DEVICE_ID,
      });
      const res = await fetch(url, {
        method: 'PUT', body,
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Sync push ${res.status}`);
    },
  };
}

/* =============================================================================
   Storage (Claude artifact bridge + localStorage)
   ============================================================================= */

async function loadKey(key, fallback = null) {
  try {
    if (typeof window !== 'undefined' && window.storage?.get) {
      const r = await window.storage.get(key, true);
      if (r?.value) return JSON.parse(r.value);
      return fallback;
    }
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(key);
      if (v) return JSON.parse(v);
    }
  } catch { /* missing key or bad JSON */ }
  return fallback;
}

async function saveKey(key, value) {
  try {
    if (typeof window !== 'undefined' && window.storage?.set) {
      await window.storage.set(key, JSON.stringify(value), true);
      return;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (e) { console.error('saveKey', key, e); }
}

/* =============================================================================
   TMDB constants (these are TMDB's own catalog IDs — not user data)
   ============================================================================= */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p';

const PROVIDER_IDS = {
  'Netflix': 8, 'Max': 1899, 'Hulu': 15, 'Prime Video': 9,
  'Disney+': 337, 'Apple TV+': 350, 'Paramount+': 531, 'Peacock': 386,
  'Starz': 43, 'MGM+': 1968, 'AMC+': 526,
};
const PROVIDER_NAME_BY_ID = Object.fromEntries(
  Object.entries(PROVIDER_IDS).map(([n, id]) => [id, n])
);

const TMDB_GENRE_IDS = {
  'Action': 28, 'Adventure': 12, 'Animation': 16, 'Comedy': 35,
  'Crime': 80, 'Documentary': 99, 'Drama': 18, 'Family': 10751,
  'Fantasy': 14, 'History': 36, 'Horror': 27, 'Music': 10402,
  'Mystery': 9648, 'Romance': 10749, 'Sci-Fi': 878, 'Thriller': 53,
  'War': 10752, 'Western': 37,
};
const GENRE_NAME_BY_ID = Object.fromEntries(
  Object.entries(TMDB_GENRE_IDS).map(([n, id]) => [id, n])
);

const DEFAULT_SERVICES = Object.keys(PROVIDER_IDS);

const GENRE_OPTIONS = [
  'Drama', 'Thriller', 'Sci-Fi', 'Horror', 'Comedy', 'Crime',
  'Mystery', 'Romance', 'War', 'Western', 'Action', 'Documentary',
  'Animation', 'Fantasy',
];

const BUDGET_TIERS = [
  { id: 'indie',       label: 'Indie',       range: '< $10M' },
  { id: 'mid',         label: 'Mid-budget',  range: '$10–50M' },
  { id: 'tentpole',    label: 'Tentpole',    range: '$50–150M' },
  { id: 'blockbuster', label: 'Blockbuster', range: '$150M+' },
];

const RECEPTION_OPTIONS = [
  { id: 'universal',  label: 'Universal acclaim', sub: 'rating 8.0+' },
  { id: 'polarized',  label: 'Polarized',          sub: 'loved and loathed' },
  { id: 'cult',       label: 'Cult favorite',      sub: 'strong rating, smaller audience' },
  { id: 'overlooked', label: 'Overlooked',         sub: 'high rating, low votes' },
];

const currentYear = new Date().getFullYear();

const DEFAULT_FILTERS = {
  genres: [],
  yearMin: 1950,
  yearMax: currentYear,
  ratingMin: 6.5,
  votesMin: 1000,
  runtimeMax: null,
  budgetTier: null,
  reception: null,
  mood: '',
  includeRentals: false,
};

const C = {
  bg: '#0E0B08', surface: '#161210', surfaceRaised: '#201B15',
  border: '#2A241C', borderDim: '#1E1915',
  text: '#EFE6D2', textDim: '#A69A83', textFaint: '#6B604F',
  accent: '#D9A441', accentDim: '#8B6B2F', red: '#B54E3E',
};

const FONT = {
  display: `'Fraunces', 'Times New Roman', Georgia, serif`,
  body:    `'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif`,
  mono:    `'JetBrains Mono', 'Courier New', monospace`,
};

/* =============================================================================
   TMDB client (apiKey-scoped, abort-safe)
   ============================================================================= */

function makeTmdb(apiKey) {
  async function fetchPath(path, params = {}, { signal } = {}) {
    if (!apiKey) throw new Error('TMDB API key not configured');
    const url = new URL(TMDB_BASE + path);
    url.searchParams.set('api_key', apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
    let res;
    try {
      res = await fetch(url.toString(), { signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(`Network error: ${e.message || 'unreachable'}`);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch {}
      if (res.status === 401) throw new Error('TMDB API key invalid');
      if (res.status === 429) throw new Error('TMDB rate limit — wait a moment');
      throw new Error(`TMDB ${res.status}${detail ? ': ' + detail : ''}`);
    }
    return res.json();
  }

  return {
    fetch: fetchPath,
    getDetails: (id, opts) => fetchPath(`/movie/${id}`, {
      append_to_response: 'credits,watch/providers',
      language: 'en-US',
    }, opts),
    searchMovie: (query, year, opts) => fetchPath('/search/movie', {
      query, year: year || undefined,
      include_adult: 'false', language: 'en-US', page: 1,
    }, opts),
    searchKeyword: (query, opts) => fetchPath('/search/keyword', { query }, opts),
    discover: (params, opts) => fetchPath('/discover/movie', params, opts),
  };
}

function tmdbResultToFilm(r) {
  return {
    tmdbId: r.id,
    title: r.title || r.name || '',
    year: r.release_date ? parseInt(r.release_date.slice(0, 4)) : null,
    runtime: null,
    director: null,
    genres: (r.genre_ids || []).map(id => GENRE_NAME_BY_ID[id]).filter(Boolean),
    synopsis: r.overview || null,
    posterUrl: r.poster_path ? `${TMDB_IMG}/w500${r.poster_path}` : null,
    imdbId: null,
    rating: typeof r.vote_average === 'number' ? r.vote_average : null,
    votes: r.vote_count || null,
    budget: null,
    availability: null,
  };
}

function extractProviders(details) {
  const us = details?.['watch/providers']?.results?.US;
  if (!us) return { streaming: [], rental: [] };
  const seen = new Set();
  const streaming = (us.flatrate || [])
    .map(p => PROVIDER_NAME_BY_ID[p.provider_id] || p.provider_name)
    .filter(n => n && !seen.has(n) && seen.add(n));
  const rSeen = new Set();
  const rental = [...(us.rent || []), ...(us.buy || [])]
    .map(p => ({ service: p.provider_name }))
    .filter(r => r.service && !rSeen.has(r.service) && rSeen.add(r.service));
  return { streaming, rental };
}

function extractDirector(details) {
  const crew = details?.credits?.crew || [];
  const dirs = crew.filter(c => c.job === 'Director').map(c => c.name);
  if (!dirs.length) return null;
  return dirs.length === 1 ? dirs[0] : dirs.slice(0, 2).join(' & ');
}

function detailsToFilmMeta(details) {
  return {
    tmdbId: details.id,
    imdbId: details.imdb_id || null,
    title: details.title || '',
    director: extractDirector(details),
    year: details.release_date ? parseInt(details.release_date.slice(0, 4)) : null,
    runtime: details.runtime || null,
    genres: (details.genres || []).map(g => g.name),
    synopsis: details.overview || null,
    posterUrl: details.poster_path ? `${TMDB_IMG}/w500${details.poster_path}` : null,
    rating: typeof details.vote_average === 'number' ? details.vote_average : null,
    votes: details.vote_count || null,
    budget: details.budget || null,
    availability: extractProviders(details),
  };
}

async function searchAndEnrich(tmdb, title, year, opts) {
  const search = await tmdb.searchMovie(title, year, opts);
  const match = search.results?.[0];
  if (!match) throw new Error('Not found on TMDB');
  const details = await tmdb.getDetails(match.id, opts);
  return detailsToFilmMeta(details);
}

async function generateDiscover(tmdb, { filters, services, page = 1, signal }) {
  const genreIds = filters.genres
    .map(g => TMDB_GENRE_IDS[g]).filter(Boolean).join(',');
  const providerIds = (services || DEFAULT_SERVICES)
    .map(s => PROVIDER_IDS[s]).filter(Boolean).join('|');
  const monetization = filters.includeRentals ? 'flatrate|rent|buy' : 'flatrate';

  const params = {
    language: 'en-US', region: 'US',
    sort_by: 'vote_average.desc',
    include_adult: 'false', include_video: 'false',
    page,
    'vote_count.gte': filters.votesMin,
    'vote_average.gte': filters.ratingMin,
    'primary_release_date.gte': filters.yearMin + '-01-01',
    'primary_release_date.lte': filters.yearMax + '-12-31',
    watch_region: 'US',
    with_watch_monetization_types: monetization,
  };
  if (genreIds)    params.with_genres = genreIds;
  if (providerIds) params.with_watch_providers = providerIds;
  if (filters.runtimeMax) params['with_runtime.lte'] = filters.runtimeMax;

  if (filters.reception === 'universal') {
    params['vote_average.gte'] = Math.max(8.0, filters.ratingMin);
    params['vote_count.gte']   = Math.max(5000, filters.votesMin);
  } else if (filters.reception === 'polarized') {
    params['vote_average.gte'] = 5.5;
    params['vote_average.lte'] = 7.2;
    params['vote_count.gte']   = Math.max(30000, filters.votesMin);
    params.sort_by = 'vote_count.desc';
  } else if (filters.reception === 'cult') {
    params['vote_average.gte'] = Math.max(7.0, filters.ratingMin);
    params['vote_count.lte']   = 30000;
    params['vote_count.gte']   = Math.max(1000, filters.votesMin);
  } else if (filters.reception === 'overlooked') {
    params['vote_average.gte'] = Math.max(7.5, filters.ratingMin);
    params['vote_count.lte']   = 15000;
    params['vote_count.gte']   = Math.max(500, filters.votesMin);
  }

  if (filters.mood?.trim()) {
    try {
      const kw = await tmdb.searchKeyword(filters.mood.trim(), { signal });
      const kwId = kw.results?.[0]?.id;
      if (kwId) params.with_keywords = kwId;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
  }

  const data = await tmdb.discover(params, { signal });
  return {
    films: (data.results || []).map(tmdbResultToFilm),
    page: data.page || page,
    totalPages: Math.min(data.total_pages || 1, 500),
  };
}

/* =============================================================================
   Preference profile + scoring (internal "ML")

   Foundation: each SIGNAL extracts categorical features from a film. The profile
   accumulates weighted feature counts from rated films; the scorer sums the
   matching weights for a candidate and surfaces the top contributors as
   catalysts. New signals (keywords, cast, mood-terms, collaborative across
   users, time-of-day context) plug in here without touching the scorer.
   ============================================================================= */

const SIGNALS = [
  {
    name: 'genre',
    weight: 1.0,
    extract: f => f.genres || [],
    display: v => v,
  },
  {
    name: 'director',
    weight: 2.5,
    extract: f => f.director ? [f.director] : [],
    display: v => v,
  },
  {
    name: 'decade',
    weight: 0.4,
    extract: f => f.year ? [`${Math.floor(f.year / 10) * 10}s`] : [],
    display: v => v,
  },
];

// Turn a rating in [1,5] into a centered weight: 1→−1.5, 3→0.5, 5→2.5
// Negative ratings pull features DOWN (so a 1★ Horror film penalizes Horror).
function ratingToWeight(r) { return typeof r === 'number' ? r - 2.5 : 0; }

function seenToRated(seen, userFilter /* username | null for combined */) {
  const rows = [];
  for (const f of seen || []) {
    const ratings = f.userRatings || {};
    if (userFilter) {
      const r = ratings[userFilter];
      if (typeof r === 'number') rows.push({ film: f, rating: r, user: userFilter });
    } else {
      for (const [u, r] of Object.entries(ratings)) {
        if (typeof r === 'number') rows.push({ film: f, rating: r, user: u });
      }
    }
  }
  return rows;
}

function computeProfile(rated) {
  if (!rated?.length) return null;
  const profile = { _count: rated.length };
  for (const sig of SIGNALS) profile[sig.name] = {};

  for (const { film, rating } of rated) {
    const w = ratingToWeight(rating);
    if (w === 0) continue;
    for (const sig of SIGNALS) {
      for (const feat of sig.extract(film)) {
        profile[sig.name][feat] = (profile[sig.name][feat] || 0) + w;
      }
    }
  }

  // Runtime: continuous, weighted mean + std from films rated ≥3★
  const rts = rated
    .filter(x => x.film.runtime && x.rating >= 3)
    .map(x => ({ r: x.film.runtime, w: x.rating - 2 }));
  if (rts.length) {
    const tw = rts.reduce((s, x) => s + x.w, 0);
    const mean = rts.reduce((s, x) => s + x.r * x.w, 0) / tw;
    const variance = rts.reduce((s, x) => s + x.w * (x.r - mean) ** 2, 0) / tw;
    profile.runtime = { mean, std: Math.max(15, Math.sqrt(variance) || 20) };
  }

  // Top rated films — used as "because you loved X" anchors in UI
  profile.topFilms = [...rated]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 5)
    .map(x => ({ title: x.film.title, rating: x.rating, tmdbId: x.film.tmdbId }));

  return profile;
}

function topFeatures(bucket, n = 5) {
  return Object.entries(bucket || {})
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([feature, weight]) => ({ feature, weight }));
}

// Score a candidate film against a profile.
// Returns { score, reasons: [{ signal, feature, contribution }] }.
function scoreFilm(film, profile) {
  if (!profile) return { score: 0, reasons: [] };
  let score = 0;
  const reasons = [];

  for (const sig of SIGNALS) {
    const bucket = profile[sig.name];
    if (!bucket) continue;
    for (const feat of sig.extract(film)) {
      const w = bucket[feat];
      if (!w) continue;
      const contribution = w * sig.weight;
      score += contribution;
      if (contribution > 0) reasons.push({ signal: sig.name, feature: feat, contribution });
    }
  }

  // Runtime fit: gaussian around the profile's mean
  if (film.runtime && profile.runtime) {
    const z = (film.runtime - profile.runtime.mean) / profile.runtime.std;
    const fit = Math.exp(-(z * z) / 2) * 1.5;
    score += fit;
    if (fit > 0.9) {
      reasons.push({
        signal: 'runtime',
        feature: `~${Math.round(profile.runtime.mean)}min`,
        contribution: fit,
      });
    }
  }

  // Quality prior from TMDB rating (mildly biases toward well-regarded films)
  if (typeof film.rating === 'number') score += (film.rating - 6) * 0.3;

  reasons.sort((a, b) => b.contribution - a.contribution);
  return { score, reasons: reasons.slice(0, 3) };
}

function reasonLabel(r) {
  if (r.signal === 'genre')    return r.feature;
  if (r.signal === 'director') return r.feature;
  if (r.signal === 'decade')   return r.feature;
  if (r.signal === 'runtime')  return r.feature;
  return r.feature;
}

/* =============================================================================
   Tonight picker — local scoring heuristic, no external API
   ============================================================================= */

// Returns a small object describing the current wall-clock context that the
// Tonight picker can use as additional signal. Kept separate so it's easy to
// replace (e.g. per-user calendars) later.
function tonightTimeContext(now = new Date()) {
  const hour = now.getHours();
  const day  = now.getDay(); // 0 = Sunday ... 6 = Saturday
  const isFriSat = day === 5 || day === 6;
  const isSunday = day === 0;
  const isWeeknight = !isFriSat && !isSunday;
  const isLate = hour >= 22 || hour < 2;
  const isEvening = hour >= 17 && hour < 22;
  let label = '';
  if (isFriSat && isEvening) label = `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]} night — room for anything`;
  else if (isSunday && isEvening) label = 'Sunday evening — fine for long or heavy';
  else if (isWeeknight && isEvening) label = 'Weeknight — leaning shorter';
  else if (isLate) label = 'Late — atmospheric and contained';
  else label = 'No strong time signal';
  return { hour, day, isFriSat, isSunday, isWeeknight, isLate, isEvening, label };
}

function pickForTonight({ watchlist, prompt, users, profile, timeCtx }) {
  if (!watchlist?.length) throw new Error('No films on your programme yet');

  const p = (prompt || '').toLowerCase().trim();
  const words = p.split(/\s+/).filter(w => w.length > 2);
  const ctx = timeCtx || tonightTimeContext();

  const scored = watchlist.map(f => {
    let score = (f.rating || 7) * 10;

    // Profile alignment — the same internal scorer used for recommendations
    if (profile) {
      const { score: profScore } = scoreFilm(f, profile);
      score += profScore * 4;
    }

    // Time-of-day nudges (small, just to bias ties)
    if (ctx.isWeeknight && f.runtime && f.runtime < 110) score += 8;
    if (ctx.isSunday && f.runtime && f.runtime > 140) score += 6;
    if (ctx.isLate && (f.genres || []).some(g => ['Horror','Thriller','Mystery','Sci-Fi'].includes(g))) score += 5;
    if (ctx.isFriSat && (f.genres || []).some(g => ['Comedy','Action','Adventure'].includes(g))) score += 4;

    const addedBy = resolveAddedBy(f.addedBy, users || []);
    if (users?.length && addedBy.length >= users.length) score += 12;

    if (f.addedAt) {
      const days = (Date.now() - f.addedAt) / 86400000;
      if (days < 7) score += 6;
      else if (days < 30) score += 3;
    }

    if (p) {
      const hay = `${f.title} ${f.director || ''} ${f.synopsis || ''} ${(f.genres || []).join(' ')} ${f.why || ''}`.toLowerCase();
      for (const w of words) if (hay.includes(w)) score += 12;

      if (/\b(short|quick|brief|tired|tonight)\b/.test(p) && f.runtime && f.runtime < 110) score += 18;
      if (/\b(long|epic|immersive|deep)\b/.test(p) && f.runtime && f.runtime > 150) score += 18;
      if (/\b(funny|fun|light|laugh|comedy)\b/.test(p) && (f.genres || []).includes('Comedy')) score += 22;
      if (/\b(dark|serious|heavy|intense|bleak)\b/.test(p) && (f.genres || []).some(g => ['Drama','Thriller','Horror','War','Crime'].includes(g))) score += 22;
      if (/\b(scary|horror|scare)\b/.test(p) && (f.genres || []).includes('Horror')) score += 25;
      if (/\b(romantic|romance|date)\b/.test(p) && (f.genres || []).includes('Romance')) score += 22;
      if (/\b(action|thrill)\b/.test(p) && (f.genres || []).some(g => ['Action','Thriller'].includes(g))) score += 20;
      if (/\b(sci.?fi|science)\b/.test(p) && (f.genres || []).includes('Sci-Fi')) score += 22;
      if (/\b(new|recent|modern)\b/.test(p) && f.year >= 2020) score += 12;
      if (/\b(classic|old|vintage)\b/.test(p) && f.year < 2000) score += 12;
    }

    score += Math.random() * 6;
    return { film: f, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const pick = scored[0].film;

  return {
    pickTitle: pick.title,
    rationale: buildRationale(pick, prompt, users, ctx, profile),
    alternates: scored.slice(1, 3).map(s => ({
      title: s.film.title,
      why: buildAlternateReason(s.film, users),
    })),
    timeContext: ctx,
  };
}

function buildRationale(film, prompt, users, ctx, profile) {
  const parts = [];
  const p = (prompt || '').toLowerCase();
  if (film.rating >= 8.5) parts.push(`Heavyweight at ${film.rating.toFixed(1)}`);
  else if (film.rating >= 8.0) parts.push(`Well-regarded at ${film.rating.toFixed(1)}`);
  else if (film.rating >= 7.0) parts.push(`Solid at ${film.rating.toFixed(1)}`);
  else parts.push('A distinctive pick');
  if (film.director) parts.push(`${film.director}${film.year ? `, ${film.year}` : ''}`);
  else if (film.year) parts.push(`${film.year}`);
  if (film.runtime) {
    if (film.runtime < 100) parts.push(`lean at ${formatRuntime(film.runtime)}`);
    else if (film.runtime > 160) parts.push(`the full ${formatRuntime(film.runtime)} commitment`);
  }
  const addedBy = resolveAddedBy(film.addedBy, users || []);
  if (users?.length && addedBy.length >= users.length) parts.push('you all flagged it');

  // Profile catalysts
  if (profile) {
    const { reasons } = scoreFilm(film, profile);
    const top = reasons[0];
    if (top) {
      if (top.signal === 'director') parts.push(`a director you've rewarded`);
      else if (top.signal === 'genre') parts.push(`${top.feature} sits high in your profile`);
      else if (top.signal === 'runtime') parts.push(`near your runtime sweet spot`);
    }
  }

  if (film.why) parts.push(`note: "${film.why}"`);
  if (/\b(short|quick|tonight)\b/.test(p) && film.runtime && film.runtime < 110) {
    parts.push('fits the "make it quick" brief');
  } else if (/\b(funny|light)\b/.test(p) && (film.genres || []).includes('Comedy')) {
    parts.push('matches the lighter mood');
  }
  return parts.join('. ') + '.';
}

function buildAlternateReason(film, users) {
  const addedBy = resolveAddedBy(film.addedBy, users || []);
  if (users?.length && addedBy.length >= users.length) return 'everyone flagged it';
  if (film.rating >= 8.5) return `${film.rating.toFixed(1)} rating`;
  if (film.runtime && film.runtime < 100) return `clean ${formatRuntime(film.runtime)}`;
  if (film.director) return film.director;
  if (film.genres?.length) return film.genres[0].toLowerCase();
  return 'also on the list';
}

/* =============================================================================
   Data helpers
   ============================================================================= */

const mkId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function normalizeAddedBy(addedBy) {
  if (Array.isArray(addedBy)) return addedBy.filter(Boolean);
  if (addedBy === 'Both')    return null; // sentinel — resolved at call site with USERS
  if (typeof addedBy === 'string' && addedBy) return [addedBy];
  return [];
}

function resolveAddedBy(addedBy, users) {
  const norm = normalizeAddedBy(addedBy);
  if (norm === null) return [...users];
  return norm;
}

function matchesFilm(a, b) {
  if (a?.tmdbId && b?.tmdbId) return a.tmdbId === b.tmdbId;
  if (a?.imdbId && b?.imdbId) return a.imdbId === b.imdbId;
  return a?.title === b?.title && a?.year === b?.year;
}

// Migrate older stored films:
//   imdbRating → rating; addedBy string → array; userRating (single) → userRatings (per-user map)
function migrateFilm(f, users) {
  if (!f || typeof f !== 'object') return f;
  const out = { ...f };
  if (out.imdbRating !== undefined && out.rating === undefined) out.rating = out.imdbRating;
  if (out.imdbVotes  !== undefined && out.votes  === undefined) out.votes  = out.imdbVotes;
  delete out.imdbRating; delete out.imdbVotes; delete out.imdbDistribution;
  if (out.addedBy && !Array.isArray(out.addedBy)) {
    out.addedBy = out.addedBy === 'Both' ? [...users] : [out.addedBy];
  }
  if (out.userRating !== undefined && !out.userRatings) {
    const watcher = (Array.isArray(out.addedBy) && out.addedBy[0]) || users[0];
    out.userRatings = watcher ? { [watcher]: out.userRating } : {};
    delete out.userRating;
  }
  if (!out.userRatings) out.userRatings = {};
  return out;
}

function formatRuntime(m) {
  if (!m) return '—';
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h ${r}m` : `${r}m`;
}
function formatVotes(v) {
  if (!v) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return Math.round(v / 1e3) + 'K';
  return String(v);
}
function formatBudget(b) {
  if (!b) return null;
  if (b >= 1e9) return '$' + (b / 1e9).toFixed(1) + 'B';
  if (b >= 1e6) return '$' + Math.round(b / 1e6) + 'M';
  if (b >= 1e3) return '$' + Math.round(b / 1e3) + 'K';
  return '$' + b;
}
function tileGradient(title) {
  let h = 0;
  for (let i = 0; i < (title || '').length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  const h2 = (h + 40) % 360;
  return `linear-gradient(135deg, hsl(${h}, 45%, 22%) 0%, hsl(${h2}, 55%, 12%) 100%)`;
}

/* =============================================================================
   Shared styles
   ============================================================================= */

const inputStyle = {
  width: '100%', padding: '11px 13px',
  background: C.surface, border: `1px solid ${C.border}`,
  borderRadius: 3, color: C.text,
  fontFamily: FONT.body, fontSize: 14,
  boxSizing: 'border-box',
};

const primaryButton = (disabled) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  width: '100%', padding: '12px 16px',
  background: disabled ? C.surfaceRaised : C.accent,
  border: 'none', borderRadius: 3,
  color: disabled ? C.textFaint : C.bg,
  fontFamily: FONT.mono, fontSize: 12,
  letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700,
  cursor: disabled ? 'default' : 'pointer',
  transition: 'background 120ms',
});

const secondaryButton = () => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  width: '100%', padding: '10px 16px',
  background: 'transparent', border: `1px solid ${C.border}`,
  borderRadius: 3, color: C.textDim,
  fontFamily: FONT.mono, fontSize: 11,
  letterSpacing: '0.1em', textTransform: 'uppercase',
  cursor: 'pointer',
});

const pillStyle = (active) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 11px',
  background: active ? C.accent : 'transparent',
  border: `1px solid ${active ? C.accent : C.border}`,
  borderRadius: 3,
  color: active ? C.bg : C.textDim,
  fontFamily: FONT.mono, fontSize: 11,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  fontWeight: active ? 700 : 500,
  cursor: 'pointer', transition: 'all 120ms',
});

function Field({ label, children }) {
  return (
    <div>
      <div style={{
        fontFamily: FONT.mono, fontSize: 10, color: C.textFaint,
        letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 7,
      }}>{label}</div>
      {children}
    </div>
  );
}

/* =============================================================================
   UI components
   ============================================================================= */

function AvailabilityPills({ availability }) {
  const streaming = availability?.streaming || [];
  const rental = availability?.rental || [];
  if (!streaming.length && !rental.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {streaming.map(s => (
        <span key={s} style={{
          fontFamily: FONT.mono, fontSize: 9,
          border: `1px solid ${C.accentDim}`, color: C.accent,
          padding: '2px 6px', borderRadius: 2, letterSpacing: '0.03em',
        }}>{s.toUpperCase()}</span>
      ))}
      {rental.map((r, i) => (
        <span key={r.service + i} style={{
          fontFamily: FONT.mono, fontSize: 9,
          border: `1px solid ${C.border}`, color: C.textDim,
          padding: '2px 6px', borderRadius: 2, letterSpacing: '0.03em',
        }}>{r.service.toUpperCase()}</span>
      ))}
    </div>
  );
}

function FlagButtons({ users, flagState, onToggle, size = 'md' }) {
  const small = size === 'sm';
  return (
    <div style={{ display: 'flex', gap: small ? 4 : 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {!small && (
        <span style={{
          fontFamily: FONT.mono, fontSize: 9, color: C.textFaint,
          letterSpacing: '0.15em', marginRight: 4,
        }}>WANT</span>
      )}
      {users.map(u => {
        const active = !!flagState[u];
        return (
          <button
            key={u}
            onClick={e => { e.stopPropagation(); onToggle(u); }}
            title={`${u} wants to watch`}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: small ? 26 : 'auto', height: small ? 26 : 'auto',
              padding: small ? 0 : '6px 12px', gap: 6,
              background: active ? C.accent : 'rgba(14,11,8,0.82)',
              color: active ? C.bg : C.textDim,
              border: `1px solid ${active ? C.accent : C.border}`,
              borderRadius: small ? '50%' : 40,
              fontFamily: FONT.mono, fontSize: 10,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'all 120ms',
            }}
          >
            {small ? (u[0] || '?').toUpperCase() : (
              <>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 14, height: 14, borderRadius: '50%',
                  background: active ? C.bg : 'transparent',
                  border: `1px solid ${active ? C.bg : C.textFaint}`,
                  color: active ? C.accent : C.textFaint,
                  fontSize: 9, fontWeight: 700,
                }}>{(u[0] || '?').toUpperCase()}</span>
                {u}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FilmTile({ film, onClick, flagState, onToggleFlag, users }) {
  const [imgOk, setImgOk] = useState(true);
  const hasPoster = film.posterUrl && imgOk;
  return (
    <div
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick?.(); }}
      style={{
        position: 'relative', background: C.surface,
        border: `1px solid ${C.borderDim}`, borderRadius: 4,
        overflow: 'hidden', cursor: 'pointer',
        transition: 'border-color 160ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.border; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderDim; }}
    >
      <div style={{
        position: 'relative', width: '100%',
        paddingBottom: '150%',
        background: hasPoster ? '#000' : tileGradient(film.title),
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          {hasPoster ? (
            <img src={film.posterUrl} alt={film.title} loading="lazy"
              onError={() => setImgOk(false)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                fontFamily: FONT.display, fontSize: 42, color: 'rgba(239,230,210,0.18)',
                fontWeight: 500, letterSpacing: '-0.02em',
                fontVariationSettings: '"opsz" 144',
              }}>{film.year || '—'}</div>
            </div>
          )}

          {film.rating && (
            <div style={{
              position: 'absolute', top: 7, left: 7,
              background: 'rgba(14,11,8,0.92)',
              WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)',
              padding: '2px 6px', borderRadius: 2,
              border: `1px solid ${C.accentDim}`,
              fontFamily: FONT.display, fontSize: 12, color: C.accent, fontWeight: 600,
              letterSpacing: '-0.01em',
            }}>{film.rating.toFixed(1)}</div>
          )}

          {onToggleFlag && (
            <div style={{ position: 'absolute', top: 6, right: 6 }}>
              <FlagButtons users={users} flagState={flagState} onToggle={onToggleFlag} size="sm" />
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '9px 10px 10px' }}>
        <div style={{
          fontFamily: FONT.display, fontSize: 13, color: C.text,
          fontWeight: 500, lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={film.title}>{film.title}</div>
        {film.director && (
          <div style={{
            fontFamily: FONT.body, fontSize: 11, color: C.textDim, fontStyle: 'italic',
            marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{film.director}</div>
        )}
        <div style={{
          fontFamily: FONT.mono, fontSize: 9, color: C.textFaint,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap',
        }}>
          <span>{film.year || '—'}</span>
          {film.runtime && (<><span style={{ color: C.border }}>·</span><span>{formatRuntime(film.runtime)}</span></>)}
        </div>
        {film.catalysts?.length > 0 && (
          <div style={{
            marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 3,
            overflow: 'hidden', maxHeight: 16,
          }}>
            {film.catalysts.slice(0, 2).map((c, i) => (
              <span key={i} title={`${c.signal}: ${c.feature}`} style={{
                fontFamily: FONT.mono, fontSize: 8,
                color: C.accent, border: `1px solid ${C.accentDim}`,
                padding: '1px 5px', borderRadius: 2, letterSpacing: '0.03em',
                textTransform: 'uppercase',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
              }}>{reasonLabel(c)}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilmCard({ film, onClick, showAvailability = false, rightBadge = null }) {
  return (
    <div
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && onClick) { e.preventDefault(); onClick(); } }}
      style={{
        width: '100%', background: C.surface,
        border: `1px solid ${C.borderDim}`, borderRadius: 4,
        padding: '16px 16px 14px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 120ms', boxSizing: 'border-box',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.border; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderDim; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.display, fontWeight: 500, fontSize: 19,
            color: C.text, lineHeight: 1.15, letterSpacing: '-0.01em',
            fontVariationSettings: '"opsz" 72',
          }}>{film.title}</div>
          <div style={{
            fontFamily: FONT.mono, fontSize: 10, color: C.textDim,
            letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 5,
          }}>
            {film.director || '—'} · {film.year || '—'} · {formatRuntime(film.runtime)}
          </div>
        </div>
        {rightBadge}
      </div>

      {(film.genres?.length || film.rating) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12, gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
            {(film.genres || []).slice(0, 3).map((g, i, a) => (
              <span key={g} style={{ fontFamily: FONT.body, fontSize: 11, color: C.textDim, fontStyle: 'italic' }}>
                {g}{i < a.length - 1 ? ' ·' : ''}
              </span>
            ))}
          </div>
          {film.rating && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{
                fontFamily: FONT.display, fontSize: 20, color: C.accent,
                lineHeight: 1, fontWeight: 500, fontVariationSettings: '"opsz" 72',
              }}>{film.rating.toFixed(1)}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, letterSpacing: '0.08em', marginTop: 2 }}>
                {formatVotes(film.votes)} VOTES
              </div>
            </div>
          )}
        </div>
      )}

      {showAvailability && film.availability && (
        <div style={{ marginTop: 10 }}>
          <AvailabilityPills availability={film.availability} />
        </div>
      )}

      {film.why && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderDim}`,
          fontFamily: FONT.body, fontSize: 12, fontStyle: 'italic',
          color: C.textDim, lineHeight: 1.5,
        }}>{film.why}</div>
      )}
    </div>
  );
}

function Sheet({ children, onClose, title, subtitle }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      animation: 'fadeIn 160ms ease-out',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto',
        background: C.bg,
        borderTop: `1px solid ${C.border}`,
        borderLeft: `1px solid ${C.border}`,
        borderRight: `1px solid ${C.border}`,
        borderTopLeftRadius: 8, borderTopRightRadius: 8,
        animation: 'slideUp 220ms cubic-bezier(0.2,0.8,0.2,1)',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          padding: '20px 20px 16px', borderBottom: `1px solid ${C.borderDim}`,
          position: 'sticky', top: 0, background: C.bg, zIndex: 1,
        }}>
          <div>
            {subtitle && (
              <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.accent, letterSpacing: '0.15em', marginBottom: 4 }}>
                {subtitle.toUpperCase()}
              </div>
            )}
            <div style={{
              fontFamily: FONT.display, fontSize: 22, color: C.text,
              fontWeight: 500, letterSpacing: '-0.01em',
              fontVariationSettings: '"opsz" 72',
            }}>{title}</div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: C.textDim,
            cursor: 'pointer', padding: 6, marginTop: -4, marginRight: -6,
          }}><X size={20} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

/* =============================================================================
   Filter bar + filters / services sheets
   ============================================================================= */

function countActiveFilters(f) {
  let n = 0;
  if (f.genres.length) n++;
  if (f.yearMin !== DEFAULT_FILTERS.yearMin || f.yearMax !== DEFAULT_FILTERS.yearMax) n++;
  if (f.ratingMin !== DEFAULT_FILTERS.ratingMin) n++;
  if (f.votesMin !== DEFAULT_FILTERS.votesMin) n++;
  if (f.runtimeMax) n++;
  if (f.budgetTier) n++;
  if (f.reception) n++;
  if (f.includeRentals) n++;
  return n;
}

function Chip({ children, onRemove }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 4px 4px 8px',
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 2, color: C.textDim,
      fontFamily: FONT.mono, fontSize: 9,
      letterSpacing: '0.08em', textTransform: 'uppercase',
    }}>
      {children}
      <button onClick={onRemove} style={{
        background: 'transparent', border: 'none', color: C.textFaint,
        cursor: 'pointer', padding: 0, marginLeft: 2,
        display: 'inline-flex', alignItems: 'center',
      }}><X size={10} /></button>
    </span>
  );
}

function FilterBar({ filters, setFilters, services, onOpenServices, onOpenAdvanced, onApply, loading }) {
  const activeCount = countActiveFilters(filters);
  return (
    <div style={{
      padding: '14px 20px 12px',
      borderBottom: `1px solid ${C.borderDim}`,
      background: C.bg,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={13} style={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)', color: C.textFaint,
          }} />
          <input
            type="text"
            placeholder="Mood, vibe, reference..."
            value={filters.mood}
            onChange={e => setFilters({ ...filters, mood: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && !loading) onApply(); }}
            style={{ ...inputStyle, padding: '10px 12px 10px 32px', fontSize: 13 }}
          />
        </div>
        <button onClick={onOpenAdvanced} style={{
          padding: '10px 12px',
          background: activeCount > 0 ? C.accent : C.surface,
          color: activeCount > 0 ? C.bg : C.textDim,
          border: `1px solid ${activeCount > 0 ? C.accent : C.border}`,
          borderRadius: 3, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: FONT.mono, fontSize: 11, letterSpacing: '0.1em',
        }}>
          <SlidersHorizontal size={13} />
          {activeCount > 0 && <span style={{ fontWeight: 700 }}>{activeCount}</span>}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' }}>
        <button onClick={onOpenServices} style={{
          padding: '4px 8px', background: 'transparent',
          border: `1px solid ${C.accentDim}`, borderRadius: 2, color: C.accent,
          fontFamily: FONT.mono, fontSize: 9,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <Tv size={10} /> {services.length} SERVICES
        </button>
        {filters.genres.map(g => (
          <Chip key={g} onRemove={() => setFilters({ ...filters, genres: filters.genres.filter(x => x !== g) })}>{g}</Chip>
        ))}
        {(filters.yearMin !== DEFAULT_FILTERS.yearMin || filters.yearMax !== DEFAULT_FILTERS.yearMax) && (
          <Chip onRemove={() => setFilters({ ...filters, yearMin: DEFAULT_FILTERS.yearMin, yearMax: DEFAULT_FILTERS.yearMax })}>
            {filters.yearMin}–{filters.yearMax}
          </Chip>
        )}
        {filters.ratingMin !== DEFAULT_FILTERS.ratingMin && (
          <Chip onRemove={() => setFilters({ ...filters, ratingMin: DEFAULT_FILTERS.ratingMin })}>
            RATING {filters.ratingMin.toFixed(1)}+
          </Chip>
        )}
        {filters.votesMin !== DEFAULT_FILTERS.votesMin && (
          <Chip onRemove={() => setFilters({ ...filters, votesMin: DEFAULT_FILTERS.votesMin })}>
            {formatVotes(filters.votesMin)}+ votes
          </Chip>
        )}
        {filters.runtimeMax && (
          <Chip onRemove={() => setFilters({ ...filters, runtimeMax: null })}>
            &lt; {filters.runtimeMax}min
          </Chip>
        )}
        {filters.budgetTier && (
          <Chip onRemove={() => setFilters({ ...filters, budgetTier: null })}>
            {BUDGET_TIERS.find(b => b.id === filters.budgetTier)?.label}
          </Chip>
        )}
        {filters.reception && (
          <Chip onRemove={() => setFilters({ ...filters, reception: null })}>
            {RECEPTION_OPTIONS.find(r => r.id === filters.reception)?.label}
          </Chip>
        )}
        {filters.includeRentals && (
          <Chip onRemove={() => setFilters({ ...filters, includeRentals: false })}>+rentals</Chip>
        )}
      </div>

      <button
        onClick={onApply} disabled={loading}
        style={{
          marginTop: 10, width: '100%', padding: '10px 14px',
          background: loading ? C.surfaceRaised : C.accent,
          color: loading ? C.textFaint : C.bg,
          border: 'none', borderRadius: 3,
          fontFamily: FONT.mono, fontSize: 11,
          letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 700,
          cursor: loading ? 'default' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        {loading ? <><Loader2 size={13} className="spin" /> Searching</> : <><Sparkles size={13} /> Find films</>}
      </button>
    </div>
  );
}

function RangeInput({ label, value, min, max, onChange }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, marginBottom: 4, letterSpacing: '0.1em' }}>
        {label.toUpperCase()}
      </div>
      <input type="number" min={min} max={max} value={value}
        onChange={e => onChange(parseInt(e.target.value) || min)}
        style={{
          width: '100%', padding: '8px 10px',
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 3, color: C.text,
          fontFamily: FONT.mono, fontSize: 13, boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function FiltersSheet({ filters, setFilters, onClose }) {
  const [local, setLocal] = useState(filters);
  const commit = () => { setFilters(local); onClose(); };
  return (
    <Sheet onClose={commit} title="Filters" subtitle="Refine the programme">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Field label="Genres">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {GENRE_OPTIONS.map(g => {
              const on = local.genres.includes(g);
              return (
                <button key={g} onClick={() => setLocal({
                  ...local,
                  genres: on ? local.genres.filter(x => x !== g) : [...local.genres, g],
                })} style={pillStyle(on)}>{g}</button>
              );
            })}
          </div>
        </Field>

        <Field label={`Year: ${local.yearMin}–${local.yearMax}`}>
          <div style={{ display: 'flex', gap: 14 }}>
            <RangeInput label="From" value={local.yearMin} min={1920} max={currentYear}
              onChange={v => setLocal({ ...local, yearMin: Math.min(v, local.yearMax) })} />
            <RangeInput label="To" value={local.yearMax} min={1920} max={currentYear}
              onChange={v => setLocal({ ...local, yearMax: Math.max(v, local.yearMin) })} />
          </div>
        </Field>

        <Field label={`Rating: ${local.ratingMin.toFixed(1)}+`}>
          <input type="range" min="5" max="9" step="0.1"
            value={local.ratingMin}
            onChange={e => setLocal({ ...local, ratingMin: parseFloat(e.target.value) })}
            style={{ width: '100%', accentColor: C.accent }}
          />
        </Field>

        <Field label={`Vote count: ${formatVotes(local.votesMin)}+`}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[100, 1000, 10000, 50000, 100000, 500000].map(v => (
              <button key={v} onClick={() => setLocal({ ...local, votesMin: v })}
                style={pillStyle(local.votesMin === v)}>{formatVotes(v)}+</button>
            ))}
          </div>
        </Field>

        <Field label={`Runtime${local.runtimeMax ? ': under ' + local.runtimeMax + ' min' : ': any'}`}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[null, 90, 105, 120, 150, 180].map(v => (
              <button key={String(v)} onClick={() => setLocal({ ...local, runtimeMax: v })}
                style={pillStyle(local.runtimeMax === v)}>
                {v === null ? 'Any' : `< ${v}m`}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Budget">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => setLocal({ ...local, budgetTier: null })}
              style={{ ...pillStyle(!local.budgetTier), justifyContent: 'flex-start', width: '100%' }}>
              All budgets
            </button>
            {BUDGET_TIERS.map(b => (
              <button key={b.id} onClick={() => setLocal({ ...local, budgetTier: b.id })}
                style={{ ...pillStyle(local.budgetTier === b.id), justifyContent: 'space-between', width: '100%' }}>
                <span>{b.label}</span>
                <span style={{ opacity: 0.6 }}>{b.range}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Reception">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => setLocal({ ...local, reception: null })}
              style={{ ...pillStyle(!local.reception), justifyContent: 'flex-start', width: '100%' }}>
              Any reception
            </button>
            {RECEPTION_OPTIONS.map(r => (
              <button key={r.id} onClick={() => setLocal({ ...local, reception: r.id })}
                style={{ ...pillStyle(local.reception === r.id), justifyContent: 'space-between', width: '100%' }}>
                <span>{r.label}</span>
                <span style={{ opacity: 0.6 }}>{r.sub}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Include rentals / purchases">
          <button onClick={() => setLocal({ ...local, includeRentals: !local.includeRentals })} style={{
            ...pillStyle(local.includeRentals), width: '100%', justifyContent: 'space-between',
          }}>
            <span>{local.includeRentals ? 'Including new releases for rent' : 'Streaming subscriptions only'}</span>
            <span>{local.includeRentals ? 'ON' : 'OFF'}</span>
          </button>
        </Field>

        <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
          <button onClick={() => setLocal(DEFAULT_FILTERS)} style={secondaryButton()}>Reset</button>
          <button onClick={commit} style={primaryButton(false)}>Apply</button>
        </div>
      </div>
    </Sheet>
  );
}

function ServicesSheet({ services, setServices, onClose }) {
  const [local, setLocal] = useState(services);
  const [custom, setCustom] = useState('');
  const toggle = s => setLocal(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  const addCustom = () => {
    const v = custom.trim();
    if (v && !local.includes(v)) setLocal([...local, v]);
    setCustom('');
  };
  const commit = () => { setServices(local); onClose(); };
  const all = [...new Set([...DEFAULT_SERVICES, ...local])];

  return (
    <Sheet onClose={commit} title="My services" subtitle="Streaming subscriptions">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontFamily: FONT.body, fontSize: 13, color: C.textDim, lineHeight: 1.5 }}>
          Only films on these services will be suggested (unless rentals are on).
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {all.map(s => (
            <button key={s} onClick={() => toggle(s)} style={pillStyle(local.includes(s))}>{s}</button>
          ))}
        </div>
        <div>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 7 }}>
            ADD OTHER
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={custom} onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCustom(); }}
              placeholder="e.g. Criterion Channel"
              style={{ ...inputStyle, fontSize: 13 }}
            />
            <button onClick={addCustom} disabled={!custom.trim()} style={{
              padding: '0 14px',
              background: custom.trim() ? C.accent : C.surfaceRaised,
              border: 'none', borderRadius: 3,
              color: custom.trim() ? C.bg : C.textFaint,
              fontFamily: FONT.mono, fontSize: 11,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              cursor: custom.trim() ? 'pointer' : 'default',
            }}><Plus size={14} /></button>
          </div>
        </div>
        <button onClick={commit} style={primaryButton(false)}>
          Save ({local.length} active)
        </button>
      </div>
    </Sheet>
  );
}

/* =============================================================================
   DiscoverView
   ============================================================================= */

function DiscoverView({ tmdb, filters, setFilters, services, setServices, discover, setDiscover,
                        users, onOpenFilm, getFlagState, onToggleFlag }) {
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [autoTried, setAutoTried] = useState(false);
  const abortRef = useRef(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true); setError('');
    try {
      const { films, page, totalPages } = await generateDiscover(tmdb, { filters, services, page: 1, signal: ac.signal });
      if (ac.signal.aborted) return;
      if (!films.length) {
        setError('No films match these filters. Try broadening.');
        setDiscover({ films: [], page: 1, totalPages: 1, generatedAt: Date.now() });
      } else {
        const withIds = films.map(f => ({ ...f, id: mkId(), source: 'suggestion' }));
        setDiscover({ films: withIds, page, totalPages, generatedAt: Date.now() });
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('Discover failed:', e);
      setError(e.message || 'Something went wrong');
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [tmdb, filters, services, setDiscover]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    const curPage = discover?.page || 1;
    const totalPages = discover?.totalPages || 1;
    if (curPage >= totalPages) return;

    const ac = new AbortController();
    setLoadingMore(true);
    try {
      const { films, page, totalPages: tp } = await generateDiscover(tmdb, {
        filters, services, page: curPage + 1, signal: ac.signal,
      });
      const withIds = films.map(f => ({ ...f, id: mkId(), source: 'suggestion' }));
      setDiscover(prev => {
        if (!prev) return prev;
        const seen = new Set(prev.films.map(f => f.tmdbId || `${f.title}::${f.year}`));
        const fresh = withIds.filter(f => !seen.has(f.tmdbId || `${f.title}::${f.year}`));
        return { ...prev, films: [...prev.films, ...fresh], page, totalPages: tp };
      });
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('loadMore failed:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, discover, tmdb, filters, services, setDiscover]);

  useEffect(() => {
    if (autoTried || discover?.films?.length) return;
    setAutoTried(true);
    run();
  }, [autoTried, discover, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !discover?.films?.length) return;
    const curPage = discover?.page || 1;
    const totalPages = discover?.totalPages || 1;
    if (curPage >= totalPages) return;

    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [discover?.films?.length, discover?.page, discover?.totalPages, loadMore]);

  const films = discover?.films || [];
  const hasMore = (discover?.page || 1) < (discover?.totalPages || 1);

  return (
    <div>
      <FilterBar
        filters={filters} setFilters={setFilters}
        services={services}
        onOpenServices={() => setServicesOpen(true)}
        onOpenAdvanced={() => setFiltersOpen(true)}
        onApply={run} loading={loading}
      />

      {error && (
        <div style={{
          margin: '16px 20px', padding: '16px',
          background: C.surface, border: `1px solid ${C.red}`, borderRadius: 4,
        }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 10, color: C.red,
            letterSpacing: '0.15em', marginBottom: 8,
          }}>SEARCH FAILED</div>
          <div style={{
            fontFamily: FONT.body, fontSize: 14, color: C.text,
            lineHeight: 1.5, marginBottom: 14,
          }}>{error}</div>
          <button onClick={run} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '9px 14px',
            background: C.accent, border: 'none', borderRadius: 3,
            color: C.bg, fontFamily: FONT.mono, fontSize: 11,
            letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700,
            cursor: 'pointer',
          }}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {loading && !films.length && (
        <div style={{ padding: '90px 20px', textAlign: 'center' }}>
          <Loader2 size={22} className="spin" style={{ color: C.accent, margin: '0 auto 14px' }} />
          <div style={{
            fontFamily: FONT.mono, fontSize: 11, color: C.textDim,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>Searching catalog</div>
        </div>
      )}

      {!films.length && !loading && !error && (
        <div style={{
          padding: '70px 30px', textAlign: 'center',
          fontFamily: FONT.body, fontSize: 14, color: C.textFaint,
          fontStyle: 'italic', lineHeight: 1.6,
        }}>
          Set your filters, then hit <span style={{ color: C.accent, fontStyle: 'normal' }}>Find films</span>.
        </div>
      )}

      {films.length > 0 && (
        <>
          <div style={{
            padding: '14px 20px 8px',
            fontFamily: FONT.mono, fontSize: 10, color: C.textFaint,
            letterSpacing: '0.12em', display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{films.length} FILMS{hasMore ? '+' : ''}</span>
            {discover?.generatedAt && (
              <span>{new Date(discover.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            )}
          </div>
          <div style={{
            padding: '6px 12px 24px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))',
            gap: 10,
          }}>
            {films.map(f => (
              <FilmTile key={f.id} film={f} users={users}
                onClick={() => onOpenFilm(f)}
                flagState={getFlagState(f)}
                onToggleFlag={u => onToggleFlag(f, u)}
              />
            ))}
          </div>

          {hasMore && (
            <div ref={sentinelRef} style={{
              padding: '20px', textAlign: 'center',
              fontFamily: FONT.mono, fontSize: 10, color: C.textFaint,
              letterSpacing: '0.15em', textTransform: 'uppercase',
            }}>
              {loadingMore ? (
                <><Loader2 size={14} className="spin" style={{ verticalAlign: 'middle', marginRight: 6, color: C.accent }} /> Loading more</>
              ) : (
                <span style={{ opacity: 0.5 }}>Scroll for more</span>
              )}
            </div>
          )}
          {!hasMore && films.length > 20 && (
            <div style={{
              padding: '20px 20px 40px', textAlign: 'center',
              fontFamily: FONT.mono, fontSize: 10, color: C.textFaint,
              letterSpacing: '0.15em', textTransform: 'uppercase', opacity: 0.5,
            }}>End of catalog</div>
          )}
        </>
      )}

      {filtersOpen && (
        <FiltersSheet filters={filters} setFilters={setFilters} onClose={() => setFiltersOpen(false)} />
      )}
      {servicesOpen && (
        <ServicesSheet services={services} setServices={setServices} onClose={() => setServicesOpen(false)} />
      )}
    </div>
  );
}

/* =============================================================================
   ForYouView — internal-scoring recommendations with catalyst transparency
   ============================================================================= */

// Fetch a broad candidate pool from TMDB discover, biased toward the profile's
// top genres. The ranking is entirely local via scoreFilm().
async function fetchCandidatePool(tmdb, profile, services, { signal }) {
  const genreIds = topFeatures(profile.genre, 4)
    .map(g => TMDB_GENRE_IDS[g.feature]).filter(Boolean).join(',');
  const providerIds = (services || DEFAULT_SERVICES)
    .map(s => PROVIDER_IDS[s]).filter(Boolean).join('|');

  const baseParams = {
    language: 'en-US', region: 'US',
    sort_by: 'vote_count.desc',
    include_adult: 'false', include_video: 'false',
    'vote_count.gte': 500,
    'vote_average.gte': 6.0,
    watch_region: 'US',
    with_watch_monetization_types: 'flatrate',
  };
  if (genreIds)    baseParams.with_genres = genreIds;
  if (providerIds) baseParams.with_watch_providers = providerIds;

  const pages = [1, 2, 3];
  const results = [];
  for (const page of pages) {
    const data = await tmdb.discover({ ...baseParams, page }, { signal });
    for (const r of data.results || []) results.push(tmdbResultToFilm(r));
    if (data.total_pages && page >= data.total_pages) break;
  }
  return results;
}

function ForYouView({ tmdb, profile, services, seen, watchlist, users, onOpenFilm, getFlagState, onToggleFlag }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState([]);
  const abortRef = useRef(null);

  const excludeIds = useMemo(() => {
    const s = new Set();
    for (const f of [...seen, ...watchlist]) if (f.tmdbId) s.add(f.tmdbId);
    return s;
  }, [seen, watchlist]);

  const run = useCallback(async () => {
    if (!profile) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true); setError('');
    try {
      const pool = await fetchCandidatePool(tmdb, profile, services, { signal: ac.signal });
      if (ac.signal.aborted) return;

      // Dedupe + filter seen/watchlist, then score
      const unique = new Map();
      for (const f of pool) {
        if (!f.tmdbId || excludeIds.has(f.tmdbId)) continue;
        if (!unique.has(f.tmdbId)) unique.set(f.tmdbId, f);
      }
      const scored = [];
      for (const f of unique.values()) {
        const { score, reasons } = scoreFilm(f, profile);
        if (score > 0) scored.push({ ...f, id: mkId(), source: 'foryou', _score: score, catalysts: reasons });
      }
      scored.sort((a, b) => b._score - a._score);
      setCandidates(scored.slice(0, 36));
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'Failed to build recommendations');
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [tmdb, profile, services, excludeIds]);

  useEffect(() => { run(); return () => abortRef.current?.abort(); }, [run]);

  if (!profile) {
    return (
      <div style={{ padding: '60px 30px', textAlign: 'center' }}>
        <div style={{
          fontFamily: FONT.display, fontSize: 22, color: C.text,
          fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 8,
        }}>No profile yet</div>
        <div style={{
          fontFamily: FONT.body, fontSize: 14, color: C.textFaint,
          fontStyle: 'italic', lineHeight: 1.6, maxWidth: 340, margin: '0 auto',
        }}>
          Rate a few seen films and this view fills with picks tuned to what you've actually enjoyed.
        </div>
      </div>
    );
  }

  const topG = topFeatures(profile.genre, 3);
  const topD = topFeatures(profile.director, 3);
  const topDec = topFeatures(profile.decade, 2);

  return (
    <div>
      {/* Profile panel — explains what drives the picks */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${C.borderDim}`,
        background: C.bg,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8,
        }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.accent, letterSpacing: '0.2em' }}>
            <TrendingUp size={11} style={{ verticalAlign: 'middle', marginRight: 5 }} />
            YOUR PROFILE
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.1em' }}>
            {profile._count} RATINGS
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {topG.map(x => (
            <span key={x.feature} style={{
              fontFamily: FONT.mono, fontSize: 10, color: C.accent,
              border: `1px solid ${C.accentDim}`, padding: '3px 8px', borderRadius: 2,
              letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>{x.feature}</span>
          ))}
          {topD.map(x => (
            <span key={x.feature} style={{
              fontFamily: FONT.body, fontSize: 11, color: C.text,
              border: `1px solid ${C.border}`, padding: '3px 8px', borderRadius: 2,
              fontStyle: 'italic',
            }}>{x.feature}</span>
          ))}
          {topDec.map(x => (
            <span key={x.feature} style={{
              fontFamily: FONT.mono, fontSize: 10, color: C.textDim,
              border: `1px solid ${C.border}`, padding: '3px 8px', borderRadius: 2,
              letterSpacing: '0.05em',
            }}>{x.feature}</span>
          ))}
          {profile.runtime && (
            <span style={{
              fontFamily: FONT.mono, fontSize: 10, color: C.textDim,
              border: `1px solid ${C.border}`, padding: '3px 8px', borderRadius: 2,
              letterSpacing: '0.05em',
            }}>~{Math.round(profile.runtime.mean)}min</span>
          )}
        </div>
        <button onClick={run} disabled={loading} style={{
          marginTop: 12,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 12px',
          background: 'transparent', border: `1px solid ${C.border}`,
          borderRadius: 3, color: C.textDim,
          fontFamily: FONT.mono, fontSize: 10,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          cursor: loading ? 'default' : 'pointer',
        }}>
          <RefreshCw size={10} className={loading ? 'spin' : ''} /> Refresh picks
        </button>
      </div>

      {error && (
        <div style={{
          margin: '16px 20px', padding: 14,
          border: `1px solid ${C.red}`, borderRadius: 4,
          fontFamily: FONT.mono, fontSize: 11, color: C.red,
        }}>{error}</div>
      )}

      {loading && !candidates.length && (
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <Loader2 size={22} className="spin" style={{ color: C.accent, margin: '0 auto 14px' }} />
          <div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textDim, letterSpacing: '0.12em' }}>
            Scoring candidates
          </div>
        </div>
      )}

      {!loading && !candidates.length && !error && (
        <div style={{
          padding: '60px 30px', textAlign: 'center',
          fontFamily: FONT.body, fontSize: 14, color: C.textFaint, fontStyle: 'italic',
        }}>
          No fresh picks right now. Rate more films or broaden your services.
        </div>
      )}

      {candidates.length > 0 && (
        <div style={{
          padding: '14px 12px 24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))',
          gap: 10,
        }}>
          {candidates.map(f => (
            <FilmTile key={f.id} film={f} users={users}
              onClick={() => onOpenFilm(f)}
              flagState={getFlagState(f)}
              onToggleFlag={u => onToggleFlag(f, u)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   FilmDetailSheet — auto-enriches on open when missing fields
   ============================================================================= */

function FilmDetailSheet({ tmdb, film, onClose, onWatched, onDelete, onUnwatch, canAdd, flagState, onToggleFlag, users, onEnriched, onRerate }) {
  const [enriched, setEnriched] = useState(film);
  const [enriching, setEnriching] = useState(false);
  const [userRatings, setUserRatings] = useState(() => ({ ...(film.userRatings || {}) }));
  const [notes, setNotes] = useState(film.notes || '');
  const [markMode, setMarkMode] = useState(false);

  useEffect(() => { setEnriched(film); }, [film?.id, film?.tmdbId]);

  useEffect(() => {
    const hasDetail = enriched?.runtime && enriched?.director && enriched?.availability;
    if (hasDetail) return;

    const ac = new AbortController();
    setEnriching(true);
    (async () => {
      try {
        let meta;
        if (enriched.tmdbId) {
          const details = await tmdb.getDetails(enriched.tmdbId, { signal: ac.signal });
          meta = detailsToFilmMeta(details);
        } else if (enriched.title) {
          meta = await searchAndEnrich(tmdb, enriched.title, enriched.year, { signal: ac.signal });
        } else {
          return;
        }
        if (ac.signal.aborted) return;
        const merged = { ...enriched };
        for (const k of Object.keys(meta)) {
          if (merged[k] == null || merged[k] === '') merged[k] = meta[k];
        }
        setEnriched(merged);
        onEnriched?.(merged);
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('enrich detail:', e.message);
      } finally {
        if (!ac.signal.aborted) setEnriching(false);
      }
    })();
    return () => ac.abort();
  }, [enriched?.tmdbId, enriched?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = enriched;
  const subtitleText = f.watched ? 'Seen' : canAdd ? 'Candidate' : 'On programme';

  return (
    <Sheet onClose={onClose} title={f.title} subtitle={subtitleText}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {f.posterUrl && (
          <div style={{
            width: '100%', paddingBottom: '56.25%',
            backgroundImage: `linear-gradient(to top, rgba(14,11,8,0.85), transparent), url(${f.posterUrl})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
            borderRadius: 4, border: `1px solid ${C.borderDim}`,
          }} />
        )}

        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textDim, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {f.director || (enriching ? '…' : '—')} · {f.year || '—'} · {formatRuntime(f.runtime)}
          {f.budget ? <> · <span style={{ color: C.textFaint }}>Budget</span> {formatBudget(f.budget)}</> : null}
        </div>

        {f.synopsis && (
          <div style={{ fontFamily: FONT.body, fontSize: 15, color: C.text, lineHeight: 1.55, fontStyle: 'italic' }}>
            {f.synopsis}
          </div>
        )}

        {f.genres?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {f.genres.map(g => (
              <span key={g} style={{
                fontFamily: FONT.mono, fontSize: 10, color: C.textDim,
                border: `1px solid ${C.border}`, padding: '3px 7px', borderRadius: 2,
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>{g}</span>
            ))}
          </div>
        )}

        {f.rating && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.borderDim}`, borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em' }}>TMDB RATING</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{
                  fontFamily: FONT.display, fontSize: 30, color: C.accent,
                  fontWeight: 500, lineHeight: 1, fontVariationSettings: '"opsz" 72',
                }}>{f.rating.toFixed(1)}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.08em' }}>
                  {formatVotes(f.votes)} VOTES
                </span>
              </div>
            </div>
          </div>
        )}

        {f.availability && (f.availability.streaming?.length || f.availability.rental?.length) && (
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 8 }}>
              WHERE TO WATCH
            </div>
            <AvailabilityPills availability={f.availability} />
          </div>
        )}

        {f.why && (
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 7 }}>
              {f.source === 'suggestion' ? 'WHY SUGGESTED' : 'WHY ADDED'}
            </div>
            <div style={{ fontFamily: FONT.body, fontSize: 14, color: C.textDim, lineHeight: 1.55, fontStyle: 'italic' }}>
              {f.why}
            </div>
          </div>
        )}

        {(() => {
          const resolved = resolveAddedBy(f.addedBy, users);
          if (!resolved.length) return null;
          return (
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.1em' }}>
              ADDED BY {resolved.join(', ').toUpperCase()}
              {f.addedAt ? ` · ${new Date(f.addedAt).toLocaleDateString()}` : ''}
            </div>
          );
        })()}

        {f.watched && Object.keys(f.userRatings || {}).length > 0 && !markMode && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.borderDim}`, borderRadius: 4 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 10,
            }}>
              <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em' }}>
                YOUR RATINGS
              </div>
              {onRerate && (
                <button onClick={() => setMarkMode(true)} style={{
                  background: 'transparent', border: 'none', color: C.textDim,
                  fontFamily: FONT.mono, fontSize: 10, letterSpacing: '0.08em',
                  cursor: 'pointer', padding: 0,
                }}>EDIT</button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {users.map(u => {
                const r = (f.userRatings || {})[u];
                return (
                  <div key={u} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textDim, letterSpacing: '0.08em' }}>
                      {u.toUpperCase()}
                    </span>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {typeof r === 'number' ? [1,2,3,4,5].map(n => (
                        <Star key={n} size={14} fill={n <= r ? C.accent : 'transparent'} color={C.accent} />
                      )) : (
                        <span style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint }}>—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {f.notes && (
              <div style={{
                marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderDim}`,
                fontFamily: FONT.body, fontSize: 13, color: C.textDim, fontStyle: 'italic',
              }}>{f.notes}</div>
            )}
          </div>
        )}

        {canAdd && onToggleFlag && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 10 }}>
              ADD TO PROGRAMME
            </div>
            <FlagButtons users={users} flagState={flagState || {}} onToggle={onToggleFlag} />
          </div>
        )}

        {!f.watched && !canAdd && !markMode && (
          <button onClick={() => setMarkMode(true)} style={primaryButton(false)}>
            <Check size={16} /> Mark as watched
          </button>
        )}

        {markMode && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 10 }}>
              RATE IT · PER VIEWER
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {users.map(u => {
                const r = userRatings[u] || 0;
                return (
                  <div key={u} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{
                      fontFamily: FONT.mono, fontSize: 11, color: C.textDim,
                      letterSpacing: '0.08em', minWidth: 60,
                    }}>{u.toUpperCase()}</span>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      {[1,2,3,4,5].map(n => (
                        <button key={n} onClick={() => setUserRatings(prev => ({
                          ...prev,
                          [u]: prev[u] === n ? undefined : n,
                        }))} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                          <Star size={20} fill={n <= r ? C.accent : 'transparent'} color={C.accent} />
                        </button>
                      ))}
                      <button onClick={() => setUserRatings(prev => {
                        const { [u]: _, ...rest } = prev; return rest;
                      })} title="Didn't see it" style={{
                        marginLeft: 6, background: 'transparent', border: 'none',
                        color: C.textFaint, cursor: 'pointer',
                        fontFamily: FONT.mono, fontSize: 10, letterSpacing: '0.05em',
                      }}>skip</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="A line on what landed or didn't (optional)"
              rows={2}
              style={{ ...inputStyle, background: C.bg, resize: 'vertical', marginBottom: 10, fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              {f.watched && (
                <button onClick={() => setMarkMode(false)} style={secondaryButton()}>Cancel</button>
              )}
              <button
                onClick={() => {
                  const cleaned = Object.fromEntries(
                    Object.entries(userRatings).filter(([, v]) => typeof v === 'number')
                  );
                  if (f.watched && onRerate) onRerate({ userRatings: cleaned, notes });
                  else onWatched?.({ userRatings: cleaned, notes });
                  setMarkMode(false);
                }}
                style={primaryButton(false)}
              >Save</button>
            </div>
          </div>
        )}

        {f.watched && onUnwatch && (
          <button onClick={onUnwatch} style={secondaryButton()}>
            <RefreshCw size={13} /> Move back to programme
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} style={{ ...secondaryButton(), color: C.red, borderColor: 'transparent' }}>
            <Trash2 size={13} /> Remove
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* =============================================================================
   Tonight picker sheet
   ============================================================================= */

function TonightPicker({ watchlist, users, profile, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const timeCtx = useMemo(() => tonightTimeContext(), []);

  async function go() {
    if (!prompt.trim()) return;
    setLoading(true); setError('');
    try { setResult(pickForTonight({ watchlist, prompt: prompt.trim(), users, profile, timeCtx })); }
    catch (e) { setError(e.message || ''); }
    setLoading(false);
  }

  const pick = result && watchlist.find(f => f.title === result.pickTitle);

  return (
    <Sheet onClose={onClose} title="Tonight" subtitle="Pick from programme">
      {!result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            display: 'inline-flex', alignSelf: 'flex-start', gap: 6, alignItems: 'center',
            padding: '5px 10px',
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 3,
            fontFamily: FONT.mono, fontSize: 10, color: C.textDim, letterSpacing: '0.08em',
          }}>
            <Clock size={11} /> {timeCtx.label}
          </div>
          <div style={{ fontFamily: FONT.body, fontSize: 14, color: C.textDim, lineHeight: 1.5 }}>
            Say what you want — mood, energy, time you have.
          </div>
          <textarea autoFocus value={prompt} onChange={e => setPrompt(e.target.value)}
            placeholder="e.g. 2 hours, something slow and strange"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
            disabled={loading}
          />
          {error && <div style={{ color: C.red, fontFamily: FONT.mono, fontSize: 11 }}>{error}</div>}
          <button onClick={go} disabled={loading || !prompt.trim()} style={primaryButton(loading || !prompt.trim())}>
            {loading ? <><Loader2 size={16} className="spin" /> Thinking</> : <><Sparkles size={16} /> Pick</>}
          </button>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, textAlign: 'center', letterSpacing: '0.05em' }}>
            {watchlist.length} film{watchlist.length === 1 ? '' : 's'} on programme
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {pick ? (
            <>
              <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.accent, letterSpacing: '0.2em' }}>
                TONIGHT'S FEATURE
              </div>
              <div style={{
                fontFamily: FONT.display, fontSize: 30, color: C.text,
                fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.01em',
                fontVariationSettings: '"opsz" 72',
              }}>{pick.title}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {pick.director || '—'} · {pick.year || '—'} · {formatRuntime(pick.runtime)}
              </div>
              <div style={{
                fontFamily: FONT.body, fontSize: 15, color: C.text,
                lineHeight: 1.6, borderLeft: `2px solid ${C.accent}`, paddingLeft: 14,
              }}>{result.rationale}</div>
              {pick.availability && <AvailabilityPills availability={pick.availability} />}
            </>
          ) : <div style={{ color: C.textDim }}>Pick not found in your list.</div>}

          {result.alternates?.length > 0 && (
            <div>
              <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 8 }}>OR</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.alternates.map((a, i) => (
                  <div key={i} style={{
                    padding: '10px 12px', background: C.surface,
                    border: `1px solid ${C.borderDim}`, borderRadius: 3,
                  }}>
                    <div style={{ fontFamily: FONT.display, fontSize: 16, color: C.text, fontWeight: 500 }}>{a.title}</div>
                    <div style={{ fontFamily: FONT.body, fontSize: 12, color: C.textDim, fontStyle: 'italic', marginTop: 2 }}>{a.why}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => { setResult(null); setPrompt(''); }} style={secondaryButton()}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      )}
    </Sheet>
  );
}

/* =============================================================================
   BulkSeenSheet — search TMDB and mark films seen with per-user ratings
   ============================================================================= */

function BulkSeenSheet({ tmdb, users, existingTmdbIds, onClose, onMarkSeen }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [stagedRatings, setStagedRatings] = useState({}); // { tmdbId: { user: rating } }
  const [justAdded, setJustAdded] = useState([]);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true);
      try {
        const data = await tmdb.searchMovie(query.trim(), null, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setResults((data.results || []).slice(0, 10));
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('bulk search', e);
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, tmdb]);

  async function confirmMark(result) {
    const ratings = stagedRatings[result.id] || {};
    try {
      const details = await tmdb.getDetails(result.id);
      const meta = detailsToFilmMeta(details);
      const cleaned = Object.fromEntries(
        Object.entries(ratings).filter(([, v]) => typeof v === 'number')
      );
      onMarkSeen({
        ...meta,
        id: mkId(),
        watched: true,
        userRatings: cleaned,
        watchedAt: Date.now(),
        source: 'bulk',
      });
      setJustAdded(prev => [meta.title, ...prev].slice(0, 8));
      setStagedRatings(prev => { const { [result.id]: _, ...rest } = prev; return rest; });
      setExpandedId(null);
      // Optional: clear input to encourage next entry
      setQuery('');
      setResults([]);
    } catch (e) {
      console.error('bulk mark', e);
    }
  }

  return (
    <Sheet onClose={onClose} title="Bulk tag seen" subtitle="Quick add with optional rating">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)', color: C.textFaint,
          }} />
          <input
            autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search a film you've seen..."
            style={{ ...inputStyle, padding: '10px 12px 10px 32px' }}
          />
        </div>

        {searching && (
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.1em' }}>
            SEARCHING…
          </div>
        )}

        {results.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map(r => {
              const already = existingTmdbIds.has(r.id);
              const isOpen = expandedId === r.id;
              const year = r.release_date ? r.release_date.slice(0, 4) : '—';
              const ratings = stagedRatings[r.id] || {};
              return (
                <div key={r.id} style={{
                  border: `1px solid ${isOpen ? C.accentDim : C.borderDim}`,
                  borderRadius: 3, background: C.surface,
                  overflow: 'hidden',
                }}>
                  <div
                    onClick={() => !already && setExpandedId(isOpen ? null : r.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      cursor: already ? 'default' : 'pointer',
                      opacity: already ? 0.5 : 1,
                    }}
                  >
                    <div style={{
                      width: 36, height: 54,
                      background: r.poster_path
                        ? `url(${TMDB_IMG}/w92${r.poster_path}) center/cover`
                        : tileGradient(r.title),
                      borderRadius: 2, flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: FONT.display, fontSize: 14, color: C.text,
                        fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{r.title}</div>
                      <div style={{
                        fontFamily: FONT.mono, fontSize: 10, color: C.textFaint,
                        letterSpacing: '0.08em', marginTop: 2,
                      }}>
                        {year}
                        {typeof r.vote_average === 'number' && r.vote_average > 0 && (
                          <> · {r.vote_average.toFixed(1)}</>
                        )}
                        {already && <> · ALREADY TAGGED</>}
                      </div>
                    </div>
                  </div>

                  {isOpen && !already && (
                    <div style={{
                      padding: '10px 12px 12px',
                      borderTop: `1px solid ${C.borderDim}`,
                      display: 'flex', flexDirection: 'column', gap: 10,
                    }}>
                      <div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, letterSpacing: '0.12em' }}>
                        RATE · SKIP ANY USER WHO HASN'T SEEN IT
                      </div>
                      {users.map(u => {
                        const rv = ratings[u] || 0;
                        return (
                          <div key={u} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textDim, letterSpacing: '0.08em' }}>
                              {u.toUpperCase()}
                            </span>
                            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                              {[1,2,3,4,5].map(n => (
                                <button key={n}
                                  onClick={() => setStagedRatings(prev => ({
                                    ...prev,
                                    [r.id]: { ...prev[r.id], [u]: prev[r.id]?.[u] === n ? undefined : n },
                                  }))}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}
                                >
                                  <Star size={16} fill={n <= rv ? C.accent : 'transparent'} color={C.accent} />
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      <button onClick={() => confirmMark(r)} style={primaryButton(false)}>
                        <Check size={14} /> Mark as seen
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {justAdded.length > 0 && (
          <div style={{
            padding: 10, background: C.surface, border: `1px solid ${C.borderDim}`,
            borderRadius: 3,
          }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 6 }}>
              JUST TAGGED · {justAdded.length}
            </div>
            <div style={{ fontFamily: FONT.body, fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
              {justAdded.join(' · ')}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* =============================================================================
   AddFilmModal — enrichment is required (surfaces errors instead of silently adding)
   ============================================================================= */

function AddFilmModal({ tmdb, users, onClose, onAdd }) {
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([users[0]]);
  const [why, setWhy] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggleUser = u => setSelectedUsers(prev =>
    prev.includes(u) ? prev.filter(x => x !== u) : [...prev, u]
  );

  async function submit() {
    if (!title.trim() || !selectedUsers.length) return;
    setLoading(true); setError('');
    try {
      let meta = null;
      try {
        meta = await searchAndEnrich(tmdb, title.trim(), year || null);
      } catch (e) {
        // Not found / network / key: still allow add but show the reason
        console.warn('enrich', e);
        setError(`Could not enrich from TMDB: ${e.message}. Added with basic info.`);
      }
      onAdd({
        id: mkId(),
        tmdbId: meta?.tmdbId || null,
        imdbId: meta?.imdbId || null,
        title: meta?.title || title.trim(),
        director: meta?.director || null,
        year: meta?.year ?? (year ? Number(year) : null),
        runtime: meta?.runtime || null,
        genres: meta?.genres || [],
        synopsis: meta?.synopsis || null,
        posterUrl: meta?.posterUrl || null,
        rating: meta?.rating ?? null,
        votes: meta?.votes ?? null,
        budget: meta?.budget ?? null,
        availability: meta?.availability || null,
        addedBy: [...selectedUsers],
        addedAt: Date.now(),
        why: why.trim() || null,
        watched: false,
        source: 'manual',
      });
      onClose();
    } catch (e) {
      setError('Could not add. ' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet onClose={loading ? () => {} : onClose} title="Add to programme" subtitle="New entry">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Title">
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Stalker" style={inputStyle} disabled={loading} />
        </Field>
        <Field label="Year (optional)">
          <input value={year} onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="e.g. 1979" style={inputStyle} disabled={loading} inputMode="numeric" />
        </Field>
        <Field label="Added by">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {users.map(u => (
              <button key={u} onClick={() => toggleUser(u)} disabled={loading}
                style={{ ...pillStyle(selectedUsers.includes(u)), flex: 1, minWidth: 80, justifyContent: 'center' }}>{u}</button>
            ))}
          </div>
        </Field>
        <Field label="Why (optional)">
          <textarea value={why} onChange={e => setWhy(e.target.value)}
            placeholder="what hooked you, context, thesis"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }} disabled={loading} />
        </Field>
        {error && (
          <div style={{ color: C.red, fontFamily: FONT.mono, fontSize: 11, lineHeight: 1.5 }}>{error}</div>
        )}
        <button onClick={submit} disabled={loading || !title.trim() || !selectedUsers.length}
          style={primaryButton(loading || !title.trim() || !selectedUsers.length)}>
          {loading ? <><Loader2 size={16} className="spin" /> Fetching metadata</> : 'Add film'}
        </button>
      </div>
    </Sheet>
  );
}

/* =============================================================================
   SettingsSheet — API key + users (runtime config fallback)
   ============================================================================= */

function SettingsSheet({ settings, saveSettings, onClose }) {
  const [apiKey, setApiKey] = useState(settings.apiKey || '');
  const [usersText, setUsersText] = useState((settings.users || []).join(', '));
  const [syncUrl, setSyncUrl] = useState(settings.syncUrl || '');
  const envKey = !!ENV_API_KEY;
  const envUsers = !!ENV_USERS;
  const envSync = !!ENV_SYNC_URL;

  const commit = () => {
    const nextUsers = usersText.split(',').map(s => s.trim()).filter(Boolean);
    saveSettings({
      apiKey: envKey ? settings.apiKey : apiKey.trim(),
      users: nextUsers,
      syncUrl: envSync ? settings.syncUrl : syncUrl.trim(),
    });
    onClose();
  };

  return (
    <Sheet onClose={onClose} title="Settings" subtitle="Configuration">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Field label={`TMDB API key${envKey ? ' (set via VITE_TMDB_API_KEY)' : ''}`}>
          <input
            type="password"
            value={envKey ? '•••••• (from env)' : apiKey}
            onChange={e => setApiKey(e.target.value)}
            disabled={envKey}
            placeholder="Get one free at themoviedb.org/settings/api"
            style={{ ...inputStyle, opacity: envKey ? 0.6 : 1 }}
          />
        </Field>
        <Field label={`Users${envUsers ? ' (set via VITE_USERS)' : ''}`}>
          <input
            value={envUsers ? ENV_USERS.join(', ') : usersText}
            onChange={e => setUsersText(e.target.value)}
            disabled={envUsers}
            placeholder="e.g. Alex, Sam"
            style={{ ...inputStyle, opacity: envUsers ? 0.6 : 1 }}
          />
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, marginTop: 6, letterSpacing: '0.05em' }}>
            Comma-separated. Each name becomes a flag button.
          </div>
        </Field>
        <Field label={`Sync URL${envSync ? ' (set via VITE_SYNC_URL)' : ' — optional'}`}>
          <input
            value={envSync ? '•••••• (from env)' : syncUrl}
            onChange={e => setSyncUrl(e.target.value)}
            disabled={envSync}
            placeholder="https://your-project.firebaseio.com/programme.json"
            style={{ ...inputStyle, opacity: envSync ? 0.6 : 1, fontSize: 12 }}
          />
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, marginTop: 6, letterSpacing: '0.05em', lineHeight: 1.6 }}>
            Any HTTP JSON store that supports GET and PUT at one URL. Paste the same
            URL on every device — changes merge automatically. Leave blank for
            local-only (this device).
          </div>
        </Field>
        <button onClick={commit} style={primaryButton(false)}>Save</button>
      </div>
    </Sheet>
  );
}

function SetupScreen({ settings, saveSettings }) {
  const [apiKey, setApiKey] = useState(settings.apiKey || '');
  const [usersText, setUsersText] = useState((settings.users || []).join(', '));
  const needKey = !settings.apiKey;
  const needUsers = !settings.users?.length;

  const canSave = (!needKey || apiKey.trim()) && (!needUsers || usersText.split(',').some(s => s.trim()));

  const commit = () => {
    if (!canSave) return;
    saveSettings({
      apiKey: settings.apiKey || apiKey.trim(),
      users: settings.users?.length
        ? settings.users
        : usersText.split(',').map(s => s.trim()).filter(Boolean),
    });
  };

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: FONT.body,
    }}>
      <div style={{ maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.accent, letterSpacing: '0.3em' }}>
          PROGRAMME · SETUP
        </div>
        <div style={{
          fontFamily: FONT.display, fontSize: 32, color: C.text,
          fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.05,
          fontVariationSettings: '"opsz" 144',
        }}>
          A shared film<br/>programme
        </div>
        <div style={{ fontFamily: FONT.body, fontSize: 14, color: C.textDim, lineHeight: 1.6 }}>
          A couple of things to set up. These are saved locally in your browser; you can also set them
          at build time via <code style={{ color: C.accent }}>VITE_TMDB_API_KEY</code> and <code style={{ color: C.accent }}>VITE_USERS</code>.
        </div>
        {needKey && (
          <Field label="TMDB API key">
            <input type="password" autoFocus value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="Free at themoviedb.org/settings/api"
              style={inputStyle}
            />
          </Field>
        )}
        {needUsers && (
          <Field label="Who's watching?">
            <input value={usersText} onChange={e => setUsersText(e.target.value)}
              placeholder="Comma-separated names"
              style={inputStyle}
            />
          </Field>
        )}
        <button onClick={commit} disabled={!canSave} style={primaryButton(!canSave)}>
          Continue
        </button>
      </div>
    </div>
  );
}

/* =============================================================================
   App
   ============================================================================= */

export default function App() {
  const [settings, setSettings] = useState(() => resolveSettings(null));
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [watchlist, setWatchlist] = useState([]);
  const [seen, setSeen] = useState([]);
  const [discover, setDiscover] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [services, setServices] = useState(DEFAULT_SERVICES);
  const [loaded, setLoaded] = useState(false);

  const [view, setView] = useState('discover');
  const [addOpen, setAddOpen] = useState(false);
  const [tonightOpen, setTonightOpen] = useState(false);
  const [bulkSeenOpen, setBulkSeenOpen] = useState(false);
  const [detailFilm, setDetailFilm] = useState(null);
  const [detailSource, setDetailSource] = useState(null);

  const [programmeFilter, setProgrammeFilter] = useState('all');

  // Combined profile from all users' ratings — used by For You + Tonight
  const profile = useMemo(() => computeProfile(seenToRated(seen, null)), [seen]);

  // If the For You tab vanishes (no profile), fall back to Discover
  useEffect(() => {
    if (view === 'foryou' && !profile) setView('discover');
  }, [view, profile]);

  const users = settings.users;
  const tmdb = useMemo(() => makeTmdb(settings.apiKey), [settings.apiKey]);
  const sync = useMemo(() => makeSync(settings.syncUrl), [settings.syncUrl]);

  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | ok | error | disabled
  const pushTimerRef = useRef(null);
  const lastPushedAtRef = useRef(0);
  const lastSyncedPayloadRef = useRef('');

  // Load state on mount
  useEffect(() => {
    (async () => {
      const [w, s, d, f, sv, saved] = await Promise.all([
        loadKey(STORAGE_KEYS.watchlist, []),
        loadKey(STORAGE_KEYS.seen, []),
        loadKey(STORAGE_KEYS.discover, null),
        loadKey(STORAGE_KEYS.filters, DEFAULT_FILTERS),
        loadKey(STORAGE_KEYS.services, DEFAULT_SERVICES),
        loadKey(STORAGE_KEYS.settings, null),
      ]);
      const resolved = resolveSettings(saved);
      const effUsers = resolved.users.length ? resolved.users : [];
      setSettings(resolved);
      setWatchlist((w || []).map(film => migrateFilm(film, effUsers)));
      setSeen((s || []).map(film => migrateFilm(film, effUsers)));
      setDiscover(d);
      setFilters({ ...DEFAULT_FILTERS, ...f });
      setServices(sv?.length ? sv : DEFAULT_SERVICES);
      setLoaded(true);
    })();
  }, []);

  // Load fonts + global styles once
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slideUp { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      @keyframes spin { to { transform: rotate(360deg); } }
      .spin { animation: spin 0.9s linear infinite; }
      input::placeholder, textarea::placeholder { color: ${C.textFaint}; }
      input:focus, textarea:focus { outline: none; border-color: ${C.accent}; }
      button:focus-visible { outline: 1px solid ${C.accent}; outline-offset: 2px; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: ${C.bg}; }
      ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
    `;
    document.head.appendChild(style);
    return () => {
      try { document.head.removeChild(link); } catch {}
      try { document.head.removeChild(style); } catch {}
    };
  }, []);

  // Persist to localStorage (always)
  useEffect(() => { if (loaded) saveKey(STORAGE_KEYS.watchlist, watchlist); }, [watchlist, loaded]);
  useEffect(() => { if (loaded) saveKey(STORAGE_KEYS.seen, seen); }, [seen, loaded]);
  useEffect(() => { if (loaded && discover) saveKey(STORAGE_KEYS.discover, discover); }, [discover, loaded]);
  useEffect(() => { if (loaded) saveKey(STORAGE_KEYS.filters, filters); }, [filters, loaded]);
  useEffect(() => { if (loaded) saveKey(STORAGE_KEYS.services, services); }, [services, loaded]);

  // --- Sync: reconcile local <-> remote; applies without push-loop ----------
  const applyRemote = useCallback((remote, localSnap) => {
    const merged = mergeState(localSnap, remote);
    if (!merged.changed) return false;
    const m = merged.state;
    // Record the merged payload so the next push effect sees "no new changes"
    lastSyncedPayloadRef.current = JSON.stringify({
      watchlist: m.watchlist, seen: m.seen, filters: m.filters, services: m.services,
    });
    setWatchlist(m.watchlist || localSnap.watchlist || []);
    setSeen(m.seen || localSnap.seen || []);
    if (m.filters) setFilters(prev => ({ ...prev, ...m.filters }));
    if (Array.isArray(m.services) && m.services.length) setServices(m.services);
    return true;
  }, []);

  // Initial pull after state is loaded
  useEffect(() => {
    if (!loaded) return;
    if (!sync.enabled) { setSyncStatus('disabled'); return; }
    let cancelled = false;
    (async () => {
      setSyncStatus('syncing');
      try {
        const remote = await sync.pull();
        if (cancelled) return;
        applyRemote(remote, { watchlist, seen, filters, services });
        setSyncStatus('ok');
      } catch (e) {
        console.warn('sync pull:', e.message);
        if (!cancelled) setSyncStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [loaded, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced push on state changes — skips if payload matches last-synced
  useEffect(() => {
    if (!loaded || !sync.enabled) return;
    const payload = JSON.stringify({ watchlist, seen, filters, services });
    if (payload === lastSyncedPayloadRef.current) return;
    clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(async () => {
      setSyncStatus('syncing');
      try {
        await sync.push({ watchlist, seen, filters, services });
        lastSyncedPayloadRef.current = payload;
        lastPushedAtRef.current = Date.now();
        setSyncStatus('ok');
      } catch (e) {
        console.warn('sync push:', e.message);
        setSyncStatus('error');
      }
    }, 800);
    return () => clearTimeout(pushTimerRef.current);
  }, [watchlist, seen, filters, services, loaded, sync]);

  // Keep a live ref to state for the sync timers so they don't re-register
  const stateRef = useRef({ watchlist, seen, filters, services });
  useEffect(() => { stateRef.current = { watchlist, seen, filters, services }; },
    [watchlist, seen, filters, services]);

  // Periodic pull while visible (polling — swap for SSE/WebSocket later)
  useEffect(() => {
    if (!loaded || !sync.enabled) return;
    const id = setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastPushedAtRef.current < 5000) return;
      try {
        const remote = await sync.pull();
        applyRemote(remote, stateRef.current);
      } catch { /* keep trying */ }
    }, 20000);
    return () => clearInterval(id);
  }, [loaded, sync, applyRemote]);

  // Pull when the tab becomes visible (catch partner's changes on focus)
  useEffect(() => {
    if (!loaded || !sync.enabled) return;
    const onVis = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const remote = await sync.pull();
        applyRemote(remote, stateRef.current);
      } catch { /* silent */ }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [loaded, sync, applyRemote]);

  const saveSettings = useCallback((next) => {
    const merged = resolveSettings(next);
    setSettings(merged);
    saveKey(STORAGE_KEYS.settings, {
      apiKey: ENV_API_KEY ? '' : merged.apiKey,
      users: ENV_USERS ? [] : merged.users,
      syncUrl: ENV_SYNC_URL ? '' : merged.syncUrl,
    });
  }, []);

  // Mutations — every write stamps _updatedAt so the sync merger can resolve
  function addFilm(film) { setWatchlist(prev => [stampEntry(film), ...prev]); }

  function markWatched({ userRatings, notes }) {
    if (!detailFilm) return;
    const updated = stampEntry({
      ...detailFilm,
      watched: true,
      userRatings: userRatings || {},
      notes,
      watchedAt: Date.now(),
    });
    setWatchlist(prev => prev.filter(f => f.id !== detailFilm.id));
    setSeen(prev => [updated, ...prev]);
    setDetailFilm(null);
  }

  function rerateSeen({ userRatings, notes }) {
    if (!detailFilm) return;
    const patch = stampEntry({ ...detailFilm, userRatings: userRatings || {}, notes });
    setSeen(prev => prev.map(f => f.id === detailFilm.id ? patch : f));
    setDetailFilm(patch);
  }

  function unwatch() {
    if (!detailFilm) return;
    const updated = stampEntry({ ...detailFilm, watched: false, userRatings: {}, notes: null, watchedAt: null });
    setSeen(prev => prev.filter(f => f.id !== detailFilm.id));
    setWatchlist(prev => [updated, ...prev]);
    setDetailFilm(null);
  }

  function deleteFilm() {
    if (!detailFilm) return;
    if (detailSource === 'programme') setWatchlist(prev => prev.filter(f => f.id !== detailFilm.id));
    else if (detailSource === 'seen') setSeen(prev => prev.filter(f => f.id !== detailFilm.id));
    setDetailFilm(null);
  }

  // Apply enriched metadata into watchlist/seen when detail sheet resolves it
  const onEnrichedFromDetail = useCallback((merged) => {
    const patch = { ...merged };
    setWatchlist(prev => prev.map(f => f.id === patch.id ? patch : f));
    setSeen(prev => prev.map(f => f.id === patch.id ? patch : f));
  }, []);

  function getFlagState(film) {
    const entry = watchlist.find(f => matchesFilm(f, film));
    const addedBy = entry ? resolveAddedBy(entry.addedBy, users) : [];
    return Object.fromEntries(users.map(u => [u, addedBy.includes(u)]));
  }

  function toggleFlag(film, user) {
    const entry = watchlist.find(f => matchesFilm(f, film));
    if (!entry) {
      setWatchlist(prev => [stampEntry({
        ...film, id: mkId(),
        addedBy: [user],
        addedAt: Date.now(), watched: false,
        source: 'watchlist',
      }), ...prev]);
      return;
    }
    const current = resolveAddedBy(entry.addedBy, users);
    const next = current.includes(user)
      ? current.filter(u => u !== user)
      : [...current, user];
    if (next.length === 0) {
      setWatchlist(prev => prev.filter(f => f.id !== entry.id));
    } else {
      setWatchlist(prev => prev.map(f => f.id === entry.id ? stampEntry({ ...f, addedBy: next }) : f));
    }
  }

  const filteredWatchlist = useMemo(() => {
    if (programmeFilter === 'all') return watchlist;
    return watchlist.filter(f => resolveAddedBy(f.addedBy, users).includes(programmeFilter));
  }, [watchlist, programmeFilter, users]);

  if (!loaded) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={20} color={C.accent} className="spin" />
      </div>
    );
  }

  // First-run: need API key and/or users
  if (!settings.apiKey || !settings.users.length) {
    return <SetupScreen settings={settings} saveSettings={saveSettings} />;
  }

  const discoverCount = discover?.films?.length || 0;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: FONT.body, paddingBottom: 110 }}>
      <header style={{ padding: '22px 20px 0', background: C.bg, position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{
              fontFamily: FONT.mono, fontSize: 10, color: C.accent,
              letterSpacing: '0.3em', marginBottom: 3,
            }}>
              PROGRAMME · N°{(watchlist.length + seen.length).toString().padStart(2, '0')}
            </div>
            <div style={{
              fontFamily: FONT.display, fontSize: 28, color: C.text,
              fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1,
              fontVariationSettings: '"opsz" 144',
            }}>
              A film programme
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span title={
              syncStatus === 'disabled' ? 'Sync not configured — local only'
              : syncStatus === 'ok' ? 'Synced across devices'
              : syncStatus === 'syncing' ? 'Syncing…'
              : syncStatus === 'error' ? 'Sync failed — retrying'
              : 'Sync idle'
            } style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 7px',
              border: `1px solid ${
                syncStatus === 'ok' ? C.accentDim :
                syncStatus === 'error' ? C.red : C.border
              }`,
              borderRadius: 2,
              color: syncStatus === 'ok' ? C.accent : syncStatus === 'error' ? C.red : C.textFaint,
              fontFamily: FONT.mono, fontSize: 9, letterSpacing: '0.1em',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background:
                  syncStatus === 'ok' ? C.accent :
                  syncStatus === 'syncing' ? C.textDim :
                  syncStatus === 'error' ? C.red : C.textFaint,
                display: 'inline-block',
              }} />
              {syncStatus === 'disabled' ? 'LOCAL' : syncStatus.toUpperCase()}
            </span>
            <button onClick={() => setSettingsOpen(true)} title="Settings" style={{
              background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 3,
              color: C.textDim, cursor: 'pointer', padding: 7,
            }}>
              <Settings size={14} />
            </button>
          </div>
        </div>

        <nav style={{ display: 'flex', gap: 4, marginTop: 18, borderBottom: `1px solid ${C.borderDim}`, overflowX: 'auto' }}>
          {[
            { id: 'foryou', label: 'For You', count: profile?._count || 0, hidden: !profile },
            { id: 'discover', label: 'Discover', count: discoverCount },
            { id: 'programme', label: 'Programme', count: watchlist.length },
            { id: 'seen', label: 'Seen', count: seen.length },
          ].filter(t => !t.hidden).map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              padding: '10px 12px',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${view === t.id ? C.accent : 'transparent'}`,
              color: view === t.id ? C.text : C.textDim,
              fontFamily: FONT.mono, fontSize: 11,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              cursor: 'pointer', marginBottom: -1,
              transition: 'color 120ms, border-color 120ms',
            }}>
              {t.label} <span style={{ color: C.textFaint, marginLeft: 2 }}>{t.count || ''}</span>
            </button>
          ))}
        </nav>
      </header>

      <main>
        {view === 'foryou' && (
          <ForYouView
            tmdb={tmdb} users={users}
            profile={profile}
            services={services}
            seen={seen} watchlist={watchlist}
            onOpenFilm={f => { setDetailFilm(f); setDetailSource('suggestion'); }}
            getFlagState={getFlagState}
            onToggleFlag={toggleFlag}
          />
        )}

        {view === 'discover' && (
          <DiscoverView
            tmdb={tmdb} users={users}
            filters={filters} setFilters={setFilters}
            services={services} setServices={setServices}
            discover={discover} setDiscover={setDiscover}
            onOpenFilm={f => { setDetailFilm(f); setDetailSource('suggestion'); }}
            getFlagState={getFlagState}
            onToggleFlag={toggleFlag}
          />
        )}

        {view === 'programme' && (
          <div>
            {watchlist.length > 0 && users.length > 1 && (
              <div style={{ padding: '14px 20px', display: 'flex', gap: 6, overflowX: 'auto', borderBottom: `1px solid ${C.borderDim}` }}>
                {['all', ...users].map(f => (
                  <button key={f} onClick={() => setProgrammeFilter(f)} style={{
                    ...pillStyle(programmeFilter === f), whiteSpace: 'nowrap',
                  }}>{f === 'all' ? 'All' : f}</button>
                ))}
              </div>
            )}
            {filteredWatchlist.length === 0 ? (
              <div style={{
                padding: '80px 24px', textAlign: 'center',
                fontFamily: FONT.body, fontSize: 14, color: C.textFaint,
                fontStyle: 'italic', lineHeight: 1.6,
              }}>
                {watchlist.length === 0
                  ? 'Empty programme. Flag films from Discover, or add one manually.'
                  : 'No matches for that filter.'}
              </div>
            ) : (
              <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredWatchlist.map(f => (
                  <FilmCard key={f.id} film={f}
                    onClick={() => { setDetailFilm(f); setDetailSource('programme'); }}
                    showAvailability
                    rightBadge={
                      <span style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, letterSpacing: '0.1em' }}>
                        {resolveAddedBy(f.addedBy, users).join(', ').toUpperCase()}
                      </span>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'seen' && (
          <div>
            <div style={{ padding: '14px 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.12em' }}>
                {seen.length} SEEN
              </div>
              <button onClick={() => setBulkSeenOpen(true)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '7px 12px',
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 3, color: C.text,
                fontFamily: FONT.mono, fontSize: 10,
                letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
              }}>
                <Library size={12} /> Bulk tag
              </button>
            </div>
            {seen.length === 0 ? (
              <div style={{ padding: '60px 24px', textAlign: 'center', fontFamily: FONT.body, fontSize: 14, color: C.textFaint, fontStyle: 'italic' }}>
                Nothing tagged yet. Use <span style={{ color: C.accent, fontStyle: 'normal' }}>Bulk tag</span> to add films you've already seen.
              </div>
            ) : (
              <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {seen.map(f => {
                  const ratings = f.userRatings || {};
                  const rated = users.filter(u => typeof ratings[u] === 'number');
                  return (
                    <FilmCard key={f.id} film={f}
                      onClick={() => { setDetailFilm(f); setDetailSource('seen'); }}
                      rightBadge={rated.length ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                          {rated.map(u => (
                            <div key={u} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontFamily: FONT.mono, fontSize: 8, color: C.textFaint, letterSpacing: '0.1em' }}>
                                {u[0].toUpperCase()}
                              </span>
                              <div style={{ display: 'flex', gap: 1 }}>
                                {[1,2,3,4,5].map(n => (
                                  <Star key={n} size={9} fill={n <= ratings[u] ? C.accent : 'transparent'} color={C.accent} />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      <div style={{
        position: 'fixed', bottom: 20, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', gap: 10,
        padding: '0 20px', zIndex: 6, pointerEvents: 'none',
      }}>
        <div style={{
          display: 'flex', gap: 6, pointerEvents: 'auto',
          background: C.surfaceRaised, border: `1px solid ${C.border}`,
          borderRadius: 40, padding: 5,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}>
          <button onClick={() => setAddOpen(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '9px 14px', background: 'transparent', border: 'none',
            color: C.text, fontFamily: FONT.mono, fontSize: 11,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: 'pointer', borderRadius: 40,
          }}><Plus size={14} /> Add</button>
          <button onClick={() => setTonightOpen(true)} disabled={watchlist.length === 0} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '9px 16px',
            background: watchlist.length === 0 ? 'transparent' : C.accent,
            border: 'none',
            color: watchlist.length === 0 ? C.textFaint : C.bg,
            fontFamily: FONT.mono, fontSize: 11,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: watchlist.length === 0 ? 'default' : 'pointer',
            borderRadius: 40, fontWeight: 700,
          }}><Sparkles size={14} /> Tonight</button>
        </div>
      </div>

      {addOpen && <AddFilmModal tmdb={tmdb} users={users} onClose={() => setAddOpen(false)} onAdd={addFilm} />}
      {tonightOpen && <TonightPicker watchlist={watchlist} users={users} profile={profile} onClose={() => setTonightOpen(false)} />}
      {bulkSeenOpen && (
        <BulkSeenSheet
          tmdb={tmdb} users={users}
          existingTmdbIds={new Set([...seen, ...watchlist].map(f => f.tmdbId).filter(Boolean))}
          onClose={() => setBulkSeenOpen(false)}
          onMarkSeen={(film) => setSeen(prev => [stampEntry(film), ...prev])}
        />
      )}
      {settingsOpen && <SettingsSheet settings={settings} saveSettings={saveSettings} onClose={() => setSettingsOpen(false)} />}
      {detailFilm && (
        <FilmDetailSheet
          tmdb={tmdb} users={users}
          film={detailFilm}
          onClose={() => setDetailFilm(null)}
          onWatched={detailSource === 'programme' ? markWatched : undefined}
          onRerate={detailSource === 'seen' ? rerateSeen : undefined}
          onUnwatch={detailSource === 'seen' ? unwatch : undefined}
          onDelete={detailSource !== 'suggestion' ? deleteFilm : undefined}
          canAdd={detailSource === 'suggestion'}
          flagState={detailSource === 'suggestion' ? getFlagState(detailFilm) : undefined}
          onToggleFlag={detailSource === 'suggestion' ? u => toggleFlag(detailFilm, u) : undefined}
          onEnriched={onEnrichedFromDetail}
        />
      )}
    </div>
  );
}
