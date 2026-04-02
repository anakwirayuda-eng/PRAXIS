const UNCLASSIFIED_CATEGORY = 'Unclassified';

const DEFAULT_SOURCE_PROFILE = {
  raw: 4,
  subject: 3,
  tags: 3,
  topic: 3,
  organ: 3,
  prefix: 2,
  keyword: 1,
  narrative: 2,
  options: 1,
};

const SOURCE_RESOLUTION_PROFILES = {
  medmcqa: {
    raw: 4,
    prefix: 2,
  },
  medqa: {
    raw: 1,
    prefix: 0,
    organ: 3,
    topic: 3,
    narrative: 2,
  },
  headqa: {
    raw: 1,
    prefix: 0,
    organ: 3,
    topic: 2,
    narrative: 1,
  },
  pedmedqa: {
    raw: 0,
    prefix: 0,
    organ: 4,
    topic: 4,
    narrative: 2,
  },
  'polish ldek en': {
    raw: 1,
    prefix: 0,
    organ: 1,
    topic: 1,
    narrative: 2,
    options: 2,
  },
  'tw medqa': {
    raw: 1,
    prefix: 0,
    organ: 2,
    topic: 2,
    narrative: 2,
  },
  'fk leaked ukmppd': {
    raw: 2,
    prefix: 1,
    organ: 2,
    topic: 3,
    narrative: 2,
  },
  'ukmppd pdf': {
    raw: 2,
    prefix: 0,
    narrative: 2,
  },
  pubmedqa: {
    raw: 2,
    prefix: 0,
    narrative: 2,
  },
};

const BROAD_RAW_CATEGORIES = new Set([
  'Ilmu Penyakit Dalam',
  'Bedah',
]);

const ALWAYS_DEMOTE_RAW_SOURCES = new Set([
  'pedmedqa',
]);

const CATEGORY_ALIASES = {
  'Ilmu Penyakit Dalam': [
    'Ilmu Penyakit Dalam',
    'Penyakit Dalam',
    'internal-medicine',
    'internal medicine',
    'medicine',
    'cardiology',
    'pulmonology',
    'pneumology',
    'gastroenterology',
    'digestive system',
    'digestive tract',
    'endocrinology',
    'hematology',
    'nephrology',
    'rheumatology',
    'infectology',
    'allergology',
    'infectious diseases',
    'infectious disease',
    'medical oncology',
    'oncology',
    'geriatrics',
    'hematologi & infeksi',
    'endokrinologi',
    'kardiologi',
    'pulmonologi',
    'gastroenterohepatologi',
    'nefrologi',
    'onkologi',
  ],
  Bedah: [
    'Bedah',
    'surgery',
    'general surgery',
    'orthopedics',
    'orthopaedics',
    'orthopedic surgery and traumatology',
    'traumatology and orthopedics',
    'traumatology',
    'urology',
    'bedah saraf',
    'neurosurgery',
    'plastic surgery',
    'anesthesia',
  ],
  'Obstetri & Ginekologi': [
    'Obstetri & Ginekologi',
    'obgyn',
    'ob/gyn',
    'obstetrics and gynecology',
    'gynecology and obstetrics',
    'gynecology',
    'obstetrics',
    'gynaecology & obstetrics',
    'o&g',
  ],
  'Ilmu Kesehatan Anak': [
    'Ilmu Kesehatan Anak',
    'Anak',
    'pediatrics',
    'pediatri',
    'pediatrics and neonatology',
  ],
  Neurologi: [
    'Neurologi',
    'Saraf',
    'neurology',
    'neurology and neurosurgery',
    'neurology and thoracic surgery',
  ],
  Psikiatri: [
    'Psikiatri',
    'psychiatry',
    'psychiatry and behavioral sciences',
    'PSI',
    'professional_psychology',
  ],
  'Anestesi & Emergency Medicine': [
    'Anestesi & Emergency Medicine',
    'Anestesi',
    'Anestesi & Emergency',
    'Emergency Medicine',
    'emergency',
    'anesthesiology',
    'anesthesiology and critical care',
    'critical care',
    'critical care and emergency',
    'critical and emergency care',
    'palliative care',
  ],
  'Ilmu Kesehatan Masyarakat': [
    'Ilmu Kesehatan Masyarakat',
    'IKM',
    'IKM & Kesmas',
    'public-health',
    'public health',
    'preventive medicine',
    'preventive medicine and epidemiology',
    'epidemiology',
    'primary care',
    'biostatistics',
    'statistics',
    'evidence-based medicine',
    'nutrition',
    'social & preventive medicine',
    'preventive & social medicine',
    'psm',
  ],
  Radiologi: [
    'Radiologi',
    'radiology',
  ],
  Mata: [
    'Mata',
    'ophthalmology',
  ],
  THT: [
    'THT',
    'ent',
    'otorhinolaryngology',
    'otolaryngology',
    'tht-kl',
  ],
  'Kulit & Kelamin': [
    'Kulit & Kelamin',
    'Kulit',
    'dermatology',
    'dermatology and plastic surgery',
    'dermatology, venereology and plastic surgery',
    'dermatovenereologi',
  ],
  Forensik: [
    'Forensik',
    'Medikolegal',
    'forensic medicine',
    'legal medicine',
    'medicolegal',
    'forensik & medikolegal',
  ],
  Farmakologi: [
    'Farmakologi',
    'pharmacology',
  ],
  Anatomi: [
    'Anatomi',
    'anatomy',
    'anatomi & fisiologi',
  ],
  'Kedokteran Gigi': [
    'Kedokteran Gigi',
    'dentistry',
    'dental',
  ],
  Biokimia: [
    'Biokimia',
    'biochemistry',
    'genetics',
    'genetics and immunology',
  ],
  Mikrobiologi: [
    'Mikrobiologi',
    'microbiology',
    'virology',
  ],
  'Patologi Anatomi': [
    'Patologi Anatomi',
    'Patologi',
    'pathological anatomy',
    'anatomic pathology',
    'pathology',
  ],
  'Rehabilitasi Medik': [
    'Rehabilitasi Medik',
    'rehabilitation medicine',
    'rehab medicine',
    'physical medicine and rehabilitation',
  ],
  [UNCLASSIFIED_CATEGORY]: [
    'Unclassified',
    'unknown',
    'misc',
    'general',
  ],
};

