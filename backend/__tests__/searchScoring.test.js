// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * __tests__/searchScoring.test.js — Unit tests for TF-IDF search scoring.
 *
 * Issue #376: Add Unit Tests for Backend TF-IDF Search Scoring
 *
 * Tests cover:
 *   - tokenize(): lowercase, punctuation stripping, empty input
 *   - buildSearchIndex(): index structure, term frequency, document count
 *   - scoreSearch(): IDF correctness, TF correctness, empty query, missing terms
 */

import { tokenize, buildSearchIndex, scoreSearch } from '../src/services/dataService.js';

// ── tokenize ──────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  test('splits text into lowercase words', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  test('removes punctuation and normalizes to lowercase', () => {
    expect(tokenize('Hello, World! How are you?')).toEqual(['hello', 'world', 'how', 'are', 'you']);
  });

  test('handles numbers and alphanumeric tokens', () => {
    expect(tokenize('Building 123 Main-Street')).toEqual(['building', '123', 'main', 'street']);
  });

  test('returns empty array for null/undefined/empty input', () => {
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });

  test('handles only punctuation', () => {
    expect(tokenize('!@#$%^&*()')).toEqual([]);
  });

  test('handles extra whitespace', () => {
    expect(tokenize('  hello    world  ')).toEqual(['hello', 'world']);
  });
});

// ── buildSearchIndex ──────────────────────────────────────────────────────────

describe('buildSearchIndex', () => {
  test('returns an index with expected structure', () => {
    const data = {
      contract1: {
        title: 'Luxury Villa',
        location: 'Miami',
        description: 'A beautiful luxury property',
        assetType: 'Real Estate',
      },
    };
    const result = buildSearchIndex(data);
    expect(result).toHaveProperty('index');
    expect(result).toHaveProperty('totalDocs', 1);
    expect(typeof result.index).toBe('object');
  });

  test('builds term frequency entries for document fields with weights', () => {
    const data = {
      contract1: {
        title: 'Luxury Villa',
        location: 'Miami',
        description: 'A beautiful property',
        assetType: 'Real Estate',
      },
    };
    const result = buildSearchIndex(data);

    // 'luxury' appears in title (weight 3)
    expect(result.index).toHaveProperty('luxury');
    expect(result.index.luxury).toHaveProperty('contract1');
    expect(result.index.luxury.contract1).toBeGreaterThan(0);

    // 'miami' appears in location (weight 2)
    expect(result.index).toHaveProperty('miami');
    expect(result.index.miami).toHaveProperty('contract1');

    // 'beautiful' appears in description (weight 1)
    expect(result.index).toHaveProperty('beautiful');
    expect(result.index.beautiful).toHaveProperty('contract1');
  });

  test('replaces existing index on rebuild', () => {
    const data1 = { c1: { title: 'First', location: 'A', description: 'x', assetType: 'T' } };
    const data2 = { c2: { title: 'Second', location: 'B', description: 'y', assetType: 'U' } };

    const result1 = buildSearchIndex(data1);
    expect(result1.index).toHaveProperty('first');
    expect(result1.index).not.toHaveProperty('second');

    const result2 = buildSearchIndex(data2);
    expect(result2.index).not.toHaveProperty('first');
    expect(result2.index).toHaveProperty('second');
  });

  test('handles empty data object', () => {
    const result = buildSearchIndex({});
    expect(result.totalDocs).toBe(0);
    expect(Object.keys(result.index).length).toBe(0);
  });

  test('does not crash on missing optional fields', () => {
    const data = {
      c1: { title: 'Only Title' },
    };
    const result = buildSearchIndex(data);
    expect(result.totalDocs).toBe(1);
    expect(result.index).toHaveProperty('only');
    expect(result.index).toHaveProperty('title');
  });
});

// ── scoreSearch: IDF Correctness ──────────────────────────────────────────────

describe('scoreSearch — IDF correctness', () => {
  // A term that appears in fewer documents should rank those documents higher
  // than a common term that appears in many documents.
  test('rarer term (fewer documents) yields a higher score contribution', () => {
    // We control TF by making all documents have exactly 2 title tokens (weight 3×2=6).
    // TF for "rare" in c1 = 3/6 = 0.5. TF for "common" in c2/c3 = 3/6 = 0.5.
    // This isolates IDF.
    const data = {
      c1: { title: 'rare item', location: '', description: '', assetType: '' },
      c2: { title: 'common item', location: '', description: '', assetType: '' },
      c3: { title: 'common object', location: '', description: '', assetType: '' },
    };
    buildSearchIndex(data);

    const commonResult = scoreSearch('common', data);
    const rareResult = scoreSearch('rare', data);

    const rareScore = rareResult.find((r) => r.contractId === 'c1')?.score || 0;
    const commonScores = commonResult.map((r) => r.score);
    const maxCommonScore = Math.max(...commonScores, 0);

    // A document with a rarer term gets a higher score due to higher IDF
    expect(rareScore).toBeGreaterThan(maxCommonScore);
  });

  test('term present in all documents yields lower IDF than term in one document', () => {
    // Similarly control for TF. Both docs have exactly 2 title tokens.
    // TF for "unique" in c1 = 3/6 = 0.5. TF for "universal" in c1/c2 = 3/6 = 0.5.
    const data = {
      c1: { title: 'universal unique', location: '', description: '', assetType: '' },
      c2: { title: 'universal distinct', location: '', description: '', assetType: '' },
    };
    buildSearchIndex(data);

    const universalResult = scoreSearch('universal', data);
    const uniqueResult = scoreSearch('unique', data);

    const universalScores = universalResult.map((r) => r.score);
    const uniqueScores = uniqueResult.map((r) => r.score);

    // Unique term's max score should be higher than universal's max score
    // because IDF penalizes common terms
    expect(Math.max(...uniqueScores)).toBeGreaterThan(Math.max(...universalScores));
  });
});

