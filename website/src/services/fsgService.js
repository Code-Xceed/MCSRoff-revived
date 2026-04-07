'use strict';

const { URLSearchParams } = require('url');

async function fetchFsgSeed(seedMode, filterIds) {
  const usableFilters = filterIds && filterIds.length > 0 ? filterIds : ['zsg'];
  const staticSeed = process.env.FSG_STATIC_SEED;
  if (staticSeed) {
    return {
      seed: String(staticSeed),
      filterId: process.env.FSG_STATIC_FILTER || usableFilters[0] || 'zsg',
      token: process.env.FSG_STATIC_TOKEN || ''
    };
  }

  const baseUrl = (process.env.FSG_API_BASE_URL || 'https://www.filteredseed.com').replace(/\/$/, '');
  if (seedMode === 'PRACTICE') {
    const selectedFilter = usableFilters[Math.floor(Math.random() * usableFilters.length)];
    const response = await fetch(`${baseUrl}/getRandomUsedSeed/${encodeURIComponent(selectedFilter)}`);
    if (!response.ok) {
      throw new Error(`FSG practice seed failed with HTTP ${response.status}`);
    }
    const body = await response.json();
    return {
      seed: body.seed || (body.data && body.data.seed) || '',
      filterId: selectedFilter,
      token: ''
    };
  }

  let url = '';
  if (usableFilters.length === 1) {
    url = `${baseUrl}/getSeed/${encodeURIComponent(usableFilters[0])}`;
  } else {
    const params = new URLSearchParams();
    usableFilters.forEach((filterId) => params.append('filters', filterId));
    url = `${baseUrl}/getSeedRandomFilter?${params.toString()}`;
  }

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    }
  });
  if (!response.ok) {
    throw new Error(`FSG seed failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  const payload = body && body.data ? body.data : body;
  return {
    seed: payload.seed || '',
    filterId: payload.filter || usableFilters[0],
    token: payload.token || ''
  };
}

module.exports = {
  fetchFsgSeed
};
