import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(projectRoot, 'src');
const outputDir = path.join(projectRoot, 'ingestion', 'output');
const outputPath = path.join(outputDir, 'accessibility_report.json');
const cssPath = path.join(srcRoot, 'styles', 'index.css');
const protectedFiles = new Set([
  path.join(srcRoot, 'pages', 'CasePlayer.jsx'),
  path.join(srcRoot, 'components', 'SmartVignette.jsx'),
  path.join(srcRoot, 'data', 'caseLoader.js'),
  path.join(srcRoot, 'styles', 'index.css'),
  path.join(srcRoot, 'components', 'Layout.jsx'),
]);

function listFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    if (!/\.(js|jsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function atomicWrite(targetPath, payload) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp`;
  writeFileSync(tempPath, payload);
  renameSync(tempPath, targetPath);
}

function stripTags(value) {
  return value
    .replace(/\{[^}]*["'`]([^"'`]+)["'`][^}]*\}/g, ' $1 ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineNumberForIndex(source, index) {
  return source.slice(0, index).split('\n').length;
}

function parseLabels(source) {
  const labelMap = new Map();
  for (const match of source.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)) {
    const attrs = match[1];
    const htmlFor = attrs.match(/htmlFor\s*=\s*["'`]([^"'`]+)["'`]/)?.[1];
    const text = stripTags(match[2]);
    if (htmlFor) {
      labelMap.set(htmlFor, text);
    }
  }
  return labelMap;
}

function findButtonsWithoutLabels(filePath, source) {
  const issues = [];
  for (const match of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = match[1];
    const hasAriaLabel = /aria-label\s*=/.test(attrs) || /aria-labelledby\s*=/.test(attrs);
    const text = stripTags(match[2]);
    if (!hasAriaLabel && !text) {
      issues.push({
        file: filePath,
        line: lineNumberForIndex(source, match.index),
        fixable: !protectedFiles.has(filePath),
      });
    }
  }
  return issues;
}

function findInputsWithoutLabels(filePath, source) {
  const issues = [];
  const labels = parseLabels(source);
  for (const match of source.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const tag = match[1];
    const attrs = match[2];
    if (/type\s*=\s*["']hidden["']/.test(attrs)) continue;
    const id = attrs.match(/\bid\s*=\s*["'`]([^"'`]+)["'`]/)?.[1];
    const hasProgrammaticLabel = /aria-label\s*=/.test(attrs) || /aria-labelledby\s*=/.test(attrs);
    const hasAssociatedLabel = id ? labels.has(id) : false;
    if (!hasProgrammaticLabel && !hasAssociatedLabel) {
      issues.push({
        file: filePath,
        line: lineNumberForIndex(source, match.index),
        tag,
        fixable: !protectedFiles.has(filePath),
      });
    }
  }
  return issues;
}

function findClickableNonInteractive(filePath, source) {
  const issues = [];
  for (const match of source.matchAll(/<(div|span|section|article)\b([^>]*)onClick\s*=\s*\{[\s\S]*?\}([^>]*)>/g)) {
    const attrs = `${match[2]} ${match[3]}`;
    if (/role\s*=/.test(attrs) || /tabIndex\s*=/.test(attrs)) continue;
    issues.push({
      file: filePath,
      line: lineNumberForIndex(source, match.index),
      tag: match[1],
      fixable: !protectedFiles.has(filePath),
    });
  }
  return issues;
}

function findOptionCardRisks(filePath, source) {
  const issues = [];
  if (!source.includes('option-card')) return issues;
  const hasRadioRole = /role\s*=\s*["'`]radio["'`]/.test(source);
  if (!hasRadioRole) {
    issues.push({
      file: filePath,
      line: lineNumberForIndex(source, source.indexOf('option-card')),
      issue: 'Option cards do not expose radio semantics.',
      fixable: !protectedFiles.has(filePath),
    });
  }
  return issues;
}

function parseColor(color) {
  if (!color) return null;
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1];
    if (value.length === 3) {
      return {
        r: Number.parseInt(value[0] + value[0], 16),
        g: Number.parseInt(value[1] + value[1], 16),
        b: Number.parseInt(value[2] + value[2], 16),
        a: 1,
      };
    }
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3) {
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    }
  }

  return null;
}

function blendColor(foreground, background) {
  const alpha = foreground.a ?? 1;
  return {
    r: Math.round((foreground.r * alpha) + (background.r * (1 - alpha))),
    g: Math.round((foreground.g * alpha) + (background.g * (1 - alpha))),
    b: Math.round((foreground.b * alpha) + (background.b * (1 - alpha))),
    a: 1,
  };
}

function luminance(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground, background) {
  const fg = 0.2126 * luminance(foreground.r) + 0.7152 * luminance(foreground.g) + 0.0722 * luminance(foreground.b);
  const bg = 0.2126 * luminance(background.r) + 0.7152 * luminance(background.g) + 0.0722 * luminance(background.b);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function findContrastRisks(filePath, source) {
  const issues = [];
  const baseBackground = { r: 15, g: 23, b: 42, a: 1 };
  for (const match of source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    const block = match[1];
    const colorMatch = block.match(/color:\s*['"]([^'"]+)['"]/);
    const backgroundMatch = block.match(/background(?:Color)?:\s*['"]([^'"]+)['"]/);
    if (!colorMatch || !backgroundMatch) continue;
    const color = parseColor(colorMatch[1]);
    const background = parseColor(backgroundMatch[1]);
    if (!color || !background) continue;
    const effectiveBackground = background.a < 1 ? blendColor(background, baseBackground) : background;
    const ratio = contrastRatio(color, effectiveBackground);
    if (ratio < 4.5) {
      issues.push({
        file: filePath,
        line: lineNumberForIndex(source, match.index),
        contrast_ratio: Number(ratio.toFixed(2)),
        color: colorMatch[1],
        background: backgroundMatch[1],
        fixable: !protectedFiles.has(filePath),
      });
    }
  }
  return issues;
}

function findFocusIndicatorRisks(cssSource) {
  const issues = [];
  const lines = cssSource.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/outline\s*:\s*(?:none|0)/.test(line)) continue;
    issues.push({
      file: cssPath,
      line: index + 1,
      snippet: line.trim(),
      fixable: false,
    });
  }
  return issues;
}

const files = listFiles(srcRoot);
const sources = files.map((filePath) => ({ filePath, source: readFileSync(filePath, 'utf8') }));
const buttonIssues = sources.flatMap(({ filePath, source }) => findButtonsWithoutLabels(filePath, source));
const formLabelIssues = sources.flatMap(({ filePath, source }) => findInputsWithoutLabels(filePath, source));
const keyboardIssues = sources.flatMap(({ filePath, source }) => findClickableNonInteractive(filePath, source));
const optionCardIssues = sources.flatMap(({ filePath, source }) => findOptionCardRisks(filePath, source));
const contrastRisks = sources.flatMap(({ filePath, source }) => findContrastRisks(filePath, source));
const focusIndicatorRisks = findFocusIndicatorRisks(readFileSync(cssPath, 'utf8'));
const skipLinkPresent = readFileSync(path.join(srcRoot, 'App.jsx'), 'utf8').includes('href="#main-content"');

const report = {
  timestamp: new Date().toISOString(),
  scanned_files: files.length,
  checks: {
    skip_link_present: skipLinkPresent,
    buttons_without_labels: buttonIssues.length,
    form_controls_without_labels: formLabelIssues.length,
    keyboard_navigation_risks: keyboardIssues.length,
    option_card_semantics_risks: optionCardIssues.length,
    focus_indicator_risks: focusIndicatorRisks.length,
    low_contrast_risks: contrastRisks.length,
  },
  buttons_without_labels: buttonIssues,
  form_controls_without_labels: formLabelIssues,
  keyboard_navigation_risks: keyboardIssues,
  option_card_semantics_risks: optionCardIssues,
  focus_indicator_risks: focusIndicatorRisks,
  low_contrast_risks: contrastRisks,
  limitations: [
    'Contrast checks cover static inline style pairs with hardcoded colors; CSS-variable-driven themes still need manual review.',
    'Protected files were audited and reported, but not modified in this sprint.',
  ],
};

atomicWrite(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log('=== ACCESSIBILITY REPORT ===');
console.log(`Skip link present: ${skipLinkPresent ? 'yes' : 'no'}`);
console.log(`Buttons without labels: ${buttonIssues.length}`);
console.log(`Form controls without labels: ${formLabelIssues.length}`);
console.log(`Keyboard navigation risks: ${keyboardIssues.length}`);
console.log(`Option card semantics risks: ${optionCardIssues.length}`);
console.log(`Focus indicator risks: ${focusIndicatorRisks.length}`);
console.log(`Low contrast risks: ${contrastRisks.length}`);
