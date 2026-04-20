import { useState, useEffect, useMemo } from 'react';
import {
  Plus, Check, Sparkles, Trash2, X, Star, Tv,
  Loader2, RefreshCw, SlidersHorizontal, Search,
} from 'lucide-react';

/* =============================================================================
   PROGRAMME — a film programme for two.
   Catalog-style discover · per-user flagging · watchlist · seen · tonight picker
   ============================================================================= */

const WATCHLIST_KEY = 'programme-watchlist-v1';
const SEEN_KEY = 'programme-seen-v1';
const DISCOVER_KEY = 'programme-discover-v2';
const FILTERS_KEY = 'programme-filters-v1';
const SERVICES_KEY = 'programme-services-v1';

const USERS = ['Daniel', 'Nicole'];

/* =============================================================================
   TMDB (themoviedb.org) — real catalog, posters, availability
   ============================================================================= */

const TMDB_API_KEY = '6fb175df9fb067379b3fa8adea836b17';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

// JustWatch provider IDs (via TMDB /watch/providers)
const PROVIDER_IDS = {
  'Netflix': 8,
  'Max': 1899,
  'Hulu': 15,
  'Prime Video': 9,
  'Disney+': 337,
  'Apple TV+': 350,
  'Paramount+': 531,
  'Peacock': 386,
  'Starz': 43,
  'MGM+': 1968,  // formerly Epix
  'AMC+': 526,
};
const PROVIDER_NAME_BY_ID = Object.fromEntries(
  Object.entries(PROVIDER_IDS).map(([name, id]) => [id, name])
);

// TMDB official genres
const TMDB_GENRE_IDS = {
  'Action': 28, 'Adventure': 12, 'Animation': 16, 'Comedy': 35,
  'Crime': 80, 'Documentary': 99, 'Drama': 18, 'Family': 10751,
  'Fantasy': 14, 'History': 36, 'Horror': 27, 'Music': 10402,
  'Mystery': 9648, 'Romance': 10749, 'Sci-Fi': 878, 'Thriller': 53,
  'War': 10752, 'Western': 37,
};
const GENRE_NAME_BY_ID = Object.fromEntries(
  Object.entries(TMDB_GENRE_IDS).map(([name, id]) => [id, name])
);

/* =============================================================================
   FILM_CATALOG — curated starter catalog, filtered client-side.
   Dynamic discovery via external APIs proved unreliable in the artifact
   sandbox, so the app ships with a hand-picked cinephile catalog.
   ============================================================================= */