const CASE_CODE_PREFIX_MAP = {
  IPD: 'Ilmu Penyakit Dalam',
  BDH: 'Bedah',
  OBG: 'Obstetri & Ginekologi',
  IKA: 'Ilmu Kesehatan Anak',
  PSI: 'Psikiatri',
  RAD: 'Radiologi',
  MAT: 'Mata',
  THT: 'THT',
  FOR: 'Forensik',
  FAR: 'Farmakologi',
  ANT: 'Anatomi',
  GIG: 'Kedokteran Gigi',
  BIO: 'Biokimia',
  MKB: 'Mikrobiologi',
  PAT: 'Patologi Anatomi',
  RHB: 'Rehabilitasi Medik',
  IKM: 'Ilmu Kesehatan Masyarakat',
};

const CATEGORY_KEYWORDS = {
  'Ilmu Penyakit Dalam': [
    'internal medicine', 'cardiology', 'gastroenterology', 'endocrinology', 'nephrology',
    'rheumatology', 'hematology', 'pulmonology', 'infectious disease', 'hepatology',
    'geriatric', 'afib', 'copd', 'ckd', 'cardiovascular', 'gastrointestinal',
    'endocrine', 'respiratory', 'renal', 'infectious', 'hemodialysis',
  ],
  Bedah: [
    'surgery', 'surgical', 'appendectomy', 'appendicitis', 'orthopedic', 'orthopaedic',
    'fracture', 'laparotomy', 'urology', 'neurosurgery', 'hernia', 'trauma',
    'musculoskeletal', 'postoperative', 'arthroscopy', 'arthroplasty',
  ],
  'Obstetri & Ginekologi': [
    'obstetric', 'obstetrics', 'gynecology', 'gynaecology', 'preeclampsia',
    'antenatal', 'postpartum', 'labor', 'delivery', 'placenta', 'menstrual',
    'amenorrhea', 'ectopic pregnancy', 'gynecology', 'obstetrics',
  ],
  'Ilmu Kesehatan Anak': [
    'pediatric', 'pediatrics', 'paediatric', 'neonate', 'newborn', 'infant',
    'child', 'breast milk', 'immunization', 'adolescent', 'adolescence',
  ],
  Neurologi: [
    'neurology', 'stroke', 'seizure', 'epilepsy', 'neuropathy', 'parkinson',
    'migraine', 'cranial nerve', 'neurological',
  ],
  Psikiatri: [
    'psychiatry', 'psychiatric', 'depression', 'schizophrenia', 'bipolar',
    'psychosis', 'suicide', 'ptsd', 'ocd',
  ],
  'Anestesi & Emergency Medicine': [
    'emergency', 'anaphylaxis', 'shock', 'resuscitation', 'airway', 'critical care',
    'anesthesia', 'anesthesiology', 'cardiac arrest',
  ],
  'Ilmu Kesehatan Masyarakat': [
    'public health', 'epidemiology', 'biostatistics', 'screening', 'outbreak',
    'prevention', 'surveillance', 'community medicine', 'psm', 'public_health',
    'community participation', 'health promotion',
  ],
  Radiologi: [
    'radiology', 'ct scan', 'mri', 'x ray', 'x-ray', 'ultrasonography',
    'ultrasound', 'imaging', 'contrast study',
  ],
  Mata: [
    'ophthalmology', 'eye', 'retina', 'glaucoma', 'cataract', 'uveitis',
    'cornea', 'retinoscopy',
  ],
  THT: [
    'ent', 'otorhinolaryngology', 'otolaryngology', 'sinus', 'larynx', 'ear',
    'nasal', 'throat', 'otitis', 'tympanic', 'hearing', 'ENT',
  ],
  'Kulit & Kelamin': [
    'dermatology', 'skin', 'venereology', 'dermatitis', 'psoriasis', 'urticaria',
    'pemphigus', 'std', 'sti', 'dermatological',
  ],
  Forensik: [
    'forensic', 'medicolegal', 'autopsy', 'toxicology', 'putrefaction',
    'postmortem', 'dna testing', 'visum',
  ],
  Farmakologi: [
    'pharmacology', 'drug', 'agonist', 'antagonist', 'receptor', 'dose response',
    'half life', 'bioavailability',
  ],
  Anatomi: [
    'anatomy', 'artery', 'vein', 'nerve', 'bone', 'muscle', 'ligament',
    'sacrum', 'foramen',
  ],
  'Kedokteran Gigi': [
    'dental', 'dentistry', 'tooth', 'teeth', 'gingiva', 'gingival', 'periodont',
    'orthodont', 'endodont', 'prosthodont', 'cej', 'tmj', 'plaque', 'enamel',
    'dentin', 'pulp', 'malocclusion', 'steiner', 'maxilla', 'maxillary',
    'mandible', 'mandibular', 'molar', 'incisor', 'canine', 'premolar',
    'occlusal', 'root canal', 'rubber dam', 'caries', 'alveolar', 'pulpitis',
    'periodontal pocket', 'oral cavity', 'orthodontic band',
  ],
  Biokimia: [
    'biochemistry', 'enzyme', 'metabolism', 'amino acid', 'dna', 'rna',
    'glycolysis', 'krebs cycle',
  ],
  Mikrobiologi: [
    'microbiology', 'bacteriology', 'virology', 'fungus', 'parasite', 'gram stain',
    'culture media', 'rhinovirus', 'interferon', 'viral replication',
  ],
  'Patologi Anatomi': [
    'pathology', 'histopathology', 'biopsy', 'neoplasia', 'microscopy',
    'gross specimen',
  ],
  'Rehabilitasi Medik': [
    'rehabilitation', 'physiotherapy', 'occupational therapy', 'rehab medicine',
    'functional recovery',
  ],
};

