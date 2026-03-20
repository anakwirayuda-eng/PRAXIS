import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(projectRoot, 'src');
const outputDir = path.join(projectRoot, 'ingestion', 'output');
const outputPath = path.join(outputDir, 'dead_code_report.json');

function listFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    if (!/\.(js|jsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.jsx'),
  ];
  return candidates.find((candidate) => {
    try {
      return !!readFileSync(candidate, 'utf8');
    } catch {
      return false;
    }
  }) || null;
}

function parseImportClause(clause) {
  const imports = new Set();
  const trimmed = clause.trim();
  if (!trimmed) return imports;

  const namedMatch = trimmed.match(/\{([\s\S]+)\}/);
  if (namedMatch) {
    namedMatch[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const [imported] = part.split(/\s+as\s+/);
        imports.add(imported.trim());
      });
  }

  if (/^\*\s+as\s+\w+/.test(trimmed)) {
    imports.add('*');
    return imports;
  }

  const withoutNamed = trimmed.replace(/\{[\s\S]+\}/, '').trim().replace(/,$/, '').trim();
  if (withoutNamed && !withoutNamed.startsWith('*')) {
    imports.add('default');
  }

  return imports;
}

function parseExports(source) {
  const exports = [];
  let match;

  const namedDecl = /export\s+(?:async\s+)?(?:const|function|class)\s+([A-Za-z0-9_]+)/g;
  while ((match = namedDecl.exec(source)) !== null) {
    exports.push({ name: match[1], type: 'named' });
  }

  const namedList = /export\s*\{([^}]+)\}/g;
  while ((match = namedList.exec(source)) !== null) {
    match[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const pieces = part.split(/\s+as\s+/);
        exports.push({ name: (pieces[1] || pieces[0]).trim(), type: 'named' });
      });
  }

  if (/export\s+default\b/.test(source)) {
    exports.push({ name: 'default', type: 'default' });
  }

  return exports;
}

function countIdentifier(source, identifier) {
  const regex = new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return [...source.matchAll(regex)].length;
}

function findUnusedStateSetters(filePath, source) {
  const issues = [];
  const regex = /const\s*\[\s*([A-Za-z0-9_]+)\s*,\s*([A-Za-z0-9_]+)\s*\]\s*=\s*useState\(/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const setter = match[2];
    if (countIdentifier(source, setter) === 1) {
      const line = source.slice(0, match.index).split('\n').length;
      issues.push({ file: filePath, setter, line });
    }
  }
  return issues;
}

function findUnreachableCode(filePath, source) {
  const issues = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index].trim();
    if (!/^return\b/.test(current)) continue;
    if (!/;\s*$/.test(current)) continue;
    if (/^return\s*[\(\[{<]/.test(current)) continue;

    const nextLine = lines[index + 1].trim();
    if (!nextLine || nextLine === '}' || nextLine.startsWith('//') || nextLine.startsWith('/*')) continue;
    if (/^[\}\)\],;]/.test(nextLine) || nextLine.startsWith('</')) continue;
    if (nextLine.startsWith('catch')) continue;

    issues.push({
      file: filePath,
      line: index + 2,
      snippet: nextLine,
    });
  }
  return issues;
}

function extractCssClasses(cssSource) {
  return new Set([...cssSource.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
}

function extractUsedClasses(source) {
  const used = new Set();
  for (const match of source.matchAll(/className\s*=\s*"([^"]+)"/g)) {
    match[1].split(/\s+/).filter(Boolean).forEach((className) => used.add(className));
  }
  for (const match of source.matchAll(/className\s*=\s*'([^']+)'/g)) {
    match[1].split(/\s+/).filter(Boolean).forEach((className) => used.add(className));
  }
  for (const match of source.matchAll(/className\s*=\s*\{`([^`]+)`\}/g)) {
    match[1]
      .replace(/\$\{[^}]+\}/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((className) => used.add(className));
  }
  for (const match of source.matchAll(/['"]([A-Za-z_-][A-Za-z0-9_-]*)['"]/g)) {
    if (/badge-|grid-|btn-|glass-/.test(match[1])) {
      used.add(match[1]);
    }
  }
  return used;
}

const files = listFiles(srcRoot);
const strippedSources = new Map(files.map((filePath) => [filePath, stripComments(readFileSync(filePath, 'utf8'))]));
const exportsByFile = new Map();
const importsByFile = new Map();
const referencedExports = new Map();

for (const filePath of files) {
  const source = strippedSources.get(filePath);
  exportsByFile.set(filePath, parseExports(source));

  const imports = [];
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const resolved = resolveImport(filePath, match[2]);
    if (!resolved) continue;
    const importedNames = [...parseImportClause(match[1])];
    imports.push({ resolved, importedNames });
    const refSet = referencedExports.get(resolved) || new Set();
    importedNames.forEach((name) => refSet.add(name));
    referencedExports.set(resolved, refSet);
  }

  for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const resolved = resolveImport(filePath, match[1]);
    if (!resolved) continue;
    const refSet = referencedExports.get(resolved) || new Set();
    refSet.add('default');
    referencedExports.set(resolved, refSet);
  }
  importsByFile.set(filePath, imports);
}

const unusedExports = [];
for (const [filePath, exportsList] of exportsByFile.entries()) {
  const referenced = referencedExports.get(filePath) || new Set();
  exportsList.forEach((entry) => {
    if (referenced.has(entry.name) || referenced.has('*')) return;
    if (entry.name === 'default' && /main\.(jsx?|js)$/.test(path.basename(filePath))) return;
    unusedExports.push({
      file: filePath,
      export: entry.name,
      type: entry.type,
    });
  });
}

const unusedStateSetters = files.flatMap((filePath) => findUnusedStateSetters(filePath, strippedSources.get(filePath)));
const unreachableCode = files.flatMap((filePath) => findUnreachableCode(filePath, strippedSources.get(filePath)));

const cssPath = path.join(srcRoot, 'styles', 'index.css');
const cssSource = readFileSync(cssPath, 'utf8');
const declaredClasses = extractCssClasses(cssSource);
const usedClasses = new Set(files.flatMap((filePath) => [...extractUsedClasses(strippedSources.get(filePath))]));
const orphanedCssClasses = [...declaredClasses]
  .filter((className) => !usedClasses.has(className))
  .sort();

const report = {
  timestamp: new Date().toISOString(),
  scanned_files: files.length,
  summary: {
    unused_exports: unusedExports.length,
    unused_state_setters: unusedStateSetters.length,
    unreachable_code: unreachableCode.length,
    orphaned_css_classes: orphanedCssClasses.length,
  },
  unused_exports: unusedExports,
  unused_state_setters: unusedStateSetters,
  unreachable_code: unreachableCode,
  orphaned_css_classes: orphanedCssClasses,
};

mkdirSync(outputDir, { recursive: true });
const tempPath = `${outputPath}.tmp`;
writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`);
renameSync(tempPath, outputPath);

console.log('=== DEAD CODE REPORT ===');
console.log(`Files scanned: ${files.length}`);
console.log(`Unused exports: ${unusedExports.length}`);
console.log(`Unused state setters: ${unusedStateSetters.length}`);
console.log(`Unreachable code hits: ${unreachableCode.length}`);
console.log(`Possible orphaned CSS classes: ${orphanedCssClasses.length}`);
