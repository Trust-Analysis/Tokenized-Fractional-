// The asset input fields shared by REST, GraphQL, and the SDK type generator.
export const rwaFields = {
  title: { type: 'String', required: true },
  location: { type: 'String', required: true },
  description: { type: 'String', required: true },
  assetType: { type: 'String', required: true },
  totalShares: { type: 'Int', min: 1 },
  pricePerShare: { type: 'Int', min: 1 },
  availableShares: { type: 'Int', min: 0 },
};

export function rwaGraphQLInput(name, { assetType = 'String', requireAll = false } = {}) {
  const suffix = requireAll ? '!' : '';
  const fields = Object.entries(rwaFields).map(([field, rule]) =>
    `  ${field}: ${field === 'assetType' ? assetType : rule.type}${suffix}`,
  );
  // The shared validator returns equivalent errors for absent and empty fields.
  return [`input ${name} {`, `  contractId: String${suffix}`, ...fields, '}'].join('\n');
}
