import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, 'server', 'data', 'casebank.db');
const OUTPUT_ROOT = path.join(ROOT, 'ingestion', 'output', 'category_ai_packs');
const DEFAULT_PACK_NAME = 'medmcqa-category-adjudication-wave1';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_PROFILE = 'wave1';
const DEFAULT_PACK_NAMES = {
  wave1: DEFAULT_PACK_NAME,
  wave2: 'medmcqa-category-adjudication-wave2',
  wave3: 'medmcqa-category-adjudication-wave3',
  wave4: 'medmcqa-category-adjudication-wave4',
  wave5: 'medmcqa-category-adjudication-wave5',
  wave6: 'medmcqa-category-adjudication-wave6',
  wave7: 'medmcqa-category-adjudication-wave7',
  wave8: 'medmcqa-category-adjudication-wave8',
  wave9: 'medmcqa-category-adjudication-wave9',
  wave10: 'medmcqa-category-adjudication-wave10',
  wave11: 'medmcqa-category-adjudication-wave11',
};

const RESPONSE_SCHEMA_HINT = {
  _id: 'numeric case id copied from payload',
  decision: 'PROMOTE_RUNNER_UP | KEEP_CURRENT | MANUAL_REVIEW',
  recommended_category: 'must be one of current_category, runner_up_category, or target_category when provided',
  confidence: 'HIGH | MEDIUM | LOW',
  reasoning: 'brief explanation grounded in stem semantics and metadata quality',
  evidence: ['flat list of short supporting points'],
};

const CATEGORY_ADJUDICATION_SYSTEM = [
  'You are adjudicating noisy medical exam category labels.',
  'Prefer semantic meaning of the stem over stale source labels.',
  'Do not invent a new category.',
  'Use current_category or runner_up_category as recommended_category, or target_category when it is provided.',
  'Choose PROMOTE_RUNNER_UP when the stem clearly belongs to runner_up_category or target_category.',
  'Choose KEEP_CURRENT when current_category is still more defensible.',
  'Choose MANUAL_REVIEW when evidence remains mixed.',
  `Return strict JSON only using this shape: ${JSON.stringify(RESPONSE_SCHEMA_HINT)}`,
].join('\n');

const WAVE1_BUCKETS = [
  {
    id: 'anatomy-core-vs-surgery-ipd-runner3',
    label: 'Core anatomy vs surgery from stale IPD raw labels',
    rationale: 'Core anatomy stems with only a plain anatomy tag where raw IPD barely beats a Bedah runner-up by one point.',
    focus: 'Decide whether this stem is still a broad internal-medicine item or should be promoted to surgery/bedah because the content is really orthopaedic or surgical anatomy.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Bedah'
        && Number(res.runner_up_score) <= 3
        && normalize(caseRecord.subject) === 'anatomy'
        && Array.isArray(meta.tags)
        && meta.tags.length === 1
        && hasTag(meta.tags, 'anatomy');
    },
  },
  {
    id: 'physiology-core-vs-surgery-ipd-runner3',
    label: 'Core physiology vs surgery from stale IPD raw labels',
    rationale: 'Plain physiology stems that currently sit in review against a Bedah runner-up.',
    focus: 'Decide whether the stem should remain in the current category or move to Bedah because the content is really surgical/clinical rather than physiology.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Bedah'
        && Number(res.runner_up_score) <= 3
        && normalize(caseRecord.subject) === 'physiology'
        && Array.isArray(meta.tags)
        && meta.tags.length === 1
        && hasTag(meta.tags, 'physiology');
    },
  },
  {
    id: 'general-anatomy-vs-anatomi-ipd-runner6',
    label: 'General anatomy stems held in IPD',
    rationale: 'Anatomy/general-anatomy stems where a broad IPD raw label still suppresses the Anatomi runner-up.',
    focus: 'Decide whether this is truly an anatomy/basic-science item that should move to Anatomi, or whether current_category should be preserved.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Anatomi'
        && Number(res.runner_up_score) <= 6
        && normalize(caseRecord.subject) === 'anatomy'
        && hasTag(meta.tags, 'anatomy')
        && hasTag(meta.tags, 'general anatomy');
    },
  },
];

const WAVE2_BUCKETS = [
  {
    id: 'ipd-musculoskeletal-urology-vs-bedah-runner3',
    label: 'IPD cases with musculoskeletal or urology organ-system drift toward surgery',
    rationale: 'Residual IPD review items where the runner-up is Bedah and metadata consistently points to musculoskeletal or urology content.',
    focus: 'Decide whether this case should stay in broad internal medicine or move to Bedah because the stem is really orthopedic, trauma, or surgical-urology anatomy/clinical content.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      const organSystem = normalize(meta.organ_system);
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Bedah'
        && Number(res.runner_up_score) <= 3
        && ['musculoskeletal', 'urology'].includes(organSystem);
    },
  },
  {
    id: 'ipd-neurological-organ-vs-neurologi-runner3',
    label: 'IPD cases with neurological organ-system drift',
    rationale: 'Residual IPD review items whose organ system is neurological and whose runner-up category is Neurologi.',
    focus: 'Decide whether the case should remain in broad internal medicine or move to Neurologi because the stem is fundamentally neuro-anatomy, neuro-physiology, or neurology content.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Neurologi'
        && Number(res.runner_up_score) <= 3
        && normalize(meta.organ_system) === 'neurological';
    },
  },
  {
    id: 'ipd-obg-organ-vs-obgyn-runner3',
    label: 'IPD cases with gynecology or obstetrics organ-system drift',
    rationale: 'Residual IPD review items whose organ system is gynecology/obstetrics and whose runner-up category is Obstetri & Ginekologi.',
    focus: 'Decide whether the stem should remain in internal medicine or move to Obstetri & Ginekologi because the actual content is predominantly obstetric or gynecologic.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      const organSystem = normalize(meta.organ_system);
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Obstetri & Ginekologi'
        && Number(res.runner_up_score) <= 3
        && ['gynecology', 'obstetrics'].includes(organSystem);
    },
  },
  {
    id: 'ipd-dermatology-organ-vs-derm-runner3',
    label: 'IPD cases with dermatology organ-system drift',
    rationale: 'Residual IPD review items whose organ system is dermatology and whose runner-up category is Kulit & Kelamin.',
    focus: 'Decide whether the stem should remain in internal medicine or move to Kulit & Kelamin because the content is primarily dermatologic rather than general medicine.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Kulit & Kelamin'
        && Number(res.runner_up_score) <= 3
        && normalize(meta.organ_system) === 'dermatology';
    },
  },
];

