import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const casesPath = path.join(projectRoot, 'public', 'data', 'compiled_cases.json');
const outputDir = path.join(projectRoot, 'ingestion', 'output');
const reportPath = path.join(outputDir, 'contradiction_report.json');

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'which', 'what', 'when', 'where', 'while', 'who',
  'will', 'would', 'should', 'could', 'about', 'into', 'after', 'before', 'between', 'among', 'through',
  'during', 'under', 'over', 'your', 'their', 'there', 'these', 'those', 'them', 'then', 'than', 'been',
  'being', 'have', 'has', 'had', 'does', 'doing', 'done', 'into', 'such', 'most', 'least', 'more', 'less',
  'patient', 'patients', 'question', 'following', 'correct', 'incorrect', 'except', 'false', 'true', 'likely',
  'likely', 'diagnosis', 'diagnostic', 'treatment', 'management', 'therapy', 'condition', 'disease', 'syndrome',
  'clinical', 'findings', 'finding', 'present', 'presents', 'history', 'medical', 'medicine', 'best', 'next',
  'given', 'current', 'considering', 'regimen', 'profile', 'profiles', 'health', 'history', 'histories',
  'appropriate', 'option', 'options', 'cause', 'causes', 'associated', 'feature', 'features', 'most', 'common',
  'least', 'type', 'acute', 'chronic', 'year', 'years', 'month', 'months', 'week', 'weeks', 'days', 'hours',
  'male', 'female', 'woman', 'women', 'man', 'men', 'physician', 'doctor', 'provider', 'primary', 'care', 'clinic',
  'comes', 'come', 'visited', 'visit', 'visits', 'follow', 'followup', 'followed', 'brought', 'brought',
  'adalah', 'yang', 'dengan', 'untuk', 'pada', 'dari', 'dan', 'atau', 'pasien', 'tahun', 'dalam', 'pemeriksaan',
  'diagnosisnya', 'terapi', 'penatalaksanaan', 'manakah', 'berikut', 'seorang', 'wanita', 'pria', 'anak', 'usia',
  'datang', 'keluhan', 'nyeri', 'demam', 'batuk', 'sesak', 'mual', 'muntah', 'bengkak', 'lemah', 'laki', 'perempuan',
  'dibawa', 'diantar', 'dokter', 'klinik', 'rumah', 'sakit', 'puskesmas', 'igd', 'kanan', 'kiri', 'atas', 'bawah',
  'benjolan', 'sejak', 'hari', 'jam', 'minggu', 'bulan', 'berusia', 'gawat', 'darurat', 'unit', 'oleh', 'keluarga', 'keluarganya',
  'paciente', 'anos', 'años', 'tratamiento', 'diagnostico', 'diagnóstico', 'siguiente', 'correcta', 'falso',
  'verdadero', 'mujer', 'hombre', 'caso',
]);

function atomicWriteJson(targetPath, value) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tempPath, targetPath);
}

function pickQuestionText(caseData) {
  return [
    caseData.question,
    caseData.title,
    caseData.prompt,
    caseData.vignette?.narrative,
  ].find((value) => typeof value === 'string' && value.trim()) || '';
}

function normalizeAnswerText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^[a-z]\s*[\.\):]\s*/i, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAnswerTokens(value) {
  const ordinalMap = new Map([
    ['1st', 'first'],
    ['2nd', 'second'],
    ['3rd', 'third'],
    ['4th', 'fourth'],
  ]);
  return normalizeAnswerText(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => ordinalMap.get(token) || token)
    .map((token) => token.replace(/0/g, 'o'))
    .filter((token) => token !== 's')
    .map((token) => (token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token));
}

function editDistance(left, right) {
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[left.length][right.length];
}

function areEquivalentAnswers(leftTokens, rightTokens) {
  if (leftTokens.join(' ') === rightTokens.join(' ')) return true;
  if (leftTokens.length !== rightTokens.length || leftTokens.length < 2) return false;

  const remaining = [...rightTokens];
  let fuzzyMatches = 0;
  for (const token of leftTokens) {
    const exactIndex = remaining.indexOf(token);
    if (exactIndex >= 0) {
      remaining.splice(exactIndex, 1);
      continue;
    }

    const fuzzyIndex = remaining.findIndex((candidate) => {
      if (token.length < 4 || candidate.length < 4) return false;
      return editDistance(token, candidate) <= 1;
    });

    if (fuzzyIndex === -1) return false;
    remaining.splice(fuzzyIndex, 1);
    fuzzyMatches += 1;
  }

  return fuzzyMatches <= 1;
}

function extractFingerprintWords(caseData) {
  const text = pickQuestionText(caseData)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const seen = new Set();
  const candidates = [];
  text.split(' ').forEach((word, index) => {
    if (word.length < 4 || STOPWORDS.has(word) || seen.has(word)) return;
    seen.add(word);
    candidates.push({ word, length: word.length, index });
  });

  return candidates
    .sort((left, right) => right.length - left.length || left.index - right.index)
    .slice(0, 5)
    .map((entry) => entry.word)
    .sort();
}

function extractQuestionSignatureTokens(caseData) {
  return pickQuestionText(caseData)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word))
    .slice(0, 12);
}

function getCorrectOption(caseData) {
  const options = Array.isArray(caseData.options) ? caseData.options : [];
  return options.find((option) => option?.is_correct === true) || null;
}

