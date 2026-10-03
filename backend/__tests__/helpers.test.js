import { validateContractId, validateRwaBody } from '../index.js';

describe('validateContractId', () => {
  const validId = `C${'A'.repeat(55)}`; // 56 chars, starts with C

  test('accepts valid contract ID', () => {
    expect(validateContractId(validId)).toBe(true);
  });

  test('rejects ID not starting with C', () => {
    expect(validateContractId(`A${'A'.repeat(55)}`)).toBe(false);
  });

  test('rejects ID shorter than 50 chars', () => {
    expect(validateContractId(`C${'A'.repeat(48)}`)).toBe(false);
  });

  test('rejects non-string', () => {
    expect(validateContractId(123)).toBe(false);
    expect(validateContractId(null)).toBe(false);
  });
});

describe('validateRwaBody', () => {
  const valid = {
    title: 'T',
    location: 'L',
    description: 'D',
    assetType: 'Real Estate',
  };

  test('returns null for valid body', () => {
    expect(validateRwaBody(valid)).toBeNull();
  });

  test('reports missing fields', () => {
    const error = validateRwaBody({ title: 'T' });
    expect(error).toMatch(/location/);
    expect(error).toMatch(/description/);
    expect(error).toMatch(/assetType/);
  });

  test('reports all missing when body is empty', () => {
    const error = validateRwaBody({});
    expect(error).toMatch(/title/);
  });
});