const WAVE3_BUCKETS = [
  {
    id: 'ipd-oral-maxillofacial-vs-dental-runner4',
    label: 'IPD cases with oral or mandibular drift toward dentistry',
    rationale: 'Residual IPD review items whose resolved winner is Kedokteran Gigi while a stale IPD runner-up still keeps the final label stuck.',
    focus: 'Decide whether this item should stay in broad internal medicine or move to Kedokteran Gigi because the stem is really oral anatomy, tooth, or mandibular/maxillofacial content.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && res.raw_normalized_category === 'Ilmu Penyakit Dalam'
        && caseRecord.category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Kedokteran Gigi'
        && res.runner_up_category === 'Ilmu Penyakit Dalam'
        && Number(res.runner_up_score) <= 4;
    },
  },
  {
    id: 'ipd-neurology-self-confirm-runner9',
    label: 'IPD self-confirm cases with neurological drift',
    rationale: 'Residual IPD items where the resolver still keeps internal medicine, but Neurologi remains a close runner-up through neurological metadata.',
    focus: 'Decide whether the case should keep Ilmu Penyakit Dalam or move to Neurologi based on whether the stem is fundamentally neurology rather than general medicine.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && caseRecord.category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Neurologi'
        && Number(res.runner_up_score) === 9
        && normalize(meta.organ_system) === 'neurological';
    },
  },
  {
    id: 'ipd-pharmacology-self-confirm-runner3',
    label: 'IPD self-confirm cases with low pharmacology drift',
    rationale: 'Residual IPD items with pharmacology metadata where Farmakologi only trails narrowly.',
    focus: 'Decide whether the case should keep Ilmu Penyakit Dalam or move to Farmakologi, especially for dose, toxicity, drug-use, or adverse-effect stems.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && caseRecord.category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Farmakologi'
        && Number(res.runner_up_score) === 3
        && normalize(meta.organ_system) === 'pharmacology';
    },
  },
  {
    id: 'ipd-ophthalmology-self-confirm-runner3',
    label: 'IPD self-confirm cases with low ophthalmology drift',
    rationale: 'Residual IPD items with eye or optic-system metadata where Mata only trails narrowly.',
    focus: 'Decide whether the case should keep Ilmu Penyakit Dalam or move to Mata, especially for visual pathway, optic, or color-vision stems.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && caseRecord.category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Mata'
        && Number(res.runner_up_score) === 3
        && normalize(meta.organ_system) === 'ophthalmology';
    },
  },
  {
    id: 'ipd-dermatology-self-confirm-runner9',
    label: 'IPD self-confirm cases with dermatology drift',
    rationale: 'Residual IPD items where the resolver keeps internal medicine but Kulit & Kelamin remains a strong nearby alternative.',
    focus: 'Decide whether the case should keep Ilmu Penyakit Dalam or move to Kulit & Kelamin because the stem is primarily dermatologic or dermato-immunologic.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && caseRecord.category === 'Ilmu Penyakit Dalam'
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Kulit & Kelamin'
        && Number(res.runner_up_score) === 9
        && normalize(meta.organ_system) === 'dermatology';
    },
  },
  {
    id: 'bedah-ent-self-confirm-runner9',
    label: 'Surgery self-confirm cases with ENT overlap',
    rationale: 'Residual Bedah items where THT is still close because the stem sits on the edge of ENT surgery or head-neck operative content.',
    focus: 'Decide whether the case should keep Bedah or move to THT based on whether the question is principally surgical/operative or primarily otorhinolaryngology.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && caseRecord.category === 'Bedah'
        && res.resolved_category === 'Bedah'
        && res.runner_up_category === 'THT'
        && Number(res.runner_up_score) === 9
        && normalize(meta.organ_system) === 'ent';
    },
  },
  {
    id: 'obg-self-confirm-vs-ipd-runner9',
    label: 'ObGyn self-confirm cases with medicine overlap',
    rationale: 'Residual Obstetri & Ginekologi items where IPD is still a strong runner-up because of endocrine, cardiovascular, or systemic overlap.',
    focus: 'Decide whether the case should keep Obstetri & Ginekologi or move to Ilmu Penyakit Dalam based on whether the reproductive context is still primary.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return caseRecord.source === 'medmcqa'
        && meta.category_review_needed === true
        && caseRecord.category === 'Obstetri & Ginekologi'
        && res.resolved_category === 'Obstetri & Ginekologi'
        && res.runner_up_category === 'Ilmu Penyakit Dalam'
        && Number(res.runner_up_score) === 9;
    },
  },
];

const WAVE4_BUCKETS = [
  {
    id: 'ipd-skin-therapy-vs-pharmacology-target',
    label: 'IPD dermatology therapy stems drifting toward pharmacology',
    rationale: 'Residual low-confidence IPD items where skin/dermatology stems are really about drug choice or treatment and the resolver already prefers Farmakologi.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Farmakologi because the stem is primarily asking about dermatologic drug selection, indication, toxicity, or treatment.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Farmakologi'
        && res.runner_up_category === 'Ilmu Penyakit Dalam'
        && normalize(caseRecord.subject) === 'skin'
        && normalize(meta.organ_system) === 'dermatology'
        && hasAnyTextFragment(text, [
          'drug',
          'treatment',
          'treat',
          'therapy',
          'preferred',
          'indicated',
          'effective',
          'eruption',
          'itching',
          'nodulocystic',
          'pityriasis',
          'versicolor',
        ]);
    },
  },
  {
    id: 'ipd-ent-anatomy-sinus-tympanic-target',
    label: 'IPD anatomy stems that are really ENT anatomy',
    rationale: 'Residual low-confidence IPD anatomy items where sinus, paranasal, or tympanic anatomy semantics consistently point to THT.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to THT because the stem is really about paranasal sinus, tympanic membrane, or related ENT anatomy.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'THT'
        && res.runner_up_category === 'Ilmu Penyakit Dalam'
        && normalize(caseRecord.subject) === 'anatomy'
        && hasAnyTextFragment(text, [
          'sinus',
          'paranasal',
          'ethmoid',
          'ethmoidal',
          'sphenoid',
          'sphenoidal',
          'frontal',
          'tympanic',
        ]);
    },
  },
  {
    id: 'ipd-ortho-xray-vs-radiology-target',
    label: 'IPD orthopaedic imaging stems drifting toward radiology',
    rationale: 'Residual low-confidence IPD items where orthopaedic stems are really testing X-ray interpretation or named radiographic views and the resolver already prefers Radiologi.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Radiologi because the stem is principally about radiographic interpretation rather than general medicine.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Radiologi'
        && res.runner_up_category === 'Ilmu Penyakit Dalam'
        && normalize(caseRecord.subject) === 'orthopaedics'
        && normalize(meta.organ_system) === 'general'
        && hasAnyTextFragment(text, [
          'x ray',
          'x-ray',
          'judet',
          'scoliosis',
        ]);
    },
  },
  {
    id: 'ipd-dermpath-vs-clinical-derm-target',
    label: 'IPD dermpath stems drifting toward clinical dermatology',
    rationale: 'Residual low-confidence IPD pathology items where the semantic content is classic clinical derm or immunobullous disease rather than pure histopathology, and the resolver already prefers Kulit & Kelamin.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Kulit & Kelamin because the stem is really clinical dermatology rather than pathology taxonomy.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Kulit & Kelamin'
        && res.runner_up_category === 'Patologi Anatomi'
        && normalize(caseRecord.subject) === 'pathology'
        && normalize(meta.organ_system) === 'dermatology';
    },
  },
  {
    id: 'ipd-immunology-vs-pediatrics-target',
    label: 'IPD immunology stems drifting toward microbiology',
    rationale: 'Residual low-confidence IPD items where microbiology/immunology content is mixed with child framing, but the resolver already prefers Mikrobiologi over pediatrics.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Mikrobiologi because the stem is fundamentally immunology or host-defense content rather than a pediatrics management stem.',
    match(caseRecord) {
      const meta = caseRecord.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Mikrobiologi'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord.subject) === 'microbiology'
        && normalize(meta.organ_system) === 'immunology'
        && hasAnyTextFragment(text, [
          'child',
          'immun',
          'lymphoid',
          'immunoglobulin',
          'genetic loci',
        ]);
    },
  },
];

