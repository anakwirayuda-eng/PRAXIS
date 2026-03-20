import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

const ORGAN_SYSTEMS = {
  cardiovascular: [
    'heart', 'cardiac', 'myocardial', 'coronary', 'atrial', 'ventricular', 'ecg', 'ekg',
    'murmur', 'hypertension', 'aortic', 'mitral', 'pericardial', 'endocarditis', 'chf',
    'arrhythmia', 'angina', 'stemi', 'nstemi', 'valve', 'blood pressure', 'cardiovascular',
    'cardiology',
  ],
  respiratory: [
    'lung', 'pulmonary', 'bronchial', 'pneumonia', 'asthma', 'copd', 'tuberculosis',
    'pleural', 'dyspnea', 'cough', 'spo2', 'trachea', 'hypoxia', 'hemoptysis',
    'respiratory', 'pulmonology',
  ],
  gastrointestinal: [
    'liver', 'hepatic', 'gastric', 'intestinal', 'colon', 'pancreas', 'biliary', 'cirrhosis',
    'jaundice', 'diarrhea', 'vomiting', 'appendicitis', 'gerd', 'hepatitis', 'abdomen',
    'gastrointestinal', 'gastroenterology',
  ],
  renal: [
    'kidney', 'renal', 'nephro', 'urinary', 'gfr', 'creatinine', 'dialysis', 'proteinuria',
    'nephrotic', 'nephritic', 'hematuria', 'glomerular', 'nephrology',
  ],
  neurological: [
    'brain', 'cerebral', 'stroke', 'seizure', 'epilepsy', 'meningitis', 'neuropathy',
    'dementia', 'parkinson', 'multiple sclerosis', 'headache', 'cranial nerve', 'ataxia',
    'neurology',
  ],
  endocrine: [
    'thyroid', 'diabetes', 'insulin', 'adrenal', 'pituitary', 'cortisol', 'cushing',
    'addison', 'growth hormone', 'tsh', 'hba1c', 'hyperglycemia', 'hypoglycemia',
    'endocrine', 'endocrinology',
  ],
  musculoskeletal: [
    'bone', 'joint', 'fracture', 'arthritis', 'osteoporosis', 'muscle', 'tendon', 'ligament',
    'rheumatoid', 'sprain', 'osteoarthritis', 'orthopedic', 'orthopaedic', 'rheumatology',
  ],
  hematology: [
    'anemia', 'leukemia', 'lymphoma', 'platelet', 'coagulation', 'hemoglobin', 'transfusion',
    'sickle cell', 'thalassemia', 'bleeding', 'thrombocytopenia', 'clotting', 'hematology',
    'haematology',
  ],
  infectious: [
    'infection', 'bacterial', 'viral', 'fungal', 'antibiotic', 'hiv', 'aids', 'sepsis',
    'fever', 'malaria', 'tuberculosis', 'antiviral', 'antimicrobial', 'infectious disease',
  ],
  dermatology: [
    'skin', 'rash', 'lesion', 'dermatitis', 'psoriasis', 'melanoma', 'eczema', 'urticaria',
    'vesicle', 'bullous', 'dermatology',
  ],
  obstetrics: [
    'pregnancy', 'pregnant', 'fetal', 'gestational', 'trimester', 'delivery', 'labor',
    'preeclampsia', 'ectopic', 'postpartum', 'placenta', 'obstetrics', 'obgyn',
  ],
  gynecology: [
    'uterus', 'ovarian', 'cervical', 'menstrual', 'endometriosis', 'pcos', 'pap smear',
    'fibroid', 'vaginal bleeding', 'gynecology', 'gynaecology',
  ],
  pediatrics: [
    'child', 'infant', 'neonatal', 'newborn', 'pediatric', 'growth', 'milestone',
    'vaccination', 'congenital', 'adolescent', 'pediatrics', 'paediatrics',
  ],
  psychiatry: [
    'depression', 'anxiety', 'schizophrenia', 'bipolar', 'psychosis', 'antidepressant',
    'suicide', 'ptsd', 'mania', 'panic attack', 'psychiatry',
  ],
  ophthalmology: [
    'eye', 'vision', 'retina', 'glaucoma', 'cataract', 'optic', 'fundoscopy', 'macula',
    'conjunctiva', 'ophthalmology',
  ],
  ENT: [
    'ear', 'hearing', 'tinnitus', 'sinusitis', 'pharyngitis', 'tonsil', 'larynx', 'otitis',
    'nasal', 'throat', 'ent', 'otolaryngology',
  ],
  urology: [
    'prostate', 'bladder', 'ureter', 'testicular', 'psa', 'bph', 'scrotal', 'kidney stone',
    'urology',
  ],
  immunology: [
    'autoimmune', 'allergy', 'ige', 'lupus', 'complement', 'immunodeficiency',
    'hypersensitivity', 'anaphylaxis', 'immunology',
  ],
  pharmacology: [
    'drug', 'medication', 'dose', 'mechanism of action', 'side effect', 'adverse',
    'contraindicate', 'pharmacokinetics', 'toxicity', 'interaction', 'pharmacology',
  ],
  public_health: [
    'epidemiology', 'prevalence', 'incidence', 'screening', 'prevention', 'vaccination',
    'mortality rate', 'public health', 'risk factor', 'cohort', 'case control',
    'community medicine',
  ],
};

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeComparable(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureMeta(caseRecord) {
  if (!caseRecord.meta || typeof caseRecord.meta !== 'object') {
    caseRecord.meta = {};
  }

  return caseRecord.meta;
}

function writeJsonAtomically(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempFile, filePath);
}