const FILM_CATALOG = [
  { title: 'Stalker', director: 'Andrei Tarkovsky', year: 1979, runtime: 162,
    genres: ['Drama', 'Sci-Fi'], synopsis: 'A guide leads two men through the Zone, a mysterious restricted area where physical laws warp.',
    imdbRating: 8.1, imdbVotes: 184000, budget: 1000000 },
  { title: '2001: A Space Odyssey', director: 'Stanley Kubrick', year: 1968, runtime: 149,
    genres: ['Sci-Fi'], synopsis: 'Humanity encounters a mysterious monolith that propels us from primate origins toward an unknown cosmic destiny.',
    imdbRating: 8.3, imdbVotes: 700000, budget: 12000000 },
  { title: 'The Godfather', director: 'Francis Ford Coppola', year: 1972, runtime: 175,
    genres: ['Crime', 'Drama'], synopsis: 'The aging patriarch of an organized crime dynasty transfers control to his reluctant son.',
    imdbRating: 9.2, imdbVotes: 1900000, budget: 6000000 },
  { title: 'Chinatown', director: 'Roman Polanski', year: 1974, runtime: 130,
    genres: ['Drama', 'Mystery', 'Thriller'], synopsis: 'A Los Angeles private eye takes a simple job and unearths a scandal at the heart of the city.',
    imdbRating: 8.1, imdbVotes: 320000, budget: 6000000 },
  { title: 'Heat', director: 'Michael Mann', year: 1995, runtime: 170,
    genres: ['Crime', 'Drama', 'Thriller'], synopsis: 'A disciplined thief and the obsessive detective hunting him find unexpected kinship in their mirror-image lives.',
    imdbRating: 8.3, imdbVotes: 725000, budget: 60000000 },
  { title: 'No Country for Old Men', director: 'Joel & Ethan Coen', year: 2007, runtime: 122,
    genres: ['Crime', 'Thriller'], synopsis: 'A hunter stumbles on drug money in the Texas desert and becomes prey for an implacable killer.',
    imdbRating: 8.2, imdbVotes: 1100000, budget: 25000000 },
  { title: 'There Will Be Blood', director: 'Paul Thomas Anderson', year: 2007, runtime: 158,
    genres: ['Drama'], synopsis: 'An oil prospector in turn-of-the-century California accumulates wealth at the cost of everything else.',
    imdbRating: 8.2, imdbVotes: 645000, budget: 25000000 },
  { title: 'In the Mood for Love', director: 'Wong Kar-wai', year: 2000, runtime: 98,
    genres: ['Drama', 'Romance'], synopsis: 'Two Hong Kong neighbors discover their spouses are having an affair, and begin an intimate restraint of their own.',
    imdbRating: 8.1, imdbVotes: 185000, budget: null },
  { title: 'Parasite', director: 'Bong Joon-ho', year: 2019, runtime: 132,
    genres: ['Drama', 'Thriller'], synopsis: 'A poor family schemes its way into working for a wealthy Seoul household, with consequences that escalate past control.',
    imdbRating: 8.5, imdbVotes: 920000, budget: 11000000 },
  { title: 'Mulholland Drive', director: 'David Lynch', year: 2001, runtime: 147,
    genres: ['Drama', 'Mystery', 'Thriller'], synopsis: 'An amnesiac woman and an aspiring actress navigate a Los Angeles that refuses to stay coherent.',
    imdbRating: 7.9, imdbVotes: 400000, budget: 15000000 },
  { title: 'Blade Runner 2049', director: 'Denis Villeneuve', year: 2017, runtime: 164,
    genres: ['Drama', 'Sci-Fi'], synopsis: 'A new replicant blade runner uncovers a buried secret that could shatter what remains of society.',
    imdbRating: 8.0, imdbVotes: 650000, budget: 150000000 },
  { title: 'Under the Skin', director: 'Jonathan Glazer', year: 2013, runtime: 108,
    genres: ['Horror', 'Sci-Fi'], synopsis: 'An alien takes the form of a woman and drives through Scotland observing human life with cold curiosity.',
    imdbRating: 6.3, imdbVotes: 190000, budget: 13300000 },
  { title: 'Uncut Gems', director: 'Safdie Brothers', year: 2019, runtime: 135,
    genres: ['Crime', 'Thriller'], synopsis: 'A New York jeweler with a gambling addiction makes a high-stakes bet that could change his life or destroy it.',
    imdbRating: 7.4, imdbVotes: 220000, budget: 19000000 },
  { title: 'Portrait of a Lady on Fire', director: 'Céline Sciamma', year: 2019, runtime: 122,
    genres: ['Drama', 'Romance'], synopsis: 'A painter is commissioned to secretly paint the portrait of a reluctant bride in 18th-century Brittany.',
    imdbRating: 8.1, imdbVotes: 100000, budget: 5000000 },
  { title: 'The Lighthouse', director: 'Robert Eggers', year: 2019, runtime: 109,
    genres: ['Drama', 'Horror'], synopsis: 'Two lighthouse keepers on a remote New England island descend into paranoia and mutual loathing.',
    imdbRating: 7.4, imdbVotes: 250000, budget: 11000000 },
  { title: 'Hereditary', director: 'Ari Aster', year: 2018, runtime: 127,
    genres: ['Horror'], synopsis: 'After her secretive mother dies, a woman discovers unsettling things about her ancestry and her family\'s fate.',
    imdbRating: 7.3, imdbVotes: 380000, budget: 10000000 },
  { title: 'Past Lives', director: 'Celine Song', year: 2023, runtime: 105,
    genres: ['Drama', 'Romance'], synopsis: 'Two childhood friends reunite in New York two decades after one emigrated from Korea.',
    imdbRating: 7.8, imdbVotes: 80000, budget: 12000000 },
  { title: 'Everything Everywhere All at Once', director: 'Daniels', year: 2022, runtime: 139,
    genres: ['Comedy', 'Sci-Fi'], synopsis: 'A struggling laundromat owner discovers she must connect to parallel versions of herself to save the multiverse.',
    imdbRating: 7.8, imdbVotes: 640000, budget: 25000000 },
  { title: 'Oppenheimer', director: 'Christopher Nolan', year: 2023, runtime: 180,
    genres: ['Drama'], synopsis: 'The architect of the atomic bomb reckons with what he has unleashed as the world moves into a new era.',
    imdbRating: 8.3, imdbVotes: 800000, budget: 100000000 },
  { title: 'Aftersun', director: 'Charlotte Wells', year: 2022, runtime: 102,
    genres: ['Drama'], synopsis: 'A woman looks back on a Turkish holiday with her young father, grasping at what she couldn\'t see then.',
    imdbRating: 7.6, imdbVotes: 90000, budget: 2000000 },
  { title: 'Tár', director: 'Todd Field', year: 2022, runtime: 158,
    genres: ['Drama'], synopsis: 'A renowned conductor at the peak of her career begins a slow-motion unraveling of her own making.',
    imdbRating: 7.4, imdbVotes: 105000, budget: 35000000 },
  { title: 'Drive My Car', director: 'Ryusuke Hamaguchi', year: 2021, runtime: 179,
    genres: ['Drama'], synopsis: 'A grieving actor directing Uncle Vanya in Hiroshima is paired with a quiet young woman as his chauffeur.',
    imdbRating: 7.6, imdbVotes: 75000, budget: 2000000 },
  { title: 'Moonlight', director: 'Barry Jenkins', year: 2016, runtime: 111,
    genres: ['Drama'], synopsis: 'A young Black man comes of age across three chapters of his life in Miami.',
    imdbRating: 7.4, imdbVotes: 340000, budget: 1500000 },
  { title: 'Arrival', director: 'Denis Villeneuve', year: 2016, runtime: 116,
    genres: ['Drama', 'Sci-Fi'], synopsis: 'A linguist is recruited to decipher communications from mysterious spacecraft that have appeared across the Earth.',
    imdbRating: 7.9, imdbVotes: 790000, budget: 47000000 },
  { title: 'The Grand Budapest Hotel', director: 'Wes Anderson', year: 2014, runtime: 99,
    genres: ['Comedy'], synopsis: 'A legendary concierge and his young protégé are caught up in the theft of a priceless Renaissance painting.',
    imdbRating: 8.1, imdbVotes: 880000, budget: 30000000 },
  { title: 'Spirited Away', director: 'Hayao Miyazaki', year: 2001, runtime: 125,
    genres: ['Animation', 'Fantasy'], synopsis: 'A young girl stumbles into a world of spirits and must work in a bathhouse to save her transformed parents.',
    imdbRating: 8.6, imdbVotes: 820000, budget: 19000000 },
  { title: 'Seven Samurai', director: 'Akira Kurosawa', year: 1954, runtime: 207,
    genres: ['Action', 'Drama'], synopsis: 'A poor village hires seven masterless samurai to defend them from marauding bandits.',
    imdbRating: 8.6, imdbVotes: 380000, budget: null },
  { title: 'Blade Runner', director: 'Ridley Scott', year: 1982, runtime: 117,
    genres: ['Sci-Fi', 'Thriller'], synopsis: 'A reluctant detective in a neon-drenched future hunts escaped replicants who want more life.',
    imdbRating: 8.1, imdbVotes: 830000, budget: 28000000 },
  { title: 'Goodfellas', director: 'Martin Scorsese', year: 1990, runtime: 146,
    genres: ['Crime', 'Drama'], synopsis: 'The story of Henry Hill\'s rise and fall through the ranks of the New York mob.',
    imdbRating: 8.7, imdbVotes: 1200000, budget: 25000000 },
  { title: 'Decision to Leave', director: 'Park Chan-wook', year: 2022, runtime: 139,
    genres: ['Mystery', 'Romance', 'Thriller'], synopsis: 'A Seoul detective investigating a death becomes dangerously entangled with the dead man\'s wife.',
    imdbRating: 7.2, imdbVotes: 80000, budget: null },
  { title: 'The Zone of Interest', director: 'Jonathan Glazer', year: 2023, runtime: 106,
    genres: ['Drama', 'War'], synopsis: 'A Nazi commandant and his wife build an idyllic life next to Auschwitz, just beyond the wall.',
    imdbRating: 7.4, imdbVotes: 85000, budget: 15000000 },
  { title: 'Anatomy of a Fall', director: 'Justine Triet', year: 2023, runtime: 152,
    genres: ['Drama', 'Mystery', 'Thriller'], synopsis: 'A novelist stands trial for her husband\'s death, with their blind son as the only witness.',
    imdbRating: 7.7, imdbVotes: 130000, budget: 6300000 },
  { title: 'Apocalypse Now', director: 'Francis Ford Coppola', year: 1979, runtime: 153,
    genres: ['Drama', 'War'], synopsis: 'A Vietnam War captain travels upriver into Cambodia to assassinate a rogue colonel gone mad in the jungle.',
    imdbRating: 8.4, imdbVotes: 700000, budget: 31000000 },
  { title: 'Alien', director: 'Ridley Scott', year: 1979, runtime: 117,
    genres: ['Horror', 'Sci-Fi'], synopsis: 'The crew of a commercial spacecraft encounter a deadly lifeform after investigating an unknown transmission.',
    imdbRating: 8.5, imdbVotes: 950000, budget: 11000000 },
  { title: 'The Thing', director: 'John Carpenter', year: 1982, runtime: 109,
    genres: ['Horror', 'Sci-Fi'], synopsis: 'An Antarctic research team discovers a parasitic alien that perfectly imitates its victims.',
    imdbRating: 8.2, imdbVotes: 475000, budget: 15000000 },
  { title: 'Taxi Driver', director: 'Martin Scorsese', year: 1976, runtime: 114,
    genres: ['Crime', 'Drama'], synopsis: 'A lonely Vietnam veteran drives nights through a decaying New York and fixates on saving a young prostitute.',
    imdbRating: 8.2, imdbVotes: 900000, budget: 1300000 },
  { title: 'Mad Max: Fury Road', director: 'George Miller', year: 2015, runtime: 120,
    genres: ['Action'], synopsis: 'In a post-apocalyptic wasteland, a warrior woman flees a tyrant across the desert with his wives.',
    imdbRating: 8.1, imdbVotes: 1100000, budget: 150000000 },
  { title: 'Burning', director: 'Lee Chang-dong', year: 2018, runtime: 148,
    genres: ['Drama', 'Mystery'], synopsis: 'A young deliveryman reconnects with a childhood friend, then meets her unsettling new boyfriend.',
    imdbRating: 7.5, imdbVotes: 90000, budget: 6000000 },
  { title: 'First Reformed', director: 'Paul Schrader', year: 2017, runtime: 113,
    genres: ['Drama'], synopsis: 'A small-town pastor in spiritual crisis becomes radicalized by a parishioner\'s despair over climate collapse.',
    imdbRating: 7.1, imdbVotes: 70000, budget: 3500000 },
  { title: 'The Social Network', director: 'David Fincher', year: 2010, runtime: 120,
    genres: ['Drama'], synopsis: 'The origin of Facebook, told through a lawsuit between its founders and the people they left behind.',
    imdbRating: 7.8, imdbVotes: 820000, budget: 40000000 },
];