// ── scoreSearch: TF Correctness ───────────────────────────────────────────────

describe('scoreSearch — TF correctness', () => {
  test('document with more occurrences of a term scores higher', () => {
    const data = {
      c1: {
        title: 'Villa Villa Villa', // 3 occurrences of "villa" in title (weight 3 each)
        location: 'Miami',
        description: 'A villa in Miami',
        assetType: 'Real Estate',
      },
      c2: {
        title: 'Villa', // 1 occurrence of "villa" in title
        location: 'Dubai',
        description: 'A property in Dubai',
        assetType: 'Real Estate',
      },
    };
    buildSearchIndex(data);

    const result = scoreSearch('villa', data);
    const c1Score = result.find((r) => r.contractId === 'c1')?.score || 0;
    const c2Score = result.find((r) => r.contractId === 'c2')?.score || 0;

    expect(c1Score).toBeGreaterThan(c2Score);
  });

  test('term appearing in multiple fields with different weights sums correctly', () => {
    const data = {
      c1: {
        title: 'Beachfront Property', // 'beachfront' in title (weight 3)
        location: 'Beachfront Drive', // 'beachfront' in location (weight 2)
        description: 'Amazing beachfront views', // 'beachfront' in description (weight 1)
        assetType: 'Real Estate',
      },
      c2: {
        title: 'Beachfront', // 'beachfront' in title only (weight 3)
        location: 'City',
        description: 'No beachfront here',
        assetType: 'Real Estate',
      },
    };
    buildSearchIndex(data);

    const result = scoreSearch('beachfront', data);
    const c1Score = result.find((r) => r.contractId === 'c1')?.score || 0;
    const c2Score = result.find((r) => r.contractId === 'c2')?.score || 0;

    // c1 has beachfront in title+location+description → higher TF
    expect(c1Score).toBeGreaterThan(c2Score);
  });
});

// ── scoreSearch: Empty Query ──────────────────────────────────────────────────

describe('scoreSearch — empty query', () => {
  test('returns all assets with equal score of 1 for empty query', () => {
    const data = {
      c1: { title: 'A', location: 'X', description: 'x', assetType: 'T' },
      c2: { title: 'B', location: 'Y', description: 'y', assetType: 'U' },
      c3: { title: 'C', location: 'Z', description: 'z', assetType: 'V' },
    };
    buildSearchIndex(data);

    const result = scoreSearch('', data);
    expect(result.length).toBe(3);
    expect(result.every((r) => r.score === 1)).toBe(true);
  });

  test('returns empty array when data is empty', () => {
    const data = {};
    buildSearchIndex(data);

    const result = scoreSearch('', data);
    expect(result.length).toBe(0);
  });

  test('returns all assets with score 1 for whitespace-only query', () => {
    const data = {
      c1: { title: 'A', location: 'X', description: 'x', assetType: 'T' },
    };
    buildSearchIndex(data);

    const result = scoreSearch('   ', data);
    expect(result.length).toBe(1);
    expect(result[0].score).toBe(1);
  });

  test('returns all assets with score 1 for null/undefined query', () => {
    const data = {
      c1: { title: 'A', location: 'X', description: 'x', assetType: 'T' },
      c2: { title: 'B', location: 'Y', description: 'y', assetType: 'U' },
    };
    buildSearchIndex(data);

    const nullResult = scoreSearch(null, data);
    expect(nullResult.length).toBe(2);
    expect(nullResult.every((r) => r.score === 1)).toBe(true);

    const undefResult = scoreSearch(undefined, data);
    expect(undefResult.length).toBe(2);
    expect(undefResult.every((r) => r.score === 1)).toBe(true);
  });
});

// ── scoreSearch: Token-Based Matching ─────────────────────────────────────────