const WAVE5_BUCKETS = [
  {
    id: 'ipd-oral-maxillofacial-tail-vs-dental-target',
    label: 'IPD oral or maxillofacial tails drifting toward dentistry',
    rationale: 'Residual low-confidence IPD items whose semantic center is oral cavity, dentition, or mandibular/maxillofacial anatomy and whose resolver now prefers Kedokteran Gigi.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Kedokteran Gigi because the stem is really oral, dental, or mandibular/maxillofacial content.',
    match(caseRecord) {
      const res = caseRecord?.meta?.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Kedokteran Gigi'
        && hasAnyTextFragment(text, [
          'oral',
          'oral cavity',
          'mandible',
          'mandibular',
          'maxillary',
          'dentition',
          'tooth',
          'teeth',
          'dental',
          'parotid',
        ]);
    },
  },
  {
    id: 'ipd-ent-tail-vs-ent-target',
    label: 'IPD ENT-focused tails drifting toward THT',
    rationale: 'Residual low-confidence IPD items whose content is centered on nasal, sinus, or middle-ear ENT anatomy/clinical cues and whose resolver now prefers THT.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to THT because the stem is primarily otorhinolaryngology rather than general medicine.',
    match(caseRecord) {
      const res = caseRecord?.meta?.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'THT'
        && hasAnyTextFragment(text, [
          'nasal',
          'septum',
          'sinus',
          'middle ear',
          'tympanic',
          'ear',
          'pyramid',
          'face',
        ]);
    },
  },
  {
    id: 'ipd-imaging-tail-vs-radiology-target',
    label: 'IPD imaging tails drifting toward radiology',
    rationale: 'Residual low-confidence IPD items that are really testing radiographic views or image interpretation and whose resolver now prefers Radiologi.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Radiologi because the question is fundamentally about imaging interpretation or named radiographic views.',
    match(caseRecord) {
      const res = caseRecord?.meta?.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Radiologi'
        && hasAnyTextFragment(text, [
          'x ray',
          'x-ray',
          'radiograph',
          'judet',
          'shenton',
          'lesion depicted',
          'shown',
          'bony pain',
        ]);
    },
  },
  {
    id: 'ipd-drug-mechanism-tail-vs-pharmacology-target',
    label: 'IPD drug or mechanism tails drifting toward pharmacology',
    rationale: 'Residual low-confidence IPD items whose core task is drug choice, mechanism, adverse effect, or pharmacologic receptor logic and whose resolver now prefers Farmakologi.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Farmakologi because the stem is fundamentally a pharmacology question.',
    match(caseRecord) {
      const res = caseRecord?.meta?.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Farmakologi'
        && hasAnyTextFragment(text, [
          'drug',
          'barbiturate',
          'barbiturates',
          'receptor',
          'receptors',
          'anesthetic',
          'levetiracetam',
          'endometriosis',
        ]);
    },
  },
  {
    id: 'ipd-ophthalmic-tail-vs-ophthalmology-target',
    label: 'IPD ophthalmic tails drifting toward eye-focused categories',
    rationale: 'Residual low-confidence IPD items whose content is really ocular trauma, ocular muscle, or frontal-eye-field anatomy and whose resolver now prefers Mata.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Mata because the stem is truly ophthalmic rather than general medicine.',
    match(caseRecord) {
      const res = caseRecord?.meta?.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Mata'
        && (
          normalize(caseRecord?.subject) === 'ophthalmology'
          || hasAnyTextFragment(text, [
            'eye',
            'ocular',
            'oblique',
            'blunt trauma',
            'frontal eye',
          ])
        );
    },
  },
];

const WAVE6_BUCKETS = [
  {
    id: 'ipd-surgical-procedure-tail-vs-bedah-target',
    label: 'IPD procedural or operative tails drifting toward surgery',
    rationale: 'Residual low-confidence IPD items whose stems are explicitly procedural, operative, or surgical-anatomy oriented and whose resolver already prefers Bedah.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Bedah because the stem is fundamentally operative or procedure-focused.',
    match(caseRecord) {
      const res = caseRecord?.meta?.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Bedah'
        && hasAnyTextFragment(text, [
          'surgery',
          'surgical',
          'laparotomy',
          'lap sterilization',
          'ankylosis',
          'neurosurgery',
          'gallbladder',
          'fixation',
          'approach',
          'bone particle',
          'tmj',
        ]);
    },
  },
  {
    id: 'ipd-infectious-virology-self-confirm-vs-microbiology',
    label: 'IPD infectious virology self-confirm tails',
    rationale: 'Residual low-confidence IPD items with infectious microbiology framing where Mikrobiologi remains the direct runner-up.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Mikrobiologi based on whether the stem is really pathogen or virology knowledge rather than broad medicine.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Mikrobiologi'
        && normalize(caseRecord?.subject) === 'microbiology'
        && normalize(meta.organ_system) === 'infectious';
    },
  },
  {
    id: 'ipd-medicine-eye-self-confirm-vs-ophthalmology',
    label: 'IPD medicine cases with persistent eye overlap',
    rationale: 'Residual low-confidence IPD medicine items where Mata remains the closest alternate label through ophthalmic or neuro-ophthalmic presentation.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Mata based on whether the stem is really ophthalmic rather than general medicine.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Mata'
        && normalize(caseRecord?.subject) === 'medicine'
        && normalize(meta.organ_system) === 'ophthalmology';
    },
  },
  {
    id: 'ipd-medicine-ent-self-confirm-vs-tht',
    label: 'IPD medicine cases with persistent ENT overlap',
    rationale: 'Residual low-confidence IPD medicine items where THT remains the closest alternate because the stem sits near ENT infections, vertigo, or upper-airway disease.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to THT based on whether the content is principally ENT rather than broad medicine.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'THT'
        && normalize(caseRecord?.subject) === 'medicine'
        && normalize(meta.organ_system) === 'ent';
    },
  },
  {
    id: 'ipd-pathology-git-self-confirm-vs-pathanat',
    label: 'IPD GI pathology cases with pathology-anatomy overlap',
    rationale: 'Residual low-confidence IPD items where gastrointestinal pathology semantics keep Patologi Anatomi close behind the current label.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Patologi Anatomi based on whether the stem is really pathology taxonomy rather than clinical medicine.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Patologi Anatomi'
        && normalize(caseRecord?.subject) === 'pathology'
        && normalize(meta.organ_system) === 'gastrointestinal';
    },
  },
];