function formatCount(value) {
  return value.toLocaleString('en-US');
}

function getSearchText(caseRecord) {
  const pieces = [
    caseRecord.question,
    caseRecord.vignette?.narrative,
    ...(Array.isArray(caseRecord.options) ? caseRecord.options.map((option) => option?.text) : []),
    ...(Array.isArray(caseRecord?.meta?.tags) ? caseRecord.meta.tags : []),
  ];

  return ` ${normalizeComparable(pieces.filter(Boolean).join(' '))} `;
}

function getExistingTags(caseRecord) {
  return Array.isArray(caseRecord?.meta?.tags)
    ? caseRecord.meta.tags.map((tag) => normalizeComparable(tag)).filter(Boolean)
    : [];
}

function scoreOrganSystems(searchText) {
  const scores = [];

  for (const [organSystem, keywords] of Object.entries(ORGAN_SYSTEMS)) {
    const matchedKeywords = [];

    for (const keyword of keywords) {
      const normalizedKeyword = normalizeComparable(keyword);
      if (!normalizedKeyword) {
        continue;
      }

      const needle = ` ${normalizedKeyword} `;
      if (searchText.includes(needle)) {
        matchedKeywords.push(normalizedKeyword);
      }
    }

    scores.push({
      organSystem,
      score: matchedKeywords.length,
      matchedKeywords,
    });
  }

  scores.sort((left, right) =>
    right.score - left.score || left.organSystem.localeCompare(right.organSystem),
  );

  return scores[0];
}

function tagsAlreadyCoverMatch(existingTags, organSystem, matchedKeywords) {
  if (existingTags.length === 0) {
    return false;
  }

  const normalizedOrganSystem = normalizeComparable(organSystem.replace(/_/g, ' '));
  if (existingTags.some((tag) => tag.includes(normalizedOrganSystem) || normalizedOrganSystem.includes(tag))) {
    return true;
  }

  return matchedKeywords.every((keyword) =>
    existingTags.some((tag) => tag === keyword || tag.includes(keyword) || keyword.includes(tag)),
  );
}

function main() {
  const cases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const countsBySystem = new Map();
  let changedCases = 0;

  for (const caseRecord of cases) {
    const meta = ensureMeta(caseRecord);
    const existingTags = getExistingTags(caseRecord);
    const bestMatch = scoreOrganSystems(getSearchText(caseRecord));
    const organSystem = bestMatch.score > 0 ? bestMatch.organSystem : 'general';
    const nextKeywords = bestMatch.score > 0 ? bestMatch.matchedKeywords.slice(0, 8) : [];
    const tagsCoverMatch = tagsAlreadyCoverMatch(existingTags, organSystem, nextKeywords);
    let changed = false;

    if (meta.organ_system !== organSystem) {
      meta.organ_system = organSystem;
      changed = true;
    }

    if (!tagsCoverMatch) {
      const currentKeywords = Array.isArray(meta.topic_keywords) ? meta.topic_keywords : [];
      const normalizedCurrentKeywords = currentKeywords.map((keyword) => normalizeComparable(keyword));
      const nextComparable = nextKeywords.join('|');
      const currentComparable = normalizedCurrentKeywords.join('|');
      if (nextComparable !== currentComparable) {
        meta.topic_keywords = nextKeywords;
        changed = true;
      }
    } else if (Array.isArray(meta.topic_keywords) && meta.topic_keywords.length > 0) {
      meta.topic_keywords = [];
      changed = true;
    }

    if (changed) {
      changedCases += 1;
    }

    countsBySystem.set(organSystem, (countsBySystem.get(organSystem) ?? 0) + 1);
  }

  writeJsonAtomically(DATA_FILE, cases);

  console.log('=== TOPIC TAGGING ===');
  console.log(`Cases scanned: ${formatCount(cases.length)}`);
  console.log(`Cases updated: ${formatCount(changedCases)}`);
  for (const [organSystem, count] of [...countsBySystem.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0]),
  )) {
    console.log(`  ${organSystem}: ${formatCount(count)}`);
  }
}

main();
