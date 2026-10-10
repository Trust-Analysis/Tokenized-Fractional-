export function parsePaginationParams(req) {
  const {
    after,
    before,
    limit,
    sort,
    order,
    search,
    assetType,
  } = req.query;

  const params = {};

  if (after) params.after = after;
  if (before) params.before = before;
  if (limit) params.limit = parseInt(limit) || 20;
  if (sort) params.sort = sort;
  if (order) params.order = order;
  if (search) params.search = search;
  if (assetType) params.assetType = assetType;

  if (after && before) {
    req.log?.warn('Both after and before cursors provided; using after');
  }

  return params;
}