const WAVE7_BUCKETS = [
  {
    id: 'bedah-surgery-ent-self-confirm-vs-tht',
    label: 'Surgery cases with persistent ENT overlap',
    rationale: 'Residual low-confidence Bedah items where THT is the resolved winner for surgery stems that actually read as ENT disease or airway/head-neck management.',
    focus: 'Decide whether the item should keep Bedah or move to THT based on whether the content is really ENT rather than general surgery.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Bedah')
        && res.resolved_category === 'THT'
        && res.runner_up_category === 'Bedah'
        && normalize(caseRecord?.subject) === 'surgery'
        && normalize(meta.organ_system) === 'ent';
    },
  },
  {
    id: 'bedah-screening-self-confirm-vs-public-health',
    label: 'Surgery screening stems drifting toward public health',
    rationale: 'Residual low-confidence Bedah items that are really about screening programs or preventive strategy rather than surgical management, and the resolver already prefers Ilmu Kesehatan Masyarakat.',
    focus: 'Decide whether the item should keep Bedah or move to Ilmu Kesehatan Masyarakat because the stem is predominantly screening or public-health logic.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceCategory(caseRecord, 'Bedah')
        && res.resolved_category === 'Ilmu Kesehatan Masyarakat'
        && res.runner_up_category === 'Bedah'
        && normalize(caseRecord?.subject) === 'surgery'
        && normalize(meta.organ_system) === 'public_health'
        && hasAnyTextFragment(text, ['screening', 'counselling', 'cytology', 'mammography']);
    },
  },
  {
    id: 'radiology-forensic-self-confirm-vs-forensics',
    label: 'Radiology cases drifting toward forensic medicine',
    rationale: 'Residual low-confidence Radiologi items that are really forensic identification or medico-legal interpretation rather than core imaging.',
    focus: 'Decide whether the item should keep Radiologi or move to Forensik because the stem is primarily forensic rather than radiologic.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Radiologi')
        && res.resolved_category === 'Forensik'
        && res.runner_up_category === 'Radiologi'
        && normalize(caseRecord?.subject) === 'forensic medicine';
    },
  },
  {
    id: 'radiology-pathology-self-confirm-vs-pathanat',
    label: 'Radiology cases drifting toward pathology anatomy',
    rationale: 'Residual low-confidence Radiologi items whose stems are really pathology knowledge rather than imaging interpretation, and the resolver already prefers Patologi Anatomi.',
    focus: 'Decide whether the item should keep Radiologi or move to Patologi Anatomi because the question is fundamentally pathology rather than radiology.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Radiologi')
        && res.resolved_category === 'Patologi Anatomi'
        && res.runner_up_category === 'Radiologi'
        && normalize(caseRecord?.subject) === 'pathology';
    },
  },
  {
    id: 'radiology-biochem-self-confirm-vs-biokimia',
    label: 'Radiology cases drifting toward biochemistry',
    rationale: 'Residual low-confidence Radiologi items that are actually molecular structure or biochemistry questions where Radiologi survives only as a stale source label.',
    focus: 'Decide whether the item should keep Radiologi or move to Biokimia because the stem is clearly biochemical rather than imaging-based.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Radiologi')
        && res.resolved_category === 'Biokimia'
        && res.runner_up_category === 'Radiologi'
        && normalize(caseRecord?.subject) === 'biochemistry';
    },
  },
  {
    id: 'mata-pharmacology-self-confirm-vs-pharmacology-target',
    label: 'Eye-category pharmacology tails drifting toward pharmacology',
    rationale: 'Residual low-confidence Mata items that are really drug-mechanism or drug-choice stems, and the resolver already prefers Farmakologi.',
    focus: 'Decide whether the item should keep Mata or move to Farmakologi because the question is fundamentally about drugs rather than ophthalmology.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Mata')
        && res.resolved_category === 'Farmakologi'
        && normalize(caseRecord?.subject) === 'pharmacology';
    },
  },
  {
    id: 'ika-musculoskeletal-self-confirm-vs-bedah',
    label: 'Pediatrics cases with musculoskeletal drift toward surgery',
    rationale: 'Residual low-confidence Ilmu Kesehatan Anak items whose stems are really pediatric orthopedics or pediatric surgery, while the current label remains pediatrics.',
    focus: 'Decide whether the item should keep Ilmu Kesehatan Anak or move to Bedah because the content is fundamentally surgical or orthopedic.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Ilmu Kesehatan Anak')
        && res.resolved_category === 'Bedah'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord?.subject) === 'pediatrics'
        && normalize(meta.organ_system) === 'musculoskeletal';
    },
  },
  {
    id: 'ika-neurology-self-confirm-vs-neurologi',
    label: 'Pediatrics cases with neurological drift',
    rationale: 'Residual low-confidence Ilmu Kesehatan Anak items whose stems are really pediatric neurology or epilepsy recognition rather than general pediatrics.',
    focus: 'Decide whether the item should keep Ilmu Kesehatan Anak or move to Neurologi because the question is fundamentally neurologic.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Ilmu Kesehatan Anak')
        && res.resolved_category === 'Neurologi'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord?.subject) === 'pediatrics'
        && normalize(meta.organ_system) === 'neurological';
    },
  },
  {
    id: 'ika-ent-self-confirm-vs-tht',
    label: 'Pediatrics cases with ENT drift',
    rationale: 'Residual low-confidence Ilmu Kesehatan Anak items whose stems are really ENT disease or airway/ear content rather than general pediatrics.',
    focus: 'Decide whether the item should keep Ilmu Kesehatan Anak or move to THT because the question is primarily ENT.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Ilmu Kesehatan Anak')
        && res.resolved_category === 'THT'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord?.subject) === 'pediatrics'
        && normalize(meta.organ_system) === 'ent';
    },
  },
];

