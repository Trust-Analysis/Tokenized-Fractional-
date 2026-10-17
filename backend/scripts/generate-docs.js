// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * scripts/generate-docs.js — Automated API documentation generation.
 *
 * Issue #295: Automated API Documentation Generation
 *
 * Generates documentation from JSDoc @openapi annotations, GraphQL schema,
 * and type definitions. Outputs OpenAPI spec, GraphQL docs, code snippets,
 * and quality reports. Designed for CI/CD integration.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DOCS_DIR = resolve(ROOT, '..', 'docs', 'api');

function generateSnippets(method, path, operation) {
  const baseUrl = 'http://localhost:3001';
  const fullPath = `${baseUrl}${path}`;
  const hasBody = ['post', 'put', 'patch'].includes(method.toLowerCase());
  const requiresAuth = operation.security?.some((s) => s.ApiKeyAuth);
  const bodyExample = operation.requestBody?.content?.['application/json']?.example || {};

  const snippets = {};

  let curlParts = [`curl -X ${method.toUpperCase()} '${fullPath}'`];
  if (requiresAuth) curlParts.push("-H 'x-api-key: YOUR_API_KEY'");
  if (hasBody) {
    curlParts.push("-H 'Content-Type: application/json'");
    curlParts.push(`-d '${JSON.stringify(bodyExample)}'`);
  }
  snippets.curl = curlParts.join(' \\\n  ');

  let jsHeaders = {};
  if (requiresAuth) jsHeaders['x-api-key'] = 'YOUR_API_KEY';
  if (hasBody) jsHeaders['Content-Type'] = 'application/json';
  let jsFetch = `fetch('${fullPath}', {\n  method: '${method.toUpperCase()}',`;
  if (Object.keys(jsHeaders).length) jsFetch += `\n  headers: ${JSON.stringify(jsHeaders, null, 2).replace(/\n/g, '\n  ')},`;
  if (hasBody) jsFetch += `\n  body: JSON.stringify(${JSON.stringify(bodyExample, null, 2).replace(/\n/g, '\n  ')})`;
  jsFetch += `\n})\n  .then(res => res.json())\n  .then(data => console.log(data));`;
  snippets.javascript = jsFetch;

  let pyHeaders = {};
  if (requiresAuth) pyHeaders['x-api-key'] = 'YOUR_API_KEY';
  if (hasBody) pyHeaders['Content-Type'] = 'application/json';
  let py = 'import requests\n\n';
  if (Object.keys(pyHeaders).length) py += `headers = ${JSON.stringify(pyHeaders, null, 2)}\n\n`;
  if (hasBody) {
    py += `payload = ${JSON.stringify(bodyExample, null, 2)}\n\n`;
    py += `response = requests.${method.toLowerCase()}('${fullPath}', headers=headers, json=payload)`;
  } else {
    py += `response = requests.${method.toLowerCase()}('${fullPath}'${Object.keys(pyHeaders).length ? ', headers=headers' : ''})`;
  }
  py += '\nprint(response.json())';
  snippets.python = py;

  return snippets;
}

function generateGraphQLDocs(graphqlSchemaPath) {
  if (!existsSync(graphqlSchemaPath)) {
    return { markdown: 'GraphQL schema file not found.', types: [] };
  }
  const schema = readFileSync(graphqlSchemaPath, 'utf-8');
  const types = [];
  const lines = schema.split('\n');
  let currentType = null;
  let currentFields = [];
  let commentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) {
      commentLines.push(trimmed.replace(/^#\s?/, ''));
      continue;
    }
    const typeMatch = trimmed.match(/^(type|input|enum|interface|union|scalar)\s+(\w+)/);
    if (typeMatch) {
      if (currentType) types.push({ ...currentType, fields: currentFields });
      currentType = { kind: typeMatch[1], name: typeMatch[2], description: commentLines.join(' ') || '' };
      currentFields = [];
      commentLines = [];
      continue;
    }
    if (currentType && trimmed && !trimmed.startsWith('}') && !trimmed.startsWith('{')) {
      const fieldMatch = trimmed.match(/^(\w+)(\([^)]*\))?\s*:\s*(.+)/);
      if (fieldMatch) {
        currentFields.push({ name: fieldMatch[1], args: fieldMatch[2] || '', type: fieldMatch[3].trim(), description: commentLines.join(' ') || '' });
        commentLines = [];
      }
    }
    if (trimmed === '}' && currentType) {
      types.push({ ...currentType, fields: currentFields });
      currentType = null;
      currentFields = [];
      commentLines = [];
    }
  }

  let md = '# GraphQL API Documentation\n\n> Auto-generated from schema type definitions.\n\n## Table of Contents\n\n';
  for (const type of types) md += `- [${type.name} (${type.kind})](#${type.name.toLowerCase()})\n`;
  md += '\n---\n\n';
  for (const type of types) {
    md += `## ${type.name}\n\n**Kind:** ${type.kind}\n\n`;
    if (type.description) md += `${type.description}\n\n`;
    if (type.fields.length > 0) {
      md += '| Field | Arguments | Type | Description |\n|-------|-----------|------|-------------|\n';
      for (const field of type.fields) md += `| \`${field.name}\` | ${field.args || '\u2014'} | \`${field.type}\` | ${field.description || '\u2014'} |\n`;
      md += '\n';
    }
  }
  return { markdown: md, types };
}

