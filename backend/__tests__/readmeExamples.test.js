/**
 * __tests__/readmeExamples.test.js
 *
 * Issue #805: unit tests for the README example extractor and response
 * matcher. The end-to-end run against a live backend happens in CI via
 * `npm run docs:verify-examples`.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractExamples, matchSubset } from '../scripts/verify-readme-examples.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const README = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf-8');

describe('extractExamples()', () => {
  test('finds the README examples, each with a status and a curl command', () => {
    const examples = extractExamples(README);
    expect(examples.length).toBeGreaterThanOrEqual(5);
    for (const ex of examples) {
      expect(ex.command.startsWith('curl ')).toBe(true);
      expect(ex.expectedStatus).toBeGreaterThanOrEqual(100);
      expect(ex.command).not.toMatch(/^#/m);
    }
  });

  test('pairs each bash block with the JSON block that follows it', () => {
    const md = [
      '<!-- readme-api-examples:start -->',
      '```bash', '# Expected status: 200', 'curl http://localhost:3001/health', '```',
      '```json', '{ "status": "ok" }', '```',
      '<!-- readme-api-examples:end -->',
    ].join('\n');
    const [ex] = extractExamples(md);
    expect(ex).toMatchObject({
      command: 'curl http://localhost:3001/health',
      expectedStatus: 200,
      expectedBody: { status: 'ok' },
    });
  });

  test('rejects an example without an expected status', () => {
    const md = '<!-- readme-api-examples:start -->\n```bash\ncurl x\n```\n<!-- readme-api-examples:end -->';
    expect(() => extractExamples(md)).toThrow(/Expected status/);
  });

  test('rejects a README without markers', () => {
    expect(() => extractExamples('# nothing here')).toThrow(/markers/);
  });
});

describe('matchSubset()', () => {
  test('allows extra keys in the response', () => {
    expect(matchSubset({ a: 1 }, { a: 1, b: 2 })).toEqual([]);
  });

  test('reports missing keys and changed values', () => {
    const errors = matchSubset({ a: 1, b: 'x' }, { a: 2 });
    expect(errors).toHaveLength(2);
  });

  test('placeholders match any non-empty value', () => {
    expect(matchSubset({ t: '<iso-timestamp>' }, { t: '2026-01-01T00:00:00Z' })).toEqual([]);
    expect(matchSubset({ t: '<iso-timestamp>' }, { t: '' })).toHaveLength(1);
  });

  test('matches arrays element by element', () => {
    expect(matchSubset([{ id: 1 }], [{ id: 1, x: 1 }, { id: 2 }])).toEqual([]);
    expect(matchSubset([{ id: 1 }], [])).toHaveLength(1);
  });
});