const WAVE8_BUCKETS = [
  {
    id: 'ipd-public-health-risk-self-confirm-vs-public-health',
    label: 'IPD epidemiology/risk-factor stems drifting toward public health',
    rationale: 'Residual low-confidence IPD items that read more like prevalence, incidence, or risk-factor epidemiology than bedside internal medicine, while public health stays close behind.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Ilmu Kesehatan Masyarakat because the stem is fundamentally epidemiologic rather than clinical-medicine focused.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Ilmu Kesehatan Masyarakat'
        && normalize(meta.organ_system) === 'public_health'
        && hasAnyTextFragment(text, ['prevalence', 'incidence', 'risk factor', 'risk factors']);
    },
  },
  {
    id: 'ipd-ent-anatomy-self-confirm-vs-tht-tail',
    label: 'IPD anatomy tails drifting toward ENT',
    rationale: 'Residual low-confidence IPD items whose anatomy stems are actually ENT-region knowledge rather than core internal medicine.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to THT because the stem is fundamentally ENT anatomy.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'THT'
        && normalize(caseRecord?.subject) === 'anatomy'
        && normalize(meta.organ_system) === 'ent';
    },
  },
  {
    id: 'radiology-infectious-self-confirm-vs-ipd',
    label: 'Radiology infectious tails drifting toward internal medicine',
    rationale: 'Residual low-confidence Radiologi items where imaging language survives in the stem, but the question is actually about infectious disease reasoning or program logic.',
    focus: 'Decide whether the item should keep Radiologi or move to Ilmu Penyakit Dalam because the stem is primarily infectious-disease/internal-medicine content.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Radiologi')
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Radiologi'
        && normalize(meta.organ_system) === 'infectious';
    },
  },
  {
    id: 'bedah-ent-headneck-target-vs-tht',
    label: 'Surgery head-and-neck tails drifting toward ENT',
    rationale: 'Residual low-confidence Bedah items whose subject metadata already points to ENT and whose resolved winner is THT, suggesting head-and-neck disease rather than general surgery.',
    focus: 'Decide whether the item should keep Bedah or move to THT because the stem is primarily ENT/head-and-neck content.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Bedah')
        && res.resolved_category === 'THT'
        && normalize(caseRecord?.subject) === 'ent';
    },
  },
  {
    id: 'bedah-oral-maxillofacial-target-vs-dental',
    label: 'Surgery oral-cavity tails drifting toward dental medicine',
    rationale: 'Residual low-confidence Bedah items where the resolved winner is Kedokteran Gigi and the stem appears to be oral or maxillofacial rather than general surgery.',
    focus: 'Decide whether the item should keep Bedah or move to Kedokteran Gigi because the question is mainly dental/oral-cavity focused.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Bedah')
        && res.resolved_category === 'Kedokteran Gigi'
        && normalize(caseRecord?.subject) === 'ent';
    },
  },
  {
    id: 'bedah-ophthalmology-mixed-vs-mata',
    label: 'Surgery tails with persistent ophthalmology overlap',
    rationale: 'Residual low-confidence Bedah items that carry ophthalmology semantics strongly enough that Mata stays as either the resolved winner or the close runner-up.',
    focus: 'Decide whether the item should keep Bedah or move to Mata because the stem is fundamentally ophthalmic rather than surgical.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Bedah')
        && normalize(caseRecord?.subject) === 'surgery'
        && normalize(meta.organ_system) === 'ophthalmology'
        && (res.resolved_category === 'Mata' || res.runner_up_category === 'Mata');
    },
  },
  {
    id: 'bedah-obstetric-target-vs-obg',
    label: 'Surgery obstetric tails drifting toward OBG',
    rationale: 'Residual low-confidence Bedah items that are actually pregnancy or obstetric-management stems rather than core surgical content.',
    focus: 'Decide whether the item should keep Bedah or move to Obstetri & Ginekologi because the stem is primarily obstetric.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Bedah')
        && res.resolved_category === 'Obstetri & Ginekologi'
        && res.runner_up_category === 'Bedah'
        && normalize(caseRecord?.subject) === 'surgery'
        && normalize(meta.organ_system) === 'obstetrics';
    },
  },
  {
    id: 'forensics-hyoid-fracture-vs-surgery',
    label: 'Forensic hyoid-fracture stems drifting toward surgery',
    rationale: 'Residual low-confidence Forensik items where fracture semantics pull the resolver toward Bedah even though the stem remains recognizably forensic.',
    focus: 'Decide whether the item should keep Forensik or move to Bedah because the question is more surgical/trauma-oriented than forensic.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceCategory(caseRecord, 'Forensik')
        && res.resolved_category === 'Bedah'
        && res.runner_up_category === 'Forensik'
        && normalize(caseRecord?.subject) === 'forensic medicine'
        && normalize(meta.organ_system) === 'musculoskeletal'
        && hasAnyTextFragment(text, ['hyoid', 'fracture']);
    },
  },
  {
    id: 'forensics-sanitation-self-confirm-vs-public-health',
    label: 'Forensic sanitation stems drifting toward public health',
    rationale: 'Residual low-confidence Forensik items that are really about sewage disposal or sanitation systems, where public health remains close behind.',
    focus: 'Decide whether the item should keep Forensik or move to Ilmu Kesehatan Masyarakat because the stem is primarily sanitation/public-health content.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceCategory(caseRecord, 'Forensik')
        && res.resolved_category === 'Forensik'
        && res.runner_up_category === 'Ilmu Kesehatan Masyarakat'
        && normalize(caseRecord?.subject) === 'social & preventive medicine'
        && hasAnyTextFragment(text, ['septic tank', 'sewage', 'disposal', 'sanitation']);
    },
  },
  {
    id: 'obg-dermatology-self-confirm-vs-dermatology',
    label: 'OBG dermatology-overlap tails',
    rationale: 'Residual low-confidence OBG items where dermatology remains the runner-up because the stem is about skin disease in an obstetric/gynecologic setting.',
    focus: 'Decide whether the item should keep Obstetri & Ginekologi or move to Kulit & Kelamin because the question is primarily dermatologic.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Obstetri & Ginekologi')
        && res.resolved_category === 'Obstetri & Ginekologi'
        && res.runner_up_category === 'Kulit & Kelamin'
        && normalize(caseRecord?.subject) === 'gynaecology & obstetrics'
        && normalize(meta.organ_system) === 'dermatology';
    },
  },
  {
    id: 'ika-obstetrics-target-vs-obg',
    label: 'Pediatrics delivery-room tails drifting toward OBG',
    rationale: 'Residual low-confidence Ilmu Kesehatan Anak items that are really delivery-room or immediate peripartum management stems rather than general pediatrics.',
    focus: 'Decide whether the item should keep Ilmu Kesehatan Anak or move to Obstetri & Ginekologi because the stem is mainly obstetric/peripartum.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Ilmu Kesehatan Anak')
        && res.resolved_category === 'Obstetri & Ginekologi'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord?.subject) === 'pediatrics'
        && normalize(meta.organ_system) === 'obstetrics';
    },
  },
];