const DEFAULT_SERVICES = [
  'Netflix', 'Max', 'Hulu', 'Prime Video', 'Disney+',
  'Apple TV+', 'Paramount+', 'Peacock', 'Starz', 'MGM+', 'AMC+',
];

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

const DIST_OPTIONS = [
  { id: 'polarized', label: 'Polarized', hint: 'fat tails' },
  { id: 'consensus', label: 'Consensus', hint: 'narrow peak' },
];

const DEFAULT_FILTERS = {
  genres: [],
  yearMin: 1950,
  yearMax: 2026,
  ratingMin: 6.5,
  votesMin: 1000,
  runtimeMax: null,
  budgetTier: null,
  mood: '',
  includeRentals: false,
};

const C = {
  bg: '#0E0B08',
  surface: '#161210',
  surfaceRaised: '#201B15',
  border: '#2A241C',
  borderDim: '#1E1915',
  text: '#EFE6D2',
  textDim: '#A69A83',
  textFaint: '#6B604F',
  accent: '#D9A441',
  accentDim: '#8B6B2F',
  red: '#B54E3E',
};

const FONT = {
  display: `'Fraunces', 'Times New Roman', Georgia, serif`,
  body: `'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif`,
  mono: `'JetBrains Mono', 'Courier New', monospace`,
};

/* ============================================================================
   Storage
   ============================================================================ */

async function loadKey(key, fallback = null) {
  try {
    // Claude artifact environment
    if (typeof window !== 'undefined' && window.storage?.get) {
      const r = await window.storage.get(key, true);
      if (r?.value) return JSON.parse(r.value);
      return fallback;
    }
    // Standard browser (deployed)
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(key);
      if (v) return JSON.parse(v);
    }
  } catch (e) { /* missing key or invalid JSON */ }
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

/* ============================================================================
   Claude API
   ============================================================================ */

function stripJSON(text) {
  if (!text) throw new Error('empty response');
  let s = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();

  const aStart = s.indexOf('[');
  const oStart = s.indexOf('{');
  const start = (aStart !== -1 && (oStart === -1 || aStart < oStart)) ? aStart : oStart;
  if (start === -1) throw new Error('no json in response');
  const endChar = s[start] === '[' ? ']' : '}';
  const end = s.lastIndexOf(endChar);
  if (end === -1) throw new Error('no json close');

  let slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e1) {
    // Second attempt: strip common garbage (trailing commas, stray backticks)
    const cleaned = slice
      .replace(/,(\s*[\]}])/g, '$1')       // trailing commas
      .replace(/\/\/[^\n]*/g, '')          // line comments
      .replace(/\/\*[\s\S]*?\*\//g, '');   // block comments
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      console.error('JSON parse failed. First 400 chars:', slice.slice(0, 400));
      throw new Error('malformed JSON from model');
    }
  }
}

