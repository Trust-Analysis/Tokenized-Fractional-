import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const rootFileAllowlist = new Set([
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.gitleaks.toml',
  '.node-version',
  '.nvmrc',
  '.prettierrc',
  '.trufflehogignore',
  'ADMIN_GOVERNANCE_AND_TEST_COVERAGE_RESOLUTIONS.md',
  'ANALYTICS_IMPLEMENTATION_SUMMARY.md',
  'CHANGELOG.md',
  'CODEOWNERS',
  'CODE_OF_CONDUCT.md',
  'COMPARISON_VIEW_IMPLEMENTATION.md',
  'CONTRACT_SCALABILITY_AND_SECURITY_RESOLUTIONS.md',
  'CONTRIBUTING.md',
  'CONTRIBUTORS.md',
  'DIVIDEND_INTEGRATION_TESTS_SUMMARY.md',
  'DIVIDEND_INTEGRATION_TEST_GUIDE.md',
  'DIVIDEND_TESTS_DELIVERY.md',
  'DIVIDEND_TESTS_INDEX.md',
  'DIVIDEND_TESTS_README.md',
  'GATEWAY_IMPLEMENTATION_SUMMARY.md',
  'GIT_COMMIT_SUMMARY.md',
  'GIT_WORKFLOW_COMPLETE.md',
  'GRAPHQL_IMPLEMENTATION.md',
  'GRAPHQL_IMPLEMENTATION_SUMMARY.md',
  'GRAPHQL_QUICKSTART.md',
  'GRAPHQL_SUBSCRIPTIONS_IMPLEMENTATION.md',
  'GRAPHQL_SUBSCRIPTIONS_QUICKSTART.md',
  'GRAPHQL_SUBSCRIPTION_OPTIMIZATION.md',
  'I18N_README.md',
  'IMPLEMENTATION_CHECKLIST.md',
  'Jenkinsfile',
  'LICENSE',
  'OPENTELEMETRY_TRACING_GUIDE.md',
  'PRICE_HISTORY_GIT_SUMMARY.md',
  'PRIVACY_METADATA_AND_RESILIENCE_RESOLUTIONS.md',
  'PULL_REQUEST_TEMPLATE.md',
  'PURCHASE_LIMITS_IMPLEMENTATION.md',
  'PURCHASE_LIMITS_SUMMARY.md',
  'README.md',
  'REAL_TIME_INDICATORS_IMPLEMENTATION.md',
  'SEARCH_FILTERING_SYSTEM.md',
  'SECURITY.md',
  'TIERED_RATE_LIMITING_IMPLEMENTATION.md',
  'WEBSOCKET_IMPLEMENTATION.md',
  'WEBSOCKET_IMPLEMENTATION_INDEX.md',
  'WEBSOCKET_QUICKSTART.md',
  'WEBSOCKET_RECONNECTION_IMPLEMENTATION.md',
  'commitlint.config.js',
  'docker-compose.yml',
  'i18n-SUMMARY.md',
  'lint-staged.config.cjs',
  'package-lock.json',
  'package.json',
  'render.yaml',
  'renovate.json',
  'websocket-integration-test.js',
  'websocket-logic-test.js',
]);

const homePathMarkers = [
  { label: 'Unix user home path', marker: '/' + 'Users' + '/' },
  {
    label: 'Windows user home path',
    marker: 'C:' + String.fromCharCode(92) + 'Users' + String.fromCharCode(92),
  },
];

const fileList = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { cwd: root },
)
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

let hasErrors = false;

for (const file of fileList) {
  const absolutePath = path.join(root, file);
  if (!existsSync(absolutePath)) {
    continue;
  }

  if (!file.includes('/') && !rootFileAllowlist.has(file)) {
    console.error(`Unexpected repository-root file: ${file}`);
    hasErrors = true;
  }

  const contents = readFileSync(absolutePath);
  if (contents.includes(0)) {
    continue;
  }

  const lines = contents.toString('utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const { label, marker } of homePathMarkers) {
      if (line.includes(marker)) {
        console.error(`${file}:${index + 1} contains a ${label}`);
        hasErrors = true;
      }
    }
  }
}

if (hasErrors) {
  process.exitCode = 1;
} else {
  console.log('Repository hygiene checks passed.');
}