const WAVE9_BUCKETS = [
  {
    id: 'ipd-basic-microbiology-target-vs-anesthesia',
    label: 'IPD basic-microbiology tails split between microbiology and emergency care',
    rationale: 'Residual low-confidence IPD items where the resolver wants Mikrobiologi, the runner-up remains Anestesi & Emergency Medicine, and the source metadata is still noisy enough that the current label survived.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam, move to Mikrobiologi, or move to Anestesi & Emergency Medicine based on the actual stem semantics.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Mikrobiologi'
        && res.runner_up_category === 'Anestesi & Emergency Medicine'
        && normalize(caseRecord?.subject) === 'microbiology'
        && normalize(meta.organ_system) === 'general';
    },
  },
  {
    id: 'ipd-anaphylaxis-immunology-mixed-vs-microbiology',
    label: 'IPD anaphylaxis/immunology tails split between emergency care and microbiology',
    rationale: 'Residual low-confidence IPD items about anaphylaxis or hypersensitivity where Anestesi & Emergency Medicine wins narrowly over Mikrobiologi.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam, move to Anestesi & Emergency Medicine, or move to Mikrobiologi based on whether the stem is emergency management or basic immunology.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Anestesi & Emergency Medicine'
        && res.runner_up_category === 'Mikrobiologi'
        && normalize(caseRecord?.subject) === 'microbiology'
        && normalize(meta.organ_system) === 'immunology'
        && hasAnyTextFragment(text, ['anaphylaxis', 'hypersensitivity']);
    },
  },
  {
    id: 'ipd-infectious-anatomy-self-confirm-vs-microbiology',
    label: 'IPD infectious stems with persistent microbiology overlap',
    rationale: 'Residual low-confidence IPD items where infectious-disease content keeps Mikrobiologi close behind even though the current label still wins.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Mikrobiologi because the question is fundamentally microbiologic rather than clinical-medicine focused.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Mikrobiologi'
        && normalize(caseRecord?.subject) === 'anatomy'
        && normalize(meta.organ_system) === 'infectious';
    },
  },
  {
    id: 'ipd-tuberculous-knee-self-confirm-vs-bedah',
    label: 'IPD tuberculous-knee deformity tails drifting toward surgery',
    rationale: 'Residual low-confidence IPD items about classic knee deformity patterns where orthopedics keeps Bedah close behind.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Bedah because the question is more orthopedic than internal-medicine focused.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Bedah'
        && normalize(caseRecord?.subject) === 'orthopaedics'
        && normalize(meta.organ_system) === 'infectious'
        && hasAnyTextFragment(text, ['triple deformity of knee', 'triple deformity']);
    },
  },
  {
    id: 'ipd-orthopedic-imaging-target-vs-bedah',
    label: 'IPD orthopedic imaging tails drifting toward surgery',
    rationale: 'Residual low-confidence IPD items where musculoskeletal and X-ray interpretation cues push the resolver toward Bedah with Radiologi close behind.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam, move to Bedah, or move to Radiologi based on whether the stem is primarily orthopedic or imaging-focused.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Bedah'
        && res.runner_up_category === 'Radiologi'
        && normalize(caseRecord?.subject) === 'orthopaedics'
        && normalize(meta.organ_system) === 'musculoskeletal';
    },
  },
  {
    id: 'ipd-neurophysiology-self-confirm-vs-neurology',
    label: 'IPD neurophysiology tails drifting toward neurology',
    rationale: 'Residual low-confidence IPD items about axonal conduction or degeneration where Neurologi remains the close runner-up.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Neurologi because the stem is fundamentally neurophysiology rather than internal medicine.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Neurologi'
        && normalize(caseRecord?.subject) === 'physiology'
        && normalize(meta.organ_system) === 'general';
    },
  },
  {
    id: 'ipd-psychiatry-medicine-self-confirm-vs-psychiatry',
    label: 'IPD psychiatry-overlap medicine tails',
    rationale: 'Residual low-confidence IPD items where psychiatric semantics stay close behind even though the current label still wins.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Psikiatri because the stem is primarily psychiatric.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Psikiatri'
        && normalize(caseRecord?.subject) === 'medicine'
        && normalize(meta.organ_system) === 'psychiatry';
    },
  },
  {
    id: 'bedah-renal-surgical-self-confirm-vs-ipd',
    label: 'Surgery renal tails with persistent internal-medicine overlap',
    rationale: 'Residual low-confidence Bedah items that still read like surgical/urologic presentations while Ilmu Penyakit Dalam stays close behind.',
    focus: 'Decide whether the item should keep Bedah or move to Ilmu Penyakit Dalam because the stem is more medical than surgical.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Bedah')
        && res.resolved_category === 'Bedah'
        && res.runner_up_category === 'Ilmu Penyakit Dalam'
        && normalize(caseRecord?.subject) === 'surgery'
        && normalize(meta.organ_system) === 'renal';
    },
  },
  {
    id: 'bedah-ent-self-confirm-vs-tht-tail',
    label: 'Surgery residual tails with mild ENT overlap',
    rationale: 'Residual low-confidence Bedah items where ENT remains the runner-up but the resolver still keeps the current surgical label.',
    focus: 'Decide whether the item should keep Bedah or move to THT because the stem is primarily ENT rather than surgical.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Bedah')
        && res.resolved_category === 'Bedah'
        && res.runner_up_category === 'THT'
        && normalize(meta.organ_system) === 'ent';
    },
  },
];

const WAVE10_BUCKETS = [
  {
    id: 'ipd-medicine-self-confirm-vs-pharmacology-tail',
    label: 'IPD medicine tails with persistent pharmacology overlap',
    rationale: 'Residual low-confidence IPD items where pharmacology remains the runner-up because the stem includes drug semantics, but the current internal-medicine label still narrowly survives.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Farmakologi because the stem is fundamentally drug-focused rather than clinical-medicine focused.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Farmakologi'
        && normalize(caseRecord?.subject) === 'medicine'
        && normalize(meta.organ_system) === 'pharmacology';
    },
  },
  {
    id: 'ipd-pathology-pediatrics-self-confirm-vs-pediatrics',
    label: 'IPD pathology tails with persistent pediatrics overlap',
    rationale: 'Residual low-confidence IPD items where pathology wording coexists with pediatric metadata, leaving Ilmu Kesehatan Anak as the close runner-up.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Ilmu Kesehatan Anak because the stem is fundamentally pediatric rather than adult internal medicine.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord?.subject) === 'pathology'
        && normalize(meta.organ_system) === 'pediatrics';
    },
  },
  {
    id: 'ipd-physiology-pediatrics-self-confirm-vs-pediatrics',
    label: 'IPD physiology tails drifting toward pediatrics',
    rationale: 'Residual low-confidence IPD items whose physiology framing keeps pediatrics close behind because the stem likely belongs to developmental or child-health content.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Ilmu Kesehatan Anak because the question is primarily pediatric physiology.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord?.subject) === 'physiology'
        && normalize(meta.organ_system) === 'pediatrics';
    },
  },
  {
    id: 'ipd-spm-pediatrics-target-vs-public-health',
    label: 'IPD social-preventive tails split between pediatrics and public health',
    rationale: 'Residual low-confidence IPD items where the resolver prefers Ilmu Kesehatan Anak, public health remains runner-up, and the current label survives only as a stale source carry-over.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam, move to Ilmu Kesehatan Anak, or move to Ilmu Kesehatan Masyarakat based on whether the stem is mainly pediatric or population-health oriented.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Kesehatan Anak'
        && res.runner_up_category === 'Ilmu Kesehatan Masyarakat'
        && normalize(caseRecord?.subject) === 'social & preventive medicine'
        && normalize(meta.organ_system) === 'pediatrics';
    },
  },
  {
    id: 'ipd-gyne-pathology-self-confirm-vs-pediatrics',
    label: 'IPD gyne-pathology tails with noisy pediatrics overlap',
    rationale: 'Residual low-confidence IPD items around gynecologic pathology where the pediatric runner-up looks suspiciously noisy, so we need a semantic adjudication instead of trusting metadata.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Ilmu Kesehatan Anak only if the stem is genuinely pediatric; otherwise keep the current category.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord?.subject) === 'pathology'
        && normalize(meta.organ_system) === 'gynecology';
    },
  },
  {
    id: 'ipd-pediatric-pathology-target-vs-pathanat',
    label: 'IPD pediatric pathology tails split between pediatrics and pathology anatomy',
    rationale: 'Residual low-confidence IPD items where the resolver prefers Ilmu Kesehatan Anak, Patologi Anatomi remains the runner-up, and the current label is probably stale.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam, move to Ilmu Kesehatan Anak, or move to Patologi Anatomi based on whether the stem is clinical pediatric oncology or pure pathology.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Kesehatan Anak'
        && res.runner_up_category === 'Patologi Anatomi'
        && normalize(caseRecord?.subject) === 'pathology'
        && normalize(meta.organ_system) === 'pediatrics';
    },
  },
  {
    id: 'ipd-hematology-pathology-self-confirm-vs-pathanat',
    label: 'IPD hematology pathology tails drifting toward pathology anatomy',
    rationale: 'Residual low-confidence IPD items where pathology-anatomy semantics remain the close runner-up for hematology-flavored weakness presentations.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Patologi Anatomi because the question is fundamentally pathology rather than clinical medicine.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Patologi Anatomi'
        && normalize(caseRecord?.subject) === 'pathology'
        && normalize(meta.organ_system) === 'hematology';
    },
  },
  {
    id: 'ipd-pediatric-infectious-target-vs-microbiology',
    label: 'IPD pediatric infectious tails split between pediatrics and microbiology',
    rationale: 'Residual low-confidence IPD items where the resolver prefers Ilmu Kesehatan Anak but microbiology remains close because the stem mentions organisms or infection framing.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam, move to Ilmu Kesehatan Anak, or move to Mikrobiologi based on whether the question is clinical-pediatric or organism-focused.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Kesehatan Anak'
        && res.runner_up_category === 'Mikrobiologi'
        && normalize(caseRecord?.subject) === 'microbiology'
        && normalize(meta.organ_system) === 'pediatrics';
    },
  },
  {
    id: 'obg-pediatrics-self-confirm-vs-pediatrics-tail',
    label: 'OBG tails with persistent pediatrics overlap',
    rationale: 'Residual low-confidence OBG items where pediatric metadata stays close behind even though the current obstetric/gynecologic label still wins.',
    focus: 'Decide whether the item should keep Obstetri & Ginekologi or move to Ilmu Kesehatan Anak because the stem is primarily pediatric rather than obstetric/gynecologic.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceCategory(caseRecord, 'Obstetri & Ginekologi')
        && res.resolved_category === 'Obstetri & Ginekologi'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord?.subject) === 'gynaecology & obstetrics'
        && normalize(meta.organ_system) === 'pediatrics';
    },
  },
];