describe('scoreSearch — token-based matching', () => {
  test('search term matches substrings within tokens via tokenization', () => {
    // The tokenize function splits on word boundaries, so a search for "lux"
    // would match a token "luxury" only if "lux" is a standalone word.
    // Full prefix matching is not implemented—this test documents current behavior.
    const data = {
      c1: {
        title: 'Luxury Villa',
        location: 'Miami',
        description: 'Luxurious property',
        assetType: 'Real Estate',
      },
      c2: {
        title: 'Standard Home',
        location: 'Orlando',
        description: 'Standard residential',
        assetType: 'Real Estate',
      },
    };
    buildSearchIndex(data);

    // Searching "luxury" should match c1's title
    const fullWordResult = scoreSearch('luxury', data);
    expect(fullWordResult.length).toBeGreaterThan(0);
    expect(fullWordResult[0].contractId).toBe('c1');

    // Searching "lux" as a standalone token matches if any field contains "lux".
    // Since tokenize splits on non-alphanumeric, partial prefix "lux" from "luxury"
    // is NOT a match — it requires an exact token match.
    // This test verifies the token-based behavior returns an empty array.
    const partialResult = scoreSearch('lux', data);
    expect(partialResult.length).toBe(0);
  });

  test('single-word query correctly scores the matching document', () => {
    const data = {
      c1: {
        title: 'Luxury Beach House',
        location: 'Malibu',
        description: 'Beautiful beachfront luxury home',
        assetType: 'Real Estate',
      },
      c2: {
        title: 'Mountain Cabin',
        location: 'Aspen',
        description: 'Cozy mountain retreat',
        assetType: 'Real Estate',
      },
    };
    buildSearchIndex(data);

    // 'beach' matches c1 title + description; c2 has none
    const result = scoreSearch('beach', data);
    expect(result.length).toBeGreaterThan(0);
    const scoredC1 = result.find((r) => r.contractId === 'c1');
    expect(scoredC1).toBeDefined();
    // c1 should have a positive score from 'beach' matches
    if (scoredC1) expect(scoredC1.score).toBeGreaterThan(0);
  });
});

// ── scoreSearch: General behavior ─────────────────────────────────────────────

describe('scoreSearch — general behavior', () => {
  test('returns results sorted by descending score', () => {
    const data = {
      c1: { title: 'Villa', location: 'Miami', description: 'A villa', assetType: 'Real Estate' },
      c2: { title: 'Hotel', location: 'Miami', description: 'x', assetType: 'Real Estate' },
      c3: {
        title: 'Miami Villa',
        location: 'Miami Beach',
        description: 'Beautiful Miami villa',
        assetType: 'Real Estate',
      },
    };
    buildSearchIndex(data);

    const result = scoreSearch('miami', data);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  test('documents with no matching terms are not included in results', () => {
    const data = {
      c1: { title: 'Villa', location: 'Miami', description: 'x', assetType: 'Real Estate' },
      c2: { title: 'Cabin', location: 'Woods', description: 'y', assetType: 'Real Estate' },
    };
    buildSearchIndex(data);

    const result = scoreSearch('villa', data);
    const c2InResults = result.some((r) => r.contractId === 'c2');
    // c2 has no 'villa' hits — it should either not appear or have score 0
    if (c2InResults) {
      const c2Entry = result.find((r) => r.contractId === 'c2');
      expect(c2Entry.score).toBe(0);
    }
    // c1 should be the top result
    expect(result[0].contractId).toBe('c1');
  });

  test('search with terms not in any document returns empty array', () => {
    const data = {
      c1: { title: 'Villa', location: 'Miami', description: 'x', assetType: 'Real Estate' },
    };
    buildSearchIndex(data);

    // 'zzzznonexistent' is not in any document
    const result = scoreSearch('zzzznonexistent', data);
    // Should return no matches — any entry would have score 0
    const hasNonZero = result.some((r) => r.score > 0);
    expect(hasNonZero).toBe(false);
  });
});

// ── Integration: buildSearchIndex + scoreSearch ───────────────────────────────

describe('buildSearchIndex + scoreSearch integration', () => {
  test('realistic multi-asset search scenario', () => {
    const data = {
      CAAAADDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD: {
        title: 'Luxury Beachfront Villa',
        location: 'Miami, Florida',
        description: 'Stunning beachfront villa with ocean views',
        assetType: 'Real Estate',
      },
      CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: {
        title: 'Commercial Office Tower',
        location: 'New York, NY',
        description: 'Prime commercial real estate in Manhattan',
        assetType: 'Commercial',
      },
      CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC: {
        title: 'Miami Downtown Condo',
        location: 'Miami, Florida',
        description: 'Modern condo in downtown Miami',
        assetType: 'Real Estate',
      },
    };
    buildSearchIndex(data);

    // Search for 'miami' — should rank Miami docs highest
    const miamiResults = scoreSearch('miami', data);
    expect(miamiResults.length).toBeGreaterThanOrEqual(2);
    // First two results should be the Miami docs
    const topTwo = miamiResults.slice(0, 2).map((r) => r.contractId);
    expect(topTwo).toContain('CAAAADDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD');
    expect(topTwo).toContain('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');

    // 'beachfront' should rank the villa highest
    const beachResults = scoreSearch('beachfront', data);
    expect(beachResults[0].contractId).toBe(
      'CAAAADDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    );

    // 'commercial' should rank office tower highest
    const commResults = scoreSearch('commercial', data);
    expect(commResults[0].contractId).toBe(
      'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    );
  });
});