const POLISH_LDEK_DENTAL_PROMOTION_MATCHES = new Set([
  'dental',
  'dentistry',
  'tooth',
  'teeth',
  'enamel',
  'dentin',
  'dentine',
  'pulp',
  'gingiva',
  'gingival',
  'periodont',
  'periodontal',
  'orthodont',
  'endodont',
  'prosthodont',
  'occlusal',
  'caries',
  'root canal',
  'molar',
  'premolar',
  'incisor',
  'canine',
  'fluorosis',
  'dentition',
  'deciduous',
  'papilla',
  'alveolar',
  'buccal',
  'cephalometric',
  'rubber dam',
  'oral cavity',
  'pulpitis',
  'pellicle',
  'whitening',
  'apical',
  'malocclusion',
  'orthognathic',
  'denture',
  'mucocele',
  'maxilla',
  'maxillary',
  'mandible',
  'mandibular',
  'odontogenic',
  'articulator',
].map((term) => normalizeText(term)));

const HIGH_CONFIDENCE_THRESHOLD = 5;
const HIGH_CONFIDENCE_LEAD = 2;
const MEDIUM_CONFIDENCE_THRESHOLD = 3;
const MEDIUM_CONFIDENCE_LEAD = 2;

const EXACT_ALIAS_INDEX = new Map();
for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
  for (const alias of aliases) {
    EXACT_ALIAS_INDEX.set(normalizeText(alias), category);
  }
  EXACT_ALIAS_INDEX.set(normalizeText(category), category);
}