const WAVE11_BUCKETS = [
  {
    id: 'ipd-shock-anatomy-mixed-vs-anatomy-emergency',
    label: 'IPD shock stems split between anatomy and emergency care',
    rationale: 'Residual low-confidence IPD items where stale anatomy metadata competes with emergency/shock semantics, leaving both Anatomi and Anestesi & Emergency Medicine closer than the current label.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam, move to Anatomi, or move to Anestesi & Emergency Medicine based on whether the stem is factual anatomy or acute shock-management content.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      const text = getCaseText(caseRecord);
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Anatomi'
        && res.runner_up_category === 'Anestesi & Emergency Medicine'
        && normalize(caseRecord?.subject) === 'anatomy'
        && normalize(meta.organ_system) === 'general'
        && hasAnyTextFragment(text, ['shock']);
    },
  },
  {
    id: 'ipd-medicine-pediatrics-self-confirm-vs-pediatrics-tail',
    label: 'IPD medicine tails with persistent pediatrics overlap',
    rationale: 'Residual low-confidence IPD items where pediatrics remains the runner-up even though the current internal-medicine label still survives, suggesting either developmental content or noisy metadata.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Ilmu Kesehatan Anak because the stem is genuinely pediatric rather than adult/internal-medicine focused.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'Ilmu Kesehatan Anak'
        && normalize(caseRecord?.subject) === 'medicine'
        && normalize(meta.organ_system) === 'pediatrics';
    },
  },
  {
    id: 'ipd-ent-unknown-self-confirm-vs-tht-tail',
    label: 'IPD unknown-subject tails with ENT overlap',
    rationale: 'Residual low-confidence IPD items where the subject signal is unusable but ENT semantics keep THT close enough to deserve adjudication.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to THT because the stem is primarily ENT rather than general medicine.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Ilmu Penyakit Dalam'
        && res.runner_up_category === 'THT'
        && normalize(caseRecord?.subject) === 'unknown'
        && normalize(meta.organ_system) === 'ent';
    },
  },
  {
    id: 'ipd-neuro-medicine-mixed-vs-neurology',
    label: 'IPD medicine tails split with neurology',
    rationale: 'Residual low-confidence IPD items where neurological keywords pull the resolver toward Neurologi while the internal-medicine source label still hangs on as runner-up.',
    focus: 'Decide whether the item should keep Ilmu Penyakit Dalam or move to Neurologi because the stem is fundamentally neurologic rather than general medicine.',
    match(caseRecord) {
      const meta = caseRecord?.meta || {};
      const res = meta.category_resolution || {};
      return isResidualLowConfidenceIpd(caseRecord)
        && res.resolved_category === 'Neurologi'
        && res.runner_up_category === 'Ilmu Penyakit Dalam'
        && normalize(caseRecord?.subject) === 'medicine'
        && normalize(meta.organ_system) === 'neurological';
    },
  },
];

const BUCKET_PROFILES = {
  wave1: WAVE1_BUCKETS,
  wave2: WAVE2_BUCKETS,
  wave3: WAVE3_BUCKETS,
  wave4: WAVE4_BUCKETS,
  wave5: WAVE5_BUCKETS,
  wave6: WAVE6_BUCKETS,
  wave7: WAVE7_BUCKETS,
  wave8: WAVE8_BUCKETS,
  wave9: WAVE9_BUCKETS,
  wave10: WAVE10_BUCKETS,
  wave11: WAVE11_BUCKETS,
};

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function slugify(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hasTag(tags, expected) {
  if (!Array.isArray(tags)) return false;
  const normalizedExpected = normalize(expected);
  return tags.some((tag) => normalize(tag) === normalizedExpected);
}

function getCaseText(caseRecord) {
  return normalize([
    caseRecord?.title || '',
    caseRecord?.prompt || '',
    getNarrative(caseRecord),
    ...(Array.isArray(caseRecord?.options) ? caseRecord.options.map((option) => option?.text || '') : []),
  ].join(' '));
}

function hasAnyTextFragment(text, fragments) {
  return fragments.some((fragment) => text.includes(normalize(fragment)));
}

function isResidualLowConfidenceIpd(caseRecord) {
  return isResidualLowConfidenceCategory(caseRecord, 'Ilmu Penyakit Dalam');
}

function isResidualLowConfidenceCategory(caseRecord, category) {
  const meta = caseRecord?.meta || {};
  const resolution = meta.category_resolution || {};
  return caseRecord?.source === 'medmcqa'
    && meta.category_review_needed === true
    && caseRecord?.category === category
    && resolution.raw_normalized_category === category
    && normalize(resolution.confidence) === 'low';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath, rows) {
  const payload = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, payload ? `${payload}\n` : '', 'utf8');
}

function parseArgs(argv) {
  const options = {
    packName: '',
    model: DEFAULT_MODEL,
    profile: DEFAULT_PROFILE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pack-name') {
      options.packName = argv[index + 1] || options.packName;
      index += 1;
    } else if (arg === '--profile') {
      options.profile = argv[index + 1] || options.profile;
      index += 1;
    } else if (arg === '--model') {
      options.model = argv[index + 1] || options.model;
      index += 1;
    }
  }

  return options;
}

function hydrateCases(db) {
  const caseRows = db.prepare(`
    SELECT
      case_id,
      case_code,
      hash_id,
      q_type,
      category,
      title,
      prompt,
      source,
      subject,
      topic,
      vignette_json,
      rationale_json,
      meta_json
    FROM cases
    WHERE source = 'medmcqa'
    ORDER BY case_id
  `).all();

  const optionRows = db.prepare(`
    SELECT case_id, option_id, sort_order, option_text, is_correct
    FROM case_options
    WHERE case_id IN (SELECT case_id FROM cases WHERE source = 'medmcqa')
    ORDER BY case_id, sort_order
  `).all();

  const optionsByCaseId = new Map();
  for (const row of optionRows) {
    const list = optionsByCaseId.get(row.case_id) || [];
    list.push({
      id: row.option_id,
      text: row.option_text,
      is_correct: Boolean(row.is_correct),
    });
    optionsByCaseId.set(row.case_id, list);
  }

  return caseRows.map((row) => ({
    _id: row.case_id,
    case_code: row.case_code ?? '',
    hash_id: row.hash_id ?? null,
    q_type: row.q_type ?? '',
    category: row.category ?? '',
    title: row.title ?? '',
    prompt: row.prompt ?? '',
    source: row.source ?? '',
    subject: row.subject ?? '',
    topic: row.topic ?? '',
    vignette: JSON.parse(row.vignette_json || '{}'),
    rationale: JSON.parse(row.rationale_json || '{}'),
    meta: JSON.parse(row.meta_json || '{}'),
    options: optionsByCaseId.get(row.case_id) || [],
  }));
}

