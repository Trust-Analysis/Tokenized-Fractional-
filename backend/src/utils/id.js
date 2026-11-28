import { randomUUID } from 'crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function isValidRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}
