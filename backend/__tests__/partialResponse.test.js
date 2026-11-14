import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFieldsString,
  parseExcludeString,
  applyPartialResponse,
  partialResponseMiddleware,
  getFieldAnalytics,
  resetFieldAnalytics,
} from '../src/middleware/partialResponse.js';

describe('REST API Partial Response Support (#288)', () => {
  beforeEach(() => {
    resetFieldAnalytics();
  });

  it('parses field strings with aliases, dot notation, and nested parentheses', () => {
    const parsed = parseFieldsString('id:contractId,title,location.city,documents(name,hash)');
    assert.equal(parsed.contractId.alias, 'id');
    assert.equal(parsed.title.alias, null);
    assert.ok(parsed.location.children.city);
    assert.ok(parsed.documents.children.name);
    assert.ok(parsed.documents.children.hash);
  });

  it('parses field exclusions', () => {
    const excluded = parseExcludeString('description,documents,-createdAt');
    assert.deepEqual(excluded, ['description', 'documents', 'createdAt']);
  });

  it('prunes top-level fields correctly on objects and arrays', () => {
    const assets = [
      { contractId: 'C1', title: 'Asset 1', location: 'NY', description: 'Long text 1', pricePerShare: 100 },
      { contractId: 'C2', title: 'Asset 2', location: 'CA', description: 'Long text 2', pricePerShare: 200 },
    ];

    const result = applyPartialResponse(assets, {
      fields: 'contractId,title,pricePerShare',
    });

    assert.equal(result.length, 2);
    assert.deepEqual(Object.keys(result[0]), ['contractId', 'title', 'pricePerShare']);
    assert.equal(result[0].description, undefined);
  });

  it('supports nested field selection and exclusions', () => {
    const asset = {
      contractId: 'C1',
      title: 'Real Estate Tower',
      description: 'Big tower',
      documents: [
        { name: 'deed.pdf', hash: 'abc123', size: 1024 },
        { name: 'audit.pdf', hash: 'def456', size: 2048 },
      ],
    };

    const result = applyPartialResponse(asset, {
      fields: 'title,documents(name,hash)',
      exclude: 'description',
    });

    assert.equal(result.description, undefined);
    assert.equal(result.title, 'Real Estate Tower');
    assert.equal(result.documents.length, 2);
    assert.deepEqual(Object.keys(result.documents[0]), ['name', 'hash']);
    assert.equal(result.documents[0].size, undefined);
  });

  it('supports field aliasing (GraphQL-like field renaming)', () => {
    const asset = { contractId: 'C10', title: 'Solar Farm', pricePerShare: 500 };

    const result = applyPartialResponse(asset, {
      fields: 'id:contractId,name:title,cost:pricePerShare',
    });

    assert.equal(result.id, 'C10');
    assert.equal(result.name, 'Solar Farm');
    assert.equal(result.cost, 500);
    assert.equal(result.contractId, undefined);
  });

  it('validates invalid field names and throws 400 ValidationError in strict mode', () => {
    const asset = { contractId: 'C1', title: 'Asset 1' };

    assert.throws(
      () => {
        applyPartialResponse(asset, {
          fields: 'contractId,nonExistentField,invalidProperty',
          strict: true,
        });
      },
      (err) => {
        return (
          err.statusCode === 400 &&
          err.message.includes('Invalid field selection') &&
          err.unknownFields.includes('nonExistentField')
        );
      }
    );
  });

  it('tracks field selection analytics counters', () => {
    const asset = { contractId: 'C1', title: 'Asset 1', location: 'NY' };

    applyPartialResponse(asset, { fields: 'contractId,title' });
    applyPartialResponse(asset, { fields: 'title,location' });

    const analytics = getFieldAnalytics();
    assert.equal(analytics.contractId, 1);
    assert.equal(analytics.title, 2);
    assert.equal(analytics.location, 1);
  });

  it('sets X-Original-Size-Bytes and X-Response-Size-Bytes headers in middleware', () => {
    const middleware = partialResponseMiddleware();

    const req = { query: { fields: 'contractId,title' } };
    const headers = {};
    let sentData = null;

    const res = {
      setHeader: (key, val) => {
        headers[key] = val;
      },
      json: (data) => {
        sentData = data;
      },
    };

    const next = () => {};

    middleware(req, res, next);

    const rawData = [
      { contractId: 'C1', title: 'Asset 1', description: 'Very long description string here...' },
    ];
    res.json(rawData);

    assert.ok(headers['X-Original-Size-Bytes']);
    assert.ok(headers['X-Response-Size-Bytes']);
    assert.ok(
      Number(headers['X-Response-Size-Bytes']) < Number(headers['X-Original-Size-Bytes'])
    );
    assert.equal(sentData[0].description, undefined);
  });
});
