import { createHash, randomBytes } from 'crypto';

const CURSOR_VERSION = 1;
const CURSOR_TTL_MS = parseInt(process.env.CURSOR_TTL_SECONDS) * 1000 || 3600000;
const MAX_PAGE_SIZE = 100;
const MIN_PAGE_SIZE = 1;
const DEFAULT_PAGE_SIZE = 20;
const CURSOR_SECRET = process.env.CURSOR_SECRET || 'cursor-secret-change-in-production';

const SORT_FIELDS = {
  createdAt: { defaultOrder: 'desc', type: 'string' },
  title: { defaultOrder: 'asc', type: 'string' },
  contractId: { defaultOrder: 'asc', type: 'string' },
  assetType: { defaultOrder: 'asc', type: 'string' },
  updatedAt: { defaultOrder: 'desc', type: 'string' },
  totalValuation: { defaultOrder: 'desc', type: 'number' },
};

class CursorError extends Error {
  constructor(message, code = 'INVALID_CURSOR') {
    super(message);
    this.name = 'CursorError';
    this.code = code;
    this.status = 400;
  }
}

function hmac(data) {
  return createHash('sha256').update(`${CURSOR_SECRET}:${JSON.stringify(data)}`).digest('hex').slice(0, 16);
}

export function encodeCursor(sortValue, secondarySort, direction, sortField) {
  const payload = {
    v: CURSOR_VERSION,
    sv: sortValue,
    ss: secondarySort,
    d: direction,
    sf: sortField,
    t: Date.now(),
  };
  payload.sig = hmac(payload);
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return null;

  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const payload = JSON.parse(json);

    if (!payload || payload.v !== CURSOR_VERSION) {
      throw new CursorError('Invalid cursor version', 'INVALID_CURSOR_VERSION');
    }

    const expectedSig = hmac({ v: payload.v, sv: payload.sv, ss: payload.ss, d: payload.d, sf: payload.sf, t: payload.t });
    if (payload.sig !== expectedSig) {
      throw new CursorError('Cursor signature mismatch - possible tampering', 'CURSOR_TAMPERED');
    }

    if (Date.now() - payload.t > CURSOR_TTL_MS) {
      throw new CursorError('Cursor has expired', 'CURSOR_EXPIRED');
    }

    return {
      sortValue: payload.sv,
      secondarySort: payload.ss,
      direction: payload.d,
      sortField: payload.sf,
      timestamp: payload.t,
    };
  } catch (error) {
    if (error instanceof CursorError) throw error;
    throw new CursorError('Malformed cursor', 'MALFORMED_CURSOR');
  }
}

function compareValues(a, b, sortField, direction) {
  const config = SORT_FIELDS[sortField] || SORT_FIELDS.createdAt;
  const type = config.type || 'string';
  const dir = direction === 'desc' ? -1 : 1;

  let cmp;
  if (type === 'number') {
    cmp = parseFloat(a) - parseFloat(b);
  } else {
    cmp = String(a || '').localeCompare(String(b || ''));
  }

  return isNaN(cmp) ? 0 : cmp * dir;
}

export function applyCursorPagination(items, options = {}) {
  const {
    after,
    before,
    limit = DEFAULT_PAGE_SIZE,
    sort = 'createdAt',
    order,
    search,
    assetType,
  } = options;

  const pageSize = Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, parseInt(limit) || DEFAULT_PAGE_SIZE));
  const sortField = SORT_FIELDS[sort] ? sort : 'createdAt';
  const sortDirection = order || SORT_FIELDS[sortField].defaultOrder;

  let filtered = [...items];

  if (assetType) {
    const lower = assetType.toLowerCase();
    filtered = filtered.filter(a => a.assetType?.toLowerCase() === lower);
  }

  if (search) {
    const lower = search.toLowerCase();
    filtered = filtered.filter(a =>
      a.title?.toLowerCase().includes(lower) ||
      a.description?.toLowerCase().includes(lower)
    );
  }

  const getSortValue = (item) => {
    return item[sortField] !== undefined ? item[sortField] : '';
  };

  const getSecondarySort = (item) => {
    return item.contractId || item.id || '';
  };

  filtered.sort((a, b) => {
    const primary = compareValues(getSortValue(a), getSortValue(b), sortField, sortDirection);
    if (primary !== 0) return primary;
    return compareValues(getSecondarySort(a), getSecondarySort(b), 'contractId', sortDirection);
  });

  const total = filtered.length;
  let startIndex = 0;
  let endIndex = total;

  if (after) {
    try {
      const cursor = decodeCursor(after);
      let found = false;
      for (let i = 0; i < filtered.length; i++) {
        const sv = String(getSortValue(filtered[i]));
        const ss = String(getSecondarySort(filtered[i]));
        if (sv === String(cursor.sortValue) && ss === String(cursor.secondarySort)) {
          startIndex = i + 1;
          found = true;
          break;
        }
      }
      if (!found) {
        throw new CursorError('Cursor references a resource that no longer exists', 'CURSOR_STALE');
      }
    } catch (error) {
      if (error instanceof CursorError) throw error;
      throw new CursorError('Invalid after cursor', 'INVALID_AFTER_CURSOR');
    }
  }

  if (before && !after) {
    try {
      const cursor = decodeCursor(before);
      let foundIndex = -1;
      for (let i = 0; i < filtered.length; i++) {
        const sv = String(getSortValue(filtered[i]));
        const ss = String(getSecondarySort(filtered[i]));
        if (sv === String(cursor.sortValue) && ss === String(cursor.secondarySort)) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex === -1) {
        throw new CursorError('Cursor references a resource that no longer exists', 'CURSOR_STALE');
      }
      const prevPageStart = Math.max(0, foundIndex - pageSize);
      startIndex = prevPageStart;
      endIndex = foundIndex;
    } catch (error) {
      if (error instanceof CursorError) throw error;
      throw new CursorError('Invalid before cursor', 'INVALID_BEFORE_CURSOR');
    }
  }

  if (after && before && endIndex <= startIndex) {
    return {
      data: [],
      pagination: {
        limit: pageSize,
        sort: sortField,
        order: sortDirection,
        total,
        hasNext: false,
        hasPrev: false,
      },
    };
  }

  const page = filtered.slice(startIndex, startIndex + pageSize);

  const hasNext = before ? true : (startIndex + pageSize < endIndex);
  const hasPrev = before ? (startIndex > 0) : (startIndex > 0);

  let nextCursor = null;
  let prevCursor = null;

  if (hasNext && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = encodeCursor(getSortValue(last), getSecondarySort(last), 'next', sortField);
  }

  if (hasPrev && page.length > 0) {
    const first = page[0];
    prevCursor = encodeCursor(getSortValue(first), getSecondarySort(first), 'prev', sortField);
  }

  const response = {
    data: page,
    pagination: {
      limit: pageSize,
      sort: sortField,
      order: sortDirection,
      total,
      hasNext,
      hasPrev,
    },
  };

  if (nextCursor) response.pagination.nextCursor = nextCursor;
  if (prevCursor) response.pagination.prevCursor = prevCursor;

  return response;
}

export function paginationErrorHandler(err, req, res, next) {
  if (err instanceof CursorError) {
    req.log?.warn({ cursorError: err.code, message: err.message }, 'Cursor pagination error');
    return res.status(err.status || 400).json({
      error: err.message,
      code: err.code,
    });
  }
  next(err);
}

export { CursorError, SORT_FIELDS, MAX_PAGE_SIZE, MIN_PAGE_SIZE, DEFAULT_PAGE_SIZE };