export { CASE_CODE_PREFIX_MAP, CATEGORY_ALIASES, CATEGORY_KEYWORDS, UNCLASSIFIED_CATEGORY };

export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isKnownCategory(category) {
  return Boolean(category && EXACT_ALIAS_INDEX.has(normalizeText(category)) && normalizeCategoryExact(category) !== UNCLASSIFIED_CATEGORY);
}

export function normalizeCategoryExact(value) {
  if (!value) return null;
  return EXACT_ALIAS_INDEX.get(normalizeText(value)) || null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatches(normalizedText, normalizedKeyword) {
  if (!normalizedText || !normalizedKeyword) return false;

  if (normalizedKeyword.includes(' ') || normalizedKeyword.length <= 4) {
    const pattern = new RegExp(`(?:^| )${escapeRegExp(normalizedKeyword)}(?:$| )`);
    return pattern.test(normalizedText);
  }

  return normalizedText.includes(normalizedKeyword);
}

function addSignal(scoreMap, signalMap, category, weight, source, match) {
  if (!category || category === UNCLASSIFIED_CATEGORY) return;
  scoreMap.set(category, (scoreMap.get(category) || 0) + weight);
  const existing = signalMap.get(category) || [];
  if (!existing.some((item) => item.source === source && item.match === match)) {
    existing.push({ source, weight, match });
    signalMap.set(category, existing);
  }
}

function collectKeywordSignals(text, source, weight, scoreMap, signalMap) {
  const normalized = normalizeText(text);
  if (!normalized) return;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const match = keywords.find((keyword) => keywordMatches(normalized, normalizeText(keyword)));
    if (match) {
      addSignal(scoreMap, signalMap, category, weight, source, match);
    }
  }
}

function collectTagSignals(tags, scoreMap, signalMap, weight = 3, source = 'tags') {
  if (!Array.isArray(tags)) return;
  const normalizedTags = tags
    .map((tag) => normalizeText(tag))
    .filter(Boolean);
  if (normalizedTags.length === 0) return;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const match = keywords.find((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      return normalizedTags.some((tag) => keywordMatches(tag, normalizedKeyword) || keywordMatches(normalizedKeyword, tag));
    });
    if (match) {
      addSignal(scoreMap, signalMap, category, weight, source, match);
    }
  }
}

function extractCaseCodePrefix(caseCode) {
  const normalized = String(caseCode || '').trim().toUpperCase();
  const sourceAwareMatch = /^[A-Z0-9]+-([A-Z]+)-/.exec(normalized);
  if (sourceAwareMatch) return sourceAwareMatch[1];

  const legacyMatch = /^MMC-([A-Z]+)-/.exec(normalized);
  return legacyMatch ? legacyMatch[1] : null;
}