function runQualityChecks(spec) {
  const issues = [];
  const warnings = [];
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation.summary) warnings.push(`${method.toUpperCase()} ${path}: Missing summary`);
      if (!operation.description) warnings.push(`${method.toUpperCase()} ${path}: Missing description`);
      if (operation.security && !operation.responses?.['401']) issues.push(`${method.toUpperCase()} ${path}: Has security but missing 401 response`);
      if (!operation.responses?.['400'] && ['post', 'put', 'patch'].includes(method)) warnings.push(`${method.toUpperCase()} ${path}: Missing 400 response`);
    }
  }
  return { issues, warnings, passed: issues.length === 0 };
}

async function generateDocs() {
  console.log('[docs] Starting automated API documentation generation...\n');
  mkdirSync(DOCS_DIR, { recursive: true });

  const { swaggerSpec } = await import(join(ROOT, 'docs.js'));
  const spec = swaggerSpec;

  console.log('[docs] Generating code snippets...');
  const snippetsMap = {};
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      snippetsMap[`${method.toUpperCase()} ${path}`] = generateSnippets(method, path, operation);
    }
  }

  const enhancedSpec = JSON.parse(JSON.stringify(spec));
  for (const [path, methods] of Object.entries(enhancedSpec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const key = `${method.toUpperCase()} ${path}`;
      if (snippetsMap[key]) operation['x-code-samples'] = snippetsMap[key];
    }
  }

  writeFileSync(join(DOCS_DIR, 'openapi.json'), JSON.stringify(enhancedSpec, null, 2));
  console.log('[docs] OpenAPI spec written to docs/api/openapi.json');

  console.log('[docs] Generating GraphQL schema documentation...');
  const graphqlDocs = generateGraphQLDocs(join(ROOT, 'graphql.js'));
  writeFileSync(join(DOCS_DIR, 'graphql-schema.md'), graphqlDocs.markdown);
  console.log(`[docs] GraphQL docs written (${graphqlDocs.types.length} types)`);

  console.log('[docs] Generating interactive API documentation...');
  let apiMd = '# RWA Marketplace API Documentation\n\n> Auto-generated from code annotations.\n\n';
  apiMd += `**Generated:** ${new Date().toISOString()}\n**API Version:** ${spec.info?.version || 'unknown'}\n\n---\n\n`;
  const taggedOps = {};
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const tag = operation.tags?.[0] || 'Other';
      if (!taggedOps[tag]) taggedOps[tag] = [];
      taggedOps[tag].push({ path, method, operation });
    }
  }
  for (const [tag, ops] of Object.entries(taggedOps)) {
    apiMd += `## ${tag}\n\n`;
    for (const { path, method, operation } of ops) {
      apiMd += `### ${method.toUpperCase()} \`${path}\`\n\n**${operation.summary || 'No summary'}**\n\n`;
      if (operation.description) apiMd += `${operation.description}\n\n`;
      if (operation.security) apiMd += '> \u26a0\ufe0f Requires authentication\n\n';
      const snip = snippetsMap[`${method.toUpperCase()} ${path}`];
      if (snip) {
        apiMd += '<details><summary>cURL</summary>\n\n```bash\n' + snip.curl + '\n```\n</details>\n\n';
        apiMd += '<details><summary>JavaScript</summary>\n\n```javascript\n' + snip.javascript + '\n```\n</details>\n\n';
        apiMd += '<details><summary>Python</summary>\n\n```python\n' + snip.python + '\n```\n</details>\n\n';
      }
      apiMd += '---\n\n';
    }
  }
  writeFileSync(join(DOCS_DIR, 'README.md'), apiMd);
  console.log('[docs] Interactive API docs written to docs/api/README.md');

  console.log('\n[docs] Running documentation quality checks...');
  const quality = runQualityChecks(spec);
  if (quality.issues.length) { console.log('\n\u274c Issues:'); quality.issues.forEach((i) => console.log(`  - ${i}`)); }
  if (quality.warnings.length) { console.log('\n\u26a0\ufe0f Warnings:'); quality.warnings.forEach((w) => console.log(`  - ${w}`)); }
  writeFileSync(join(DOCS_DIR, 'quality-report.json'), JSON.stringify({ timestamp: new Date().toISOString(), ...quality }, null, 2));
  writeFileSync(join(DOCS_DIR, 'code-snippets.json'), JSON.stringify(snippetsMap, null, 2));

  console.log(`\n[docs] \u2705 Complete! Endpoints: ${Object.keys(snippetsMap).length}, GraphQL types: ${graphqlDocs.types.length}, Quality: ${quality.passed ? 'PASSED' : 'FAILED'}`);
  if (!quality.passed) process.exit(1);
}

generateDocs().catch((err) => { console.error('[docs] Generation failed:', err); process.exit(1); });