async function callClaude({ prompt, useWebSearch = false, maxTokens = 1000 }) {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (useWebSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('[callClaude] fetch threw:', e);
    throw new Error(`Network error: ${e.message || 'unreachable'}`);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch {}
    console.error(`[callClaude] HTTP ${res.status}:`, detail);
    throw new Error(`API ${res.status}${detail ? ': ' + detail : ''}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.error('[callClaude] response was not JSON:', e);
    throw new Error('Response was not JSON');
  }

  console.log('[callClaude] response:', data);

  if (data?.error) {
    throw new Error(`API error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  if (!Array.isArray(data?.content)) {
    console.error('[callClaude] no content array:', data);
    throw new Error('Response had no content array');
  }

  const text = data.content
    .filter(b => b?.type === 'text')
    .map(b => b.text || '')
    .join('\n');

  if (!text.trim()) {
    const types = data.content.map(b => b?.type).join(', ');
    console.error('[callClaude] no text in content. Block types:', types);
    throw new Error(`No text in response (blocks: ${types || 'none'})`);
  }

  return text;
}

/* ============================================================================
   TMDB helpers
   ============================================================================ */

async function tmdbFetch(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set('api_key', TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }
  let res;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    console.error('[tmdb] fetch threw:', e);
    throw new Error(`Network error: ${e.message || 'unreachable'}`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch {}
    console.error(`[tmdb] HTTP ${res.status}:`, detail);
    if (res.status === 401) throw new Error('TMDB API key invalid');
    if (res.status === 429) throw new Error('TMDB rate limit — wait a moment');
    throw new Error(`TMDB ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return res.json();
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
    imdbRating: typeof r.vote_average === 'number' ? r.vote_average : null,
    imdbVotes: r.vote_count || null,
    imdbDistribution: null,
    budget: null,
    availability: null,
  };
}

async function tmdbGetDetails(tmdbId) {
  return tmdbFetch(`/movie/${tmdbId}`, {
    append_to_response: 'credits,watch/providers',
    language: 'en-US',
  });
}

function extractProviders(details) {
  const us = details?.['watch/providers']?.results?.US;
  if (!us) return { streaming: [], rental: [] };
  const seen = new Set();
  const streaming = (us.flatrate || [])
    .map(p => PROVIDER_NAME_BY_ID[p.provider_id] || p.provider_name)
    .filter(name => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  const rSeen = new Set();
  const rental = [...(us.rent || []), ...(us.buy || [])]
    .map(p => ({ service: p.provider_name }))
    .filter(r => {
      if (!r.service || rSeen.has(r.service)) return false;
      rSeen.add(r.service);
      return true;
    });
  return { streaming, rental };
}

function extractDirector(details) {
  const crew = details?.credits?.crew || [];
  const directors = crew.filter(c => c.job === 'Director').map(c => c.name);
  if (!directors.length) return null;
  return directors.length === 1 ? directors[0] : directors.slice(0, 2).join(' & ');
}

async function moodToKeywordId(mood) {
  if (!mood?.trim()) return null;
  try {
    const data = await tmdbFetch('/search/keyword', { query: mood.trim() });
    return data.results?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function enrichFilm(title, yearHint) {
  const search = await tmdbFetch('/search/movie', {
    query: title,
    year: yearHint || undefined,
    include_adult: 'false',
    language: 'en-US',
    page: 1,
  });
  const match = search.results?.[0];
  if (!match) throw new Error('Not found on TMDB');
  const details = await tmdbGetDetails(match.id);
  return {
    tmdbId: details.id,
    imdbId: details.imdb_id || null,
    title: details.title || match.title,
    director: extractDirector(details),
    year: details.release_date ? parseInt(details.release_date.slice(0, 4)) : null,
    runtime: details.runtime || null,
    genres: (details.genres || []).map(g => g.name),
    synopsis: details.overview || null,
    posterUrl: details.poster_path ? `${TMDB_IMG}/w500${details.poster_path}` : null,
    imdbRating: typeof details.vote_average === 'number' ? details.vote_average : null,
    imdbVotes: details.vote_count || null,
    imdbDistribution: null,
    budget: details.budget || null,
    availability: extractProviders(details),
  };
}

async function generateDiscover({ filters }) {
  const yMin = filters.yearMin;
  const yMax = filters.yearMax;
  const rMin = filters.ratingMin;
  const vMin = filters.votesMin;
  const runtimeMax = filters.runtimeMax;
  const budgetTier = filters.budgetTier;
  const genreSet = new Set(filters.genres);
  const moodLower = (filters.mood || '').trim().toLowerCase();

  function matchBudget(b) {
    if (!budgetTier) return true;
    if (b == null) return false;
    if (budgetTier === 'indie') return b < 10_000_000;
    if (budgetTier === 'mid') return b >= 10_000_000 && b < 50_000_000;
    if (budgetTier === 'tentpole') return b >= 50_000_000 && b < 150_000_000;
    if (budgetTier === 'blockbuster') return b >= 150_000_000;
    return true;
  }

  let films = FILM_CATALOG.filter(f => {
    if (f.year < yMin || f.year > yMax) return false;
    if (f.imdbRating < rMin) return false;
    if (f.imdbVotes < vMin) return false;
    if (runtimeMax && f.runtime > runtimeMax) return false;
    if (!matchBudget(f.budget)) return false;
    if (genreSet.size && !f.genres.some(g => genreSet.has(g))) return false;
    if (moodLower) {
      const hay = `${f.title} ${f.synopsis} ${f.director} ${f.genres.join(' ')}`.toLowerCase();
      if (!hay.includes(moodLower)) return false;
    }
    return true;
  });

  films.sort((a, b) =>
    (b.imdbRating - a.imdbRating) || (b.imdbVotes - a.imdbVotes)
  );

  return films.slice(0, 30);
}

async function pickForTonight({ watchlist, prompt }) {
  const userPrompt = `Two cinephiles picking for tonight. Their prompt: "${prompt}"

Watchlist:
${watchlist.map(f => `- "${f.title}" (${f.director || '?'}, ${f.year || '?'}, ${f.runtime || '?'}min) genres: ${(f.genres||[]).join(', ')}${f.why ? ` note: "${f.why}"` : ''}`).join('\n')}

Return ONLY JSON (no fences):
{
  "pickTitle": "exact title from list",
  "rationale": "2-3 sentences, specific, no pandering",
  "alternates": [{"title":"...","why":"one phrase"}, {"title":"...","why":"one phrase"}]
}`;
  const text = await callClaude({ prompt: userPrompt, useWebSearch: false });
  return stripJSON(text);
}

/* ============================================================================
   Utils
   ============================================================================ */

const mkId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
function polarizationScore(dist) {
  if (!dist?.length) return 0;
  const ex = dist.filter(d => d.score <= 2 || d.score >= 9).reduce((s, d) => s + d.pct, 0);
  const mid = dist.filter(d => d.score >= 4 && d.score <= 7).reduce((s, d) => s + d.pct, 0);
  return ex - mid * 0.5;
}
function tileGradient(title) {
  let h = 0;
  for (let i = 0; i < (title || '').length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  const h2 = (h + 40) % 360;
  return `linear-gradient(135deg, hsl(${h}, 45%, 22%) 0%, hsl(${h2}, 55%, 12%) 100%)`;
}

/* ============================================================================
   Shared styles (defined early — used by many components)
   ============================================================================ */

const inputStyle = {
  width: '100%', padding: '11px 13px',
  background: C.surface, border: `1px solid ${C.border}`,
  borderRadius: 3, color: C.text,
  fontFamily: FONT.body, fontSize: 14,
  boxSizing: 'border-box',
};

function primaryButton(disabled) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '100%', padding: '12px 16px',
    background: disabled ? C.surfaceRaised : C.accent,
    border: 'none', borderRadius: 3,
    color: disabled ? C.textFaint : C.bg,
    fontFamily: FONT.mono, fontSize: 12,
    letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
    transition: 'background 120ms',
  };
}
function secondaryButton() {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '100%', padding: '10px 16px',
    background: 'transparent', border: `1px solid ${C.border}`,
    borderRadius: 3, color: C.textDim,
    fontFamily: FONT.mono, fontSize: 11,
    letterSpacing: '0.1em', textTransform: 'uppercase',
    cursor: 'pointer',
  };
}
function pillStyle(active) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 11px',
    background: active ? C.accent : 'transparent',
    border: `1px solid ${active ? C.accent : C.border}`,
    borderRadius: 3,
    color: active ? C.bg : C.textDim,
    fontFamily: FONT.mono, fontSize: 11,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    transition: 'all 120ms',
  };
}
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

/* ============================================================================
   RatingDistribution
   ============================================================================ */

function RatingDistribution({ distribution, compact = false }) {
  if (!distribution?.length) {
    return compact ? null : (
      <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.05em' }}>
        distribution unavailable
      </div>
    );
  }
  const sorted = [...distribution].sort((a, b) => a.score - b.score);
  const max = Math.max(...sorted.map(d => d.pct));
  const polar = polarizationScore(sorted);
  const h = compact ? 16 : 56;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: compact ? 1.5 : 3, height: h }}>
        {sorted.map(d => {
          const pct = max > 0 ? d.pct / max : 0;
          return (
            <div key={d.score} style={{
              flex: 1,
              height: `${Math.max(pct * 100, 3)}%`,
              background: C.accent,
              opacity: 0.45 + pct * 0.55,
              borderRadius: 1,
            }} />
          );
        })}
      </div>
      {!compact && (
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontFamily: FONT.mono, fontSize: 9, color: C.textFaint,
          marginTop: 6, letterSpacing: '0.05em',
        }}>
          <span>1</span>
          <span>{polar > 0.15 ? 'POLARIZED' : polar < -0.1 ? 'CONSENSUS' : 'MIXED'}</span>
          <span>10</span>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   AvailabilityPills
   ============================================================================ */

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
        }}>{r.service.toUpperCase()}{r.price ? ` · ${r.price}` : ''}</span>
      ))}
    </div>
  );
}

/* ============================================================================
   FlagButtons
   ============================================================================ */

function FlagButtons({ flagState, onToggle, size = 'md' }) {
  const small = size === 'sm';
  return (
    <div style={{ display: 'flex', gap: small ? 4 : 8, alignItems: 'center' }}>
      {!small && (
        <span style={{
          fontFamily: FONT.mono, fontSize: 9, color: C.textFaint,
          letterSpacing: '0.15em', marginRight: 4,
        }}>WANT</span>
      )}
      {USERS.map(u => {
        const active = flagState[u];
        return (
          <button
            key={u}
            onClick={e => { e.stopPropagation(); onToggle(u); }}
            title={`${u} wants to watch`}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: small ? 26 : 'auto',
              height: small ? 26 : 'auto',
              padding: small ? 0 : '6px 12px',
              gap: 6,
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
            {small ? u[0] : (
              <>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 14, height: 14, borderRadius: '50%',
                  background: active ? C.bg : 'transparent',
                  border: `1px solid ${active ? C.bg : C.textFaint}`,
                  color: active ? C.accent : C.textFaint,
                  fontSize: 9, fontWeight: 700,
                }}>{u[0]}</span>
                {u}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================================
   FilmTile (Discover grid)
   ============================================================================ */

function FilmTile({ film, onClick, flagState, onToggleFlag }) {
  const [imgOk, setImgOk] = useState(true);
  const hasPoster = film.posterUrl && imgOk;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick?.(); }}
      style={{
        position: 'relative',
        background: C.surface,
        border: `1px solid ${C.borderDim}`,
        borderRadius: 4,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 160ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.border; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderDim; }}
    >
      <div style={{
        position: 'relative', width: '100%',
        paddingBottom: '150%', // 2:3 poster aspect
        background: hasPoster ? '#000' : tileGradient(film.title),
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          {hasPoster ? (
            <img
              src={film.posterUrl} alt={film.title} loading="lazy"
              onError={() => setImgOk(false)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            // Minimal fallback — just the year as a Criterion-spine-style label.
            // Title appears below the tile, no duplication.
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                fontFamily: FONT.display, fontSize: 42, color: 'rgba(239,230,210,0.18)',
                fontWeight: 500, letterSpacing: '-0.02em',
                fontVariationSettings: '"opsz" 144',
              }}>
                {film.year || '—'}
              </div>
            </div>
          )}

          {film.imdbRating && (
            <div style={{
              position: 'absolute', top: 7, left: 7,
              background: 'rgba(14,11,8,0.92)',
              WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)',
              padding: '2px 6px', borderRadius: 2,
              border: `1px solid ${C.accentDim}`,
              fontFamily: FONT.display, fontSize: 12, color: C.accent, fontWeight: 600,
              letterSpacing: '-0.01em',
            }}>{film.imdbRating.toFixed(1)}</div>
          )}

          {onToggleFlag && (
            <div style={{ position: 'absolute', top: 6, right: 6 }}>
              <FlagButtons flagState={flagState} onToggle={onToggleFlag} size="sm" />
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
            marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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
      </div>
    </div>
  );
}

/* ============================================================================
   FilmCard (Programme + Seen)
   ============================================================================ */

function FilmCard({ film, onClick, showAvailability = false, rightBadge = null }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && onClick) { e.preventDefault(); onClick(); } }}
      style={{
        width: '100%', background: C.surface,
        border: `1px solid ${C.borderDim}`, borderRadius: 4,
        padding: '16px 16px 14px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 120ms',
        boxSizing: 'border-box',
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

      {(film.genres?.length || film.imdbRating) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12, gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
            {(film.genres || []).slice(0, 3).map((g, i, a) => (
              <span key={g} style={{ fontFamily: FONT.body, fontSize: 11, color: C.textDim, fontStyle: 'italic' }}>
                {g}{i < a.length - 1 ? ' ·' : ''}
              </span>
            ))}
          </div>
          {film.imdbRating && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{
                fontFamily: FONT.display, fontSize: 20, color: C.accent,
                lineHeight: 1, fontWeight: 500, fontVariationSettings: '"opsz" 72',
              }}>{film.imdbRating.toFixed(1)}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, letterSpacing: '0.08em', marginTop: 2 }}>
                {formatVotes(film.imdbVotes)} VOTES
              </div>
            </div>
          )}
        </div>
      )}

      {film.imdbDistribution && (
        <div style={{ marginTop: 10 }}>
          <RatingDistribution distribution={film.imdbDistribution} compact />
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

/* ============================================================================
   Sheet
   ============================================================================ */

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

/* ============================================================================
   Filter bar + chips
   ============================================================================ */

function countActiveFilters(f) {
  let n = 0;
  if (f.genres.length) n++;
  if (f.yearMin !== DEFAULT_FILTERS.yearMin || f.yearMax !== DEFAULT_FILTERS.yearMax) n++;
  if (f.ratingMin !== DEFAULT_FILTERS.ratingMin) n++;
  if (f.votesMin !== DEFAULT_FILTERS.votesMin) n++;
  if (f.runtimeMax) n++;
  if (f.budgetTier) n++;
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
            IMDB {filters.ratingMin.toFixed(1)}+
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
        {filters.includeRentals && (
          <Chip onRemove={() => setFilters({ ...filters, includeRentals: false })}>+rentals</Chip>
        )}
      </div>

      <button
        onClick={onApply}
        disabled={loading}
        style={{
          marginTop: 10, width: '100%',
          padding: '10px 14px',
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

/* ============================================================================
   FiltersSheet
   ============================================================================ */

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
            <RangeInput label="From" value={local.yearMin} min={1920} max={2026}
              onChange={v => setLocal({ ...local, yearMin: Math.min(v, local.yearMax) })} />
            <RangeInput label="To" value={local.yearMax} min={1920} max={2026}
              onChange={v => setLocal({ ...local, yearMax: Math.max(v, local.yearMin) })} />
          </div>
        </Field>

        <Field label={`IMDB rating: ${local.ratingMin.toFixed(1)}+`}>
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

/* ============================================================================
   ServicesSheet
   ============================================================================ */

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

/* ============================================================================
   DiscoverView
   ============================================================================ */

function DiscoverView({ filters, setFilters, services, setServices, discover, setDiscover,
                        watchlist, seen, onOpenFilm, getFlagState, onToggleFlag }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [autoTried, setAutoTried] = useState(false);

  async function run() {
    setLoading(true); setError('');
    try {
      const films = await generateDiscover({ filters });
      if (!films.length) {
        setError('No films match these filters. Try broadening.');
        setDiscover({ films: [], generatedAt: Date.now() });
      } else {
        const withIds = films.map(f => ({ ...f, id: mkId(), source: 'catalog' }));
        setDiscover({ films: withIds, generatedAt: Date.now() });
      }
    } catch (e) {
      console.error('Discover failed:', e);
      setError(e.message || 'Something went wrong');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (autoTried || discover?.films?.length) return;
    setAutoTried(true);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background poster enrichment via TMDB.
  // Runs once per film list. Silently no-ops if TMDB is unreachable.
  useEffect(() => {
    const films = discover?.films || [];
    const needPosters = films.filter(f => !f.posterUrl && !f._posterTried);
    if (!needPosters.length) return;

    // Mark attempted to prevent re-firing on re-renders
    setDiscover(prev => prev ? ({
      ...prev,
      films: prev.films.map(f =>
        needPosters.find(n => n.id === f.id) ? { ...f, _posterTried: true } : f
      ),
    }) : prev);

    // Stagger fetches (10/s) to stay under TMDB's 40/10s limit
    needPosters.forEach((film, i) => {
      setTimeout(async () => {
        try {
          const url = `${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(film.title)}${film.year ? `&year=${film.year}` : ''}`;
          const res = await fetch(url);
          if (!res.ok) return;
          const data = await res.json();
          const match = data.results?.[0];
          if (!match?.poster_path) return;
          const posterUrl = `${TMDB_IMG}/w342${match.poster_path}`;
          setDiscover(prev => prev ? ({
            ...prev,
            films: prev.films.map(f =>
              f.id === film.id
                ? { ...f, posterUrl, tmdbId: match.id, imdbRating: f.imdbRating || match.vote_average }
                : f
            ),
          }) : prev);
        } catch (e) {
          // Silent fail — gradient fallback stays
        }
      }, i * 100);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discover?.films?.length]);

  const films = discover?.films || [];

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
            <span>{films.length} FILMS</span>
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
              <FilmTile key={f.id} film={f}
                onClick={() => onOpenFilm(f)}
                flagState={getFlagState(f)}
                onToggleFlag={u => onToggleFlag(f, u)}
              />
            ))}
          </div>
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

/* ============================================================================
   FilmDetailSheet
   ============================================================================ */

function FilmDetailSheet({ film, onClose, onWatched, onDelete, onUnwatch, canAdd, flagState, onToggleFlag }) {
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState('');
  const [markMode, setMarkMode] = useState(false);

  return (
    <Sheet onClose={onClose} title={film.title} subtitle={film.watched ? 'Seen' : canAdd ? 'Candidate' : 'On programme'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {film.posterUrl && (
          <div style={{
            width: '100%', paddingBottom: '56.25%',
            backgroundImage: `linear-gradient(to top, rgba(14,11,8,0.85), transparent), url(${film.posterUrl})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
            borderRadius: 4, border: `1px solid ${C.borderDim}`,
          }} />
        )}

        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: C.textDim, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {film.director || '—'} · {film.year || '—'} · {formatRuntime(film.runtime)}
          {film.budget && <> · <span style={{ color: C.textFaint }}>Budget</span> {formatBudget(film.budget)}</>}
        </div>

        {film.synopsis && (
          <div style={{ fontFamily: FONT.body, fontSize: 15, color: C.text, lineHeight: 1.55, fontStyle: 'italic' }}>
            {film.synopsis}
          </div>
        )}

        {film.genres?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {film.genres.map(g => (
              <span key={g} style={{
                fontFamily: FONT.mono, fontSize: 10, color: C.textDim,
                border: `1px solid ${C.border}`, padding: '3px 7px', borderRadius: 2,
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>{g}</span>
            ))}
          </div>
        )}

        {film.imdbRating && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.borderDim}`, borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em' }}>IMDB</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{
                  fontFamily: FONT.display, fontSize: 30, color: C.accent,
                  fontWeight: 500, lineHeight: 1, fontVariationSettings: '"opsz" 72',
                }}>{film.imdbRating.toFixed(1)}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.08em' }}>
                  {formatVotes(film.imdbVotes)} VOTES
                </span>
              </div>
            </div>
            <RatingDistribution distribution={film.imdbDistribution} />
          </div>
        )}

        {film.availability && (film.availability.streaming?.length || film.availability.rental?.length) && (
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 8 }}>
              WHERE TO WATCH
            </div>
            <AvailabilityPills availability={film.availability} />
          </div>
        )}

        {film.why && (
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 7 }}>
              {film.source === 'suggestion' ? 'WHY SUGGESTED' : 'WHY ADDED'}
            </div>
            <div style={{ fontFamily: FONT.body, fontSize: 14, color: C.textDim, lineHeight: 1.55, fontStyle: 'italic' }}>
              {film.why}
            </div>
          </div>
        )}

        {film.addedBy && (
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.1em' }}>
            ADDED BY {film.addedBy.toUpperCase()}
            {film.addedAt ? ` · ${new Date(film.addedAt).toLocaleDateString()}` : ''}
          </div>
        )}

        {film.watched && film.rating && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.borderDim}`, borderRadius: 4 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 8 }}>
              YOUR RATING
            </div>
            <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
              {[1,2,3,4,5].map(n => (
                <Star key={n} size={16} fill={n <= film.rating ? C.accent : 'transparent'} color={C.accent} />
              ))}
            </div>
            {film.notes && <div style={{ fontFamily: FONT.body, fontSize: 13, color: C.textDim, fontStyle: 'italic' }}>{film.notes}</div>}
          </div>
        )}

        {canAdd && onToggleFlag && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 10 }}>
              ADD TO PROGRAMME
            </div>
            <FlagButtons flagState={flagState || { Daniel: false, Nicole: false }} onToggle={onToggleFlag} />
            {(flagState?.Daniel || flagState?.Nicole) && (
              <div style={{ fontFamily: FONT.mono, fontSize: 9, color: C.textFaint, letterSpacing: '0.1em', marginTop: 10 }}>
                {flagState.Daniel && flagState.Nicole
                  ? 'BOTH OF YOU WANT THIS'
                  : `${flagState.Daniel ? 'DANIEL' : 'NICOLE'} WANTS THIS`}
              </div>
            )}
          </div>
        )}

        {!film.watched && !canAdd && !markMode && (
          <button onClick={() => setMarkMode(true)} style={primaryButton(false)}>
            <Check size={16} /> Mark as watched
          </button>
        )}

        {markMode && (
          <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: C.textFaint, letterSpacing: '0.15em', marginBottom: 10 }}>
              RATE IT
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => setRating(n)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3 }}>
                  <Star size={22} fill={n <= rating ? C.accent : 'transparent'} color={C.accent} />
                </button>
              ))}
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="A line on what landed or didn't (optional)"
              rows={2}
              style={{ ...inputStyle, background: C.bg, resize: 'vertical', marginBottom: 10, fontSize: 13 }}
            />
            <button onClick={() => onWatched({ rating, notes })} disabled={!rating} style={primaryButton(!rating)}>
              Save
            </button>
          </div>
        )}

        {film.watched && onUnwatch && (
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

/* ============================================================================
   TonightPicker
   ============================================================================ */

function TonightPicker({ watchlist, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function go() {
    if (!prompt.trim()) return;
    setLoading(true); setError('');
    try { setResult(await pickForTonight({ watchlist, prompt: prompt.trim() })); }
    catch (e) { setError(e.message || ''); }
    setLoading(false);
  }

  const pick = result && watchlist.find(f => f.title === result.pickTitle);

  return (
    <Sheet onClose={onClose} title="Tonight" subtitle="Pick from programme">
      {!result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontFamily: FONT.body, fontSize: 14, color: C.textDim, lineHeight: 1.5 }}>
            Say what you want — mood, energy, time you have, who needs to pay attention.
          </div>
          <textarea autoFocus value={prompt} onChange={e => setPrompt(e.target.value)}
            placeholder="e.g. 2 hours, something slow and strange, neither of us is tired"
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
                {pick.director} · {pick.year} · {formatRuntime(pick.runtime)}
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

/* ============================================================================
   AddFilmModal
   ============================================================================ */

function AddFilmModal({ onClose, onAdd }) {
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [addedBy, setAddedBy] = useState(USERS[0]);
  const [why, setWhy] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!title.trim()) return;
    setLoading(true); setError('');
    try {
      let meta = {};
      try { meta = await enrichFilm(title.trim(), year || null); }
      catch (e) { console.warn('enrich', e); }
      onAdd({
        id: mkId(), title: meta.title || title.trim(),
        director: meta.director || null,
        year: meta.year || (year ? Number(year) : null),
        runtime: meta.runtime || null,
        genres: meta.genres || [],
        synopsis: meta.synopsis || null,
        posterUrl: meta.posterUrl || null,
        imdbId: meta.imdbId || null,
        imdbRating: meta.imdbRating || null,
        imdbVotes: meta.imdbVotes || null,
        imdbDistribution: meta.imdbDistribution || null,
        budget: meta.budget || null,
        availability: meta.availability || null,
        addedBy, addedAt: Date.now(),
        why: why.trim() || null, watched: false,
      });
      onClose();
    } catch (e) {
      setError('Could not add. ' + (e.message || ''));
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
          <div style={{ display: 'flex', gap: 6 }}>
            {[...USERS, 'Both'].map(u => (
              <button key={u} onClick={() => setAddedBy(u)} disabled={loading}
                style={{ ...pillStyle(addedBy === u), flex: 1, justifyContent: 'center' }}>{u}</button>
            ))}
          </div>
        </Field>
        <Field label="Why (optional)">
          <textarea value={why} onChange={e => setWhy(e.target.value)}
            placeholder="what hooked you, context, thesis"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }} disabled={loading} />
        </Field>
        {error && <div style={{ color: C.red, fontFamily: FONT.mono, fontSize: 11 }}>{error}</div>}
        <button onClick={submit} disabled={loading || !title.trim()} style={primaryButton(loading || !title.trim())}>
          {loading ? <><Loader2 size={16} className="spin" /> Fetching metadata</> : 'Add film'}
        </button>
      </div>
    </Sheet>
  );
}

/* ============================================================================
   App
   ============================================================================ */

export default function App() {
  const [watchlist, setWatchlist] = useState([]);
  const [seen, setSeen] = useState([]);
  const [discover, setDiscover] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [services, setServices] = useState(DEFAULT_SERVICES);
  const [loaded, setLoaded] = useState(false);

  const [view, setView] = useState('discover');
  const [addOpen, setAddOpen] = useState(false);
  const [tonightOpen, setTonightOpen] = useState(false);
  const [detailFilm, setDetailFilm] = useState(null);
  const [detailSource, setDetailSource] = useState(null);

  const [programmeFilter, setProgrammeFilter] = useState('all');

  useEffect(() => {
    (async () => {
      const [w, s, d, f, sv] = await Promise.all([
        loadKey(WATCHLIST_KEY, []),
        loadKey(SEEN_KEY, []),
        loadKey(DISCOVER_KEY, null),
        loadKey(FILTERS_KEY, DEFAULT_FILTERS),
        loadKey(SERVICES_KEY, DEFAULT_SERVICES),
      ]);
      setWatchlist(w);
      setSeen(s);
      setDiscover(d);
      setFilters({ ...DEFAULT_FILTERS, ...f });
      setServices(sv?.length ? sv : DEFAULT_SERVICES);
      setLoaded(true);
    })();
  }, []);

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
      document.head.removeChild(link);
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => { if (loaded) saveKey(WATCHLIST_KEY, watchlist); }, [watchlist, loaded]);
  useEffect(() => { if (loaded) saveKey(SEEN_KEY, seen); }, [seen, loaded]);
  useEffect(() => { if (loaded && discover) saveKey(DISCOVER_KEY, discover); }, [discover, loaded]);
  useEffect(() => { if (loaded) saveKey(FILTERS_KEY, filters); }, [filters, loaded]);
  useEffect(() => { if (loaded) saveKey(SERVICES_KEY, services); }, [services, loaded]);

  function addFilm(film) { setWatchlist(prev => [film, ...prev]); }

  function markWatched({ rating, notes }) {
    if (!detailFilm) return;
    const updated = { ...detailFilm, watched: true, rating, notes, watchedAt: Date.now() };
    setWatchlist(prev => prev.filter(f => f.id !== detailFilm.id));
    setSeen(prev => [updated, ...prev]);
    setDetailFilm(null);
  }

  function unwatch() {
    if (!detailFilm) return;
    const updated = { ...detailFilm, watched: false, rating: null, notes: null, watchedAt: null };
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

  function getFlagState(film) {
    const entry = watchlist.find(f => f.title === film.title && f.year === film.year);
    if (!entry) return { Daniel: false, Nicole: false };
    if (entry.addedBy === 'Both') return { Daniel: true, Nicole: true };
    return { Daniel: entry.addedBy === 'Daniel', Nicole: entry.addedBy === 'Nicole' };
  }

  function toggleFlag(film, user) {
    const entry = watchlist.find(f => f.title === film.title && f.year === film.year);
    if (!entry) {
      setWatchlist(prev => [{
        ...film, id: mkId(), addedBy: user,
        addedAt: Date.now(), watched: false, source: 'watchlist',
      }, ...prev]);
      return;
    }
    if (entry.addedBy === user) {
      setWatchlist(prev => prev.filter(f => f.id !== entry.id));
    } else if (entry.addedBy === 'Both') {
      const other = user === 'Daniel' ? 'Nicole' : 'Daniel';
      setWatchlist(prev => prev.map(f => f.id === entry.id ? { ...f, addedBy: other } : f));
    } else {
      setWatchlist(prev => prev.map(f => f.id === entry.id ? { ...f, addedBy: 'Both' } : f));
    }
  }

  const filteredWatchlist = useMemo(() =>
    watchlist.filter(f => programmeFilter === 'all' ? true : f.addedBy === programmeFilter),
    [watchlist, programmeFilter]
  );

  if (!loaded) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={20} color={C.accent} className="spin" />
      </div>
    );
  }

  const discoverCount = discover?.films?.length || 0;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: FONT.body, paddingBottom: 110 }}>
      <header style={{ padding: '22px 20px 0', background: C.bg }}>
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
          A film programme<br/>for two
        </div>

        <nav style={{ display: 'flex', gap: 4, marginTop: 18, borderBottom: `1px solid ${C.borderDim}` }}>
          {[
            { id: 'discover', label: 'Discover', count: discoverCount },
            { id: 'programme', label: 'Programme', count: watchlist.length },
            { id: 'seen', label: 'Seen', count: seen.length },
          ].map(t => (
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
        {view === 'discover' && (
          <DiscoverView
            filters={filters} setFilters={setFilters}
            services={services} setServices={setServices}
            discover={discover} setDiscover={setDiscover}
            watchlist={watchlist} seen={seen}
            onOpenFilm={f => { setDetailFilm(f); setDetailSource('suggestion'); }}
            getFlagState={getFlagState}
            onToggleFlag={toggleFlag}
          />
        )}

        {view === 'programme' && (
          <div>
            {watchlist.length > 0 && (
              <div style={{ padding: '14px 20px', display: 'flex', gap: 6, overflowX: 'auto', borderBottom: `1px solid ${C.borderDim}` }}>
                {['all', ...USERS, 'Both'].map(f => (
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
                        {(f.addedBy || '').toUpperCase()}
                      </span>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'seen' && (
          seen.length === 0 ? (
            <div style={{ padding: '80px 24px', textAlign: 'center', fontFamily: FONT.body, fontSize: 14, color: C.textFaint, fontStyle: 'italic' }}>
              Nothing watched yet.
            </div>
          ) : (
            <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {seen.map(f => (
                <FilmCard key={f.id} film={f}
                  onClick={() => { setDetailFilm(f); setDetailSource('seen'); }}
                  rightBadge={f.rating ? (
                    <div style={{ display: 'flex', gap: 1 }}>
                      {[1,2,3,4,5].map(n => <Star key={n} size={10} fill={n <= f.rating ? C.accent : 'transparent'} color={C.accent} />)}
                    </div>
                  ) : null}
                />
              ))}
            </div>
          )
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

      {addOpen && <AddFilmModal onClose={() => setAddOpen(false)} onAdd={addFilm} />}
      {tonightOpen && <TonightPicker watchlist={watchlist} onClose={() => setTonightOpen(false)} />}
      {detailFilm && (
        <FilmDetailSheet
          film={detailFilm}
          onClose={() => setDetailFilm(null)}
          onWatched={detailSource === 'programme' ? markWatched : undefined}
          onUnwatch={detailSource === 'seen' ? unwatch : undefined}
          onDelete={detailSource !== 'suggestion' ? deleteFilm : undefined}
          canAdd={detailSource === 'suggestion'}
          flagState={detailSource === 'suggestion' ? getFlagState(detailFilm) : undefined}
          onToggleFlag={detailSource === 'suggestion' ? u => toggleFlag(detailFilm, u) : undefined}
        />
      )}
    </div>
  );
}