function getSourceProfile(source) {
  const key = normalizeText(source);
  return {
    ...DEFAULT_SOURCE_PROFILE,
    ...(SOURCE_RESOLUTION_PROFILES[key] || {}),
  };
}

function getRawWeight(source, rawCategory, profile) {
  if (!rawCategory) return 0;
  const sourceKey = normalizeText(source);
  if (ALWAYS_DEMOTE_RAW_SOURCES.has(sourceKey)) {
    return profile.raw;
  }
  return BROAD_RAW_CATEGORIES.has(rawCategory) ? profile.raw : DEFAULT_SOURCE_PROFILE.raw;
}

function getNarrative(caseData) {
  return caseData?.vignette?.narrative
    || caseData?.question
    || caseData?.meta?.narrative
    || '';
}

function getOptionCorpus(caseData) {
  const options = Array.isArray(caseData?.options) ? caseData.options : [];
  return options
    .map((option) => option?.text ?? option?.option_text ?? '')
    .filter(Boolean)
    .join(' ');
}

function hasPromotionSignal(signals, allowedMatches) {
  if (!Array.isArray(signals) || signals.length === 0) return false;
  return signals.some((signal) => allowedMatches.has(normalizeText(signal?.match)));
}

function getCategoryPromotion(caseData, resolution) {
  const sourceKey = normalizeText(caseData?.source || caseData?.meta?.source || '');
  if (sourceKey !== 'polish ldek en') return null;
  if (resolution.resolved_category !== 'Kedokteran Gigi') return null;
  if (resolution.confidence !== 'low') return null;
  if (!hasPromotionSignal(resolution.winning_signals, POLISH_LDEK_DENTAL_PROMOTION_MATCHES)) return null;

  const hasConsensus = Array.isArray(resolution.winning_signals)
    && resolution.winning_signals.some((signal) => signal?.source === 'content-consensus');

  if (resolution.runner_up_score <= 2) {
    return {
      rule: 'polish_ldek_dental_runner2',
      confidence: 'high',
    };
  }

  if (resolution.runner_up_score <= 4 && hasConsensus) {
    return {
      rule: 'polish_ldek_dental_consensus4',
      confidence: 'high',
    };
  }

  return null;
}

