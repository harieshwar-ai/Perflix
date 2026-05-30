import { api, type Title } from './api.js';

export const libraryQueryKey = ['library'] as const;
export const libraryMoviesQueryKey = ['library', 'movie'] as const;
export const librarySeriesQueryKey = ['library', 'series'] as const;
export const listsWatchlistQueryKey = ['lists', 'watchlist'] as const;

export function fetchLibrary() {
  return api.get<{ titles: Title[] }>('/api/library');
}

export function fetchMovies() {
  return api.get<{ titles: Title[] }>('/api/library/movies');
}

export function fetchSeries() {
  return api.get<{ titles: Title[] }>('/api/library/series');
}

export function fetchWatchlist() {
  return api.get<{ titles: Title[] }>('/api/lists?kind=watchlist');
}