function getNarrative(caseRecord) {
  const vignette = caseRecord?.vignette;
  if (!vignette) return '';
  if (typeof vignette === 'string') return vignette;
  return vignette.narrative || '';
}

function getTargetCategory(caseRecord) {
  const resolution = caseRecord?.meta?.category_resolution || {};
  const resolved = normalize(resolution.resolved_category || '');
  const current = normalize(caseRecord?.category || '');
  const runnerUp = normalize(resolution.runner_up_category || '');

  if (!resolved) {
    return null;
  }
  if (resolved === current || resolved === runnerUp) {
    return null;
  }
  return resolution.resolved_category || null;
}

function buildPayload(caseRecord, bucket) {
  const meta = caseRecord.meta || {};
  const resolution = meta.category_resolution || {};
  const targetCategory = getTargetCategory(caseRecord);
  return {
    _id: caseRecord._id,
    case_code: caseRecord.case_code,
    source: caseRecord.source,
    bucket_id: bucket.id,
    bucket_label: bucket.label,
    bucket_rationale: bucket.rationale,
    current_category: caseRecord.category,
    raw_category: resolution.raw_category || null,
    raw_normalized_category: resolution.raw_normalized_category || null,
    current_resolved_category: resolution.resolved_category || null,
    target_category: targetCategory,
    runner_up_category: resolution.runner_up_category || null,
    runner_up_score: Number.isFinite(resolution.runner_up_score) ? resolution.runner_up_score : null,
    confidence: resolution.confidence || null,
    winning_signals: Array.isArray(resolution.winning_signals) ? resolution.winning_signals : [],
    subject: caseRecord.subject || meta.subject || '',
    topic: caseRecord.topic || meta.topic || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    organ_system: meta.organ_system || '',
    topic_keywords: Array.isArray(meta.topic_keywords) ? meta.topic_keywords : [],
    title: caseRecord.title || '',
    prompt: caseRecord.prompt || '',
    narrative: getNarrative(caseRecord),
    options: (caseRecord.options || []).map((option) => ({
      id: option.id,
      text: option.text,
    })),
  };
}

function buildUserPrompt(payload, bucket) {
  return [
    `Playbook: category_adjudication`,
    `Bucket: ${bucket.id}`,
    `Focus: ${bucket.focus}`,
    'Task: decide whether the item should keep the current category, promote to the runner-up category, or stay manual-review only.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function buildOpenAiRequest(caseRecord, payload, bucket, model) {
  return {
    custom_id: `category_ai|${bucket.id}|${caseRecord.source}|${caseRecord._id}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: CATEGORY_ADJUDICATION_SYSTEM,
        },
        {
          role: 'user',
          content: buildUserPrompt(payload, bucket),
        },
      ],
    },
  };
}

function buildGeminiRequest(caseRecord, payload, bucket) {
  return {
    custom_id: `category_ai|${bucket.id}|${caseRecord.source}|${caseRecord._id}`,
    playbook: 'category_adjudication',
    bucket_id: bucket.id,
    source: caseRecord.source,
    model: 'gemini-2.5-pro',
    response_mime_type: 'application/json',
    response_schema_hint: RESPONSE_SCHEMA_HINT,
    system_instruction: CATEGORY_ADJUDICATION_SYSTEM,
    user_prompt: buildUserPrompt(payload, bucket),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const buckets = BUCKET_PROFILES[options.profile] || WAVE1_BUCKETS;
  const packName = options.packName || DEFAULT_PACK_NAMES[options.profile] || DEFAULT_PACK_NAME;
  const db = new Database(DB_PATH, { readonly: true });
  const cases = hydrateCases(db);
  db.close();

  const packDir = path.join(OUTPUT_ROOT, slugify(packName));
  fs.rmSync(packDir, { recursive: true, force: true });
  const shortlistDir = path.join(packDir, 'shortlists');
  const openAiDir = path.join(packDir, 'openai');
  const geminiDir = path.join(packDir, 'gemini');
  ensureDir(shortlistDir);
  ensureDir(openAiDir);
  ensureDir(geminiDir);

  const manifestBuckets = [];

  for (const bucket of buckets) {
    const selected = cases.filter((caseRecord) => bucket.match(caseRecord));
    const shortlist = selected.map((caseRecord) => {
      const meta = caseRecord.meta || {};
      const resolution = meta.category_resolution || {};
      return {
        _id: caseRecord._id,
        case_code: caseRecord.case_code,
        current_category: caseRecord.category,
        target_category: getTargetCategory(caseRecord),
        runner_up_category: resolution.runner_up_category || null,
        runner_up_score: resolution.runner_up_score ?? null,
        subject: caseRecord.subject || meta.subject || '',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        organ_system: meta.organ_system || '',
        title: caseRecord.title || '',
        prompt: caseRecord.prompt || '',
      };
    });

    const openAiRows = selected.map((caseRecord) => {
      const payload = buildPayload(caseRecord, bucket);
      return buildOpenAiRequest(caseRecord, payload, bucket, options.model);
    });
    const geminiRows = selected.map((caseRecord) => {
      const payload = buildPayload(caseRecord, bucket);
      return buildGeminiRequest(caseRecord, payload, bucket);
    });

    const shortlistPath = path.join(shortlistDir, `${bucket.id}.json`);
    const openAiPath = path.join(openAiDir, `${bucket.id}.jsonl`);
    const geminiPath = path.join(geminiDir, `${bucket.id}.jsonl`);
    writeJson(shortlistPath, shortlist);
    writeJsonl(openAiPath, openAiRows);
    writeJsonl(geminiPath, geminiRows);

    manifestBuckets.push({
      id: bucket.id,
      label: bucket.label,
      rationale: bucket.rationale,
      focus: bucket.focus,
      total_items: selected.length,
      files: {
        shortlist: path.relative(ROOT, shortlistPath).replace(/\\/g, '/'),
        openai: path.relative(ROOT, openAiPath).replace(/\\/g, '/'),
        gemini: path.relative(ROOT, geminiPath).replace(/\\/g, '/'),
      },
    });
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    pack_name: packName,
    db_path: path.relative(ROOT, DB_PATH).replace(/\\/g, '/'),
    source: 'medmcqa',
    playbook: 'category_adjudication',
    profile: options.profile,
    model: options.model,
    response_schema_hint: RESPONSE_SCHEMA_HINT,
    buckets: manifestBuckets,
    notes: [
      'OpenAI files are ready for /v1/batches submission.',
      'Gemini files are prompt packs with system_instruction and user_prompt payloads.',
      'recommended_category must stay within current_category, runner_up_category, or target_category when provided.',
    ],
  };

  const manifestPath = path.join(packDir, 'manifest.json');
  writeJson(manifestPath, manifest);

  console.log('Category adjudication pack export complete');
  console.log(`Pack:     ${packDir}`);
  console.log(`Manifest: ${manifestPath}`);
  for (const bucket of manifestBuckets) {
    console.log(`  ${bucket.id}: ${bucket.total_items}`);
  }
}

main();