export function resolveCaseCategory(caseData) {
  const existingResolution = caseData?.meta?.category_resolution && typeof caseData.meta.category_resolution === 'object'
    ? caseData.meta.category_resolution
    : null;
  const rawCategory = existingResolution?.raw_category ?? caseData?.category ?? null;
  const rawNormalized = normalizeCategoryExact(rawCategory);
  const source = caseData?.source || caseData?.meta?.source || null;
  const profile = getSourceProfile(source);
  const scoreMap = new Map();
  const signalMap = new Map();

  const rawWeight = getRawWeight(source, rawNormalized, profile);
  if (rawNormalized && rawWeight > 0) {
    addSignal(scoreMap, signalMap, rawNormalized, rawWeight, 'raw', rawCategory);
  }

  const subject = caseData?.subject_name || caseData?.subject || caseData?.meta?.subject || caseData?.meta?.subject_name || null;
  const normalizedSubject = normalizeCategoryExact(subject);
  if (normalizedSubject) {
    addSignal(scoreMap, signalMap, normalizedSubject, profile.subject, 'subject', subject);
  } else {
    collectKeywordSignals(subject, 'subject', profile.subject, scoreMap, signalMap);
  }

  collectTagSignals(caseData?.meta?.tags, scoreMap, signalMap, profile.tags, 'tags');
  collectTagSignals(caseData?.meta?.topic_keywords, scoreMap, signalMap, profile.topic, 'topic_keywords');
  if (caseData?.meta?.organ_system) {
    collectTagSignals([caseData.meta.organ_system], scoreMap, signalMap, profile.organ, 'organ_system');
  }

  const prefix = extractCaseCodePrefix(caseData?.case_code);
  const prefixCategory = prefix ? CASE_CODE_PREFIX_MAP[prefix] : null;
  if (prefixCategory && prefixCategory !== rawNormalized && profile.prefix > 0) {
    addSignal(scoreMap, signalMap, prefixCategory, profile.prefix, 'prefix', prefix);
  }

  const titlePromptCorpus = [caseData?.title, caseData?.prompt, caseData?.topic, caseData?.subject_name, caseData?.subject]
    .filter(Boolean)
    .join(' ');
  collectKeywordSignals(titlePromptCorpus, 'keyword', profile.keyword, scoreMap, signalMap);

  const narrativeCorpus = getNarrative(caseData);
  collectKeywordSignals(narrativeCorpus, 'narrative', profile.narrative, scoreMap, signalMap);

  const optionCorpus = getOptionCorpus(caseData);
  collectKeywordSignals(optionCorpus, 'options', profile.options, scoreMap, signalMap);

  for (const [category, signals] of signalMap.entries()) {
    const contentSources = new Set(
      signals
        .map((signal) => signal.source)
        .filter((source) => source !== 'raw' && source !== 'prefix'),
    );
    if (contentSources.size >= 2) {
      addSignal(scoreMap, signalMap, category, 2, 'content-consensus', [...contentSources].join('+'));
    }
  }

  const ranked = [...scoreMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [winnerCategory, winnerScore] = ranked[0] || [rawNormalized || UNCLASSIFIED_CATEGORY, 0];
  const [runnerUpCategory, runnerUpScore = 0] = ranked[1] || [null, 0];

  let confidence = 'low';
  if (winnerScore >= HIGH_CONFIDENCE_THRESHOLD && winnerScore - runnerUpScore >= HIGH_CONFIDENCE_LEAD) {
    confidence = 'high';
  } else if (winnerScore >= MEDIUM_CONFIDENCE_THRESHOLD && winnerScore - runnerUpScore >= MEDIUM_CONFIDENCE_LEAD) {
    confidence = 'medium';
  }

  const categoryConflict = Boolean(
    (rawNormalized && winnerCategory && rawNormalized !== winnerCategory)
    || runnerUpScore >= 3
  );

  return {
    raw_category: rawCategory,
    raw_normalized_category: rawNormalized,
    resolved_category: winnerCategory || rawNormalized || UNCLASSIFIED_CATEGORY,
    confidence,
    category_conflict: categoryConflict,
    winning_signals: signalMap.get(winnerCategory) || [],
    runner_up_category: runnerUpCategory,
    runner_up_score: runnerUpScore,
    prefix,
    scores: Object.fromEntries(ranked),
  };
}

export function applyResolvedCategory(caseData) {
  const resolution = resolveCaseCategory(caseData);
  const promotion = getCategoryPromotion(caseData, resolution);
  const effectiveConfidence = promotion?.confidence || resolution.confidence;
  const existingResolution = caseData?.meta?.category_resolution && typeof caseData.meta.category_resolution === 'object'
    ? caseData.meta.category_resolution
    : null;
  const preservedRawCategory = existingResolution?.raw_category ?? resolution.raw_category;
  const preservedRawNormalized = existingResolution?.raw_normalized_category ?? resolution.raw_normalized_category;
  const validRaw = preservedRawNormalized;
  let finalCategory = validRaw || UNCLASSIFIED_CATEGORY;

  if (effectiveConfidence === 'high') {
    finalCategory = resolution.resolved_category || finalCategory;
  } else if (!validRaw) {
    finalCategory = UNCLASSIFIED_CATEGORY;
  }

  const reviewNeeded = effectiveConfidence !== 'high'
    && (resolution.category_conflict || finalCategory === UNCLASSIFIED_CATEGORY);

  return {
    ...caseData,
    category: finalCategory,
    meta: {
      ...(caseData?.meta || {}),
      category_review_needed: reviewNeeded,
      category_resolution: {
        raw_category: preservedRawCategory,
        raw_normalized_category: preservedRawNormalized,
        resolved_category: resolution.resolved_category,
        confidence: effectiveConfidence,
        base_confidence: resolution.confidence,
        category_conflict: resolution.category_conflict,
        winning_signals: resolution.winning_signals,
        runner_up_category: resolution.runner_up_category,
        runner_up_score: resolution.runner_up_score,
        prefix: resolution.prefix,
        promotion_rule: promotion?.rule || null,
      },
    },
  };
}