function combinationKeys(words) {
  if (words.length < 4) return [];
  const keys = [];
  for (let a = 0; a < words.length - 3; a += 1) {
    for (let b = a + 1; b < words.length - 2; b += 1) {
      for (let c = b + 1; c < words.length - 1; c += 1) {
        for (let d = c + 1; d < words.length; d += 1) {
          keys.push([words[a], words[b], words[c], words[d]].join('|'));
        }
      }
    }
  }
  return keys;
}

function questionSimilarity(leftTokens, rightTokens) {
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array(size).fill(0);
  }

  find(value) {
    if (this.parent[value] !== value) {
      this.parent[value] = this.find(this.parent[value]);
    }
    return this.parent[value];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (this.rank[leftRoot] < this.rank[rightRoot]) {
      this.parent[leftRoot] = rightRoot;
      return;
    }
    if (this.rank[leftRoot] > this.rank[rightRoot]) {
      this.parent[rightRoot] = leftRoot;
      return;
    }
    this.parent[rightRoot] = leftRoot;
    this.rank[leftRoot] += 1;
  }
}

const startedAt = Date.now();
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
const descriptors = cases.map((caseData, index) => {
  const words = extractFingerprintWords(caseData);
  const correctOption = getCorrectOption(caseData);
  return {
    index,
    _id: caseData._id,
    stableId: caseData._id ?? caseData.case_code ?? caseData.hash_id ?? `row-${index}`,
    case_code: caseData.case_code || '',
    source: caseData.meta?.source || caseData.source || 'unknown',
    question: pickQuestionText(caseData),
    words,
    wordSet: new Set(words),
    signatureTokens: extractQuestionSignatureTokens(caseData),
    correctOptionId: correctOption?.id || null,
    correctAnswerTokens: normalizeAnswerTokens(correctOption?.text || ''),
    correctAnswer: normalizeAnswerText(correctOption?.text || ''),
  };
});

const unionFind = new UnionFind(descriptors.length);
const buckets = new Map();

for (const descriptor of descriptors) {
  if (descriptor.words.length < 4 || !descriptor.correctAnswer) continue;
  combinationKeys(descriptor.words).forEach((key) => {
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(descriptor.index);
    } else {
      buckets.set(key, [descriptor.index]);
    }
  });
}

for (const indices of buckets.values()) {
  if (indices.length < 2) continue;
  const [anchor, ...rest] = indices;
  rest.forEach((value) => {
    const left = descriptors[anchor];
    const right = descriptors[value];
    if (questionSimilarity(left.signatureTokens, right.signatureTokens) < 0.6) return;
    unionFind.union(anchor, value);
  });
}

const components = new Map();
for (const descriptor of descriptors) {
  if (descriptor.words.length < 4 || !descriptor.correctAnswer) continue;
  const root = unionFind.find(descriptor.index);
  const component = components.get(root);
  if (component) {
    component.push(descriptor);
  } else {
    components.set(root, [descriptor]);
  }
}

const contradictions = [];
const contradictionIndexes = new Set();
let candidateComponentsScanned = 0;

for (const component of components.values()) {
  if (component.length < 2) continue;
  candidateComponentsScanned += 1;

  const answerClusters = [];
  component.forEach((entry) => {
    const cluster = answerClusters.find((candidate) => areEquivalentAnswers(candidate.tokens, entry.correctAnswerTokens));
    if (cluster) {
      cluster.entries.push(entry);
      return;
    }
    answerClusters.push({ tokens: entry.correctAnswerTokens, entries: [entry] });
  });

  if (answerClusters.length < 2) continue;

  const sharedWords = component
    .map((entry) => entry.words)
    .reduce((shared, words) => shared.filter((word) => words.includes(word)));

  const fingerprint = (sharedWords.length >= 4 ? sharedWords : component[0].words).slice(0, 5).join(' ');
  const sources = new Set(component.map((entry) => entry.source));
  const severity = 'HIGH';

  const casesInGroup = component.map((entry) => {
    contradictionIndexes.add(entry.index);
    return {
      _id: entry._id,
      stable_id: entry.stableId,
      case_code: entry.case_code,
      correct: entry.correctAnswer,
      source: entry.source,
      question_excerpt: entry.question.slice(0, 180),
    };
  });

  contradictions.push({
    group_fingerprint: fingerprint,
    cases: casesInGroup,
    severity,
  });
}

let markedCases = 0;
if (contradictionIndexes.size > 0) {
  cases.forEach((caseData, index) => {
    if (!contradictionIndexes.has(index)) return;
    caseData.meta = caseData.meta && typeof caseData.meta === 'object' ? caseData.meta : {};
    if (caseData.meta.quarantine_reason && caseData.meta.quarantine_reason !== 'contradiction_detected') {
      caseData.meta.previous_quarantine_reason = caseData.meta.quarantine_reason;
    }
    caseData.meta.needs_review = true;
    caseData.meta.quarantine_reason = 'contradiction_detected';
    caseData.meta.contradiction_detected = true;
    markedCases += 1;
  });
  atomicWriteJson(casesPath, cases);
}

const report = {
  timestamp: new Date().toISOString(),
  total_groups_scanned: cases.length,
  candidate_components_scanned: candidateComponentsScanned,
  contradictions_found: contradictions.length,
  contradicted_cases_marked: markedCases,
  contradictions,
  runtime_ms: Date.now() - startedAt,
};

atomicWriteJson(reportPath, report);

console.log('=== CONTRADICTION REPORT ===');
console.log(`Cases scanned: ${cases.length}`);
console.log(`Candidate groups scanned: ${candidateComponentsScanned}`);
console.log(`Contradiction groups found: ${contradictions.length}`);
console.log(`Cases marked for review: ${markedCases}`);
console.log(`Runtime: ${Date.now() - startedAt} ms`);
