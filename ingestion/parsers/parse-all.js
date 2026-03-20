/**
 * MedCase Pro — Universal Parser
 * Converts raw datasets into UMRS (Unified Medical Resource Schema)
 * 
 * Usage: node ingestion/parsers/parse-all.js
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { executeFrankensteinMerge } from '../engine/merger.js';
import { executeEnrichment } from '../engine/enrichment.js';
import { MedQAItemSchema, MedMCQAItemSchema, HeadQAItemSchema, validateBatch } from './schemas.js';

const SOURCES_DIR = join(import.meta.dirname, '..', 'sources');
const OUTPUT_DIR = join(import.meta.dirname, '..', 'output');

// ═══════════════════════════════════════
// MEDQA PARSER
// Schema: { question, options: {A,B,C,D}, answer_idx, answer, meta_info }
// MedQA HuggingFace: { question, options: {A,B,C,D}, answer_idx, answer }
// ═══════════════════════════════════════
function parseMedQA(rawData) {
  console.log(`  📊 Parsing ${rawData.length} MedQA items...`);
  
  return rawData.map((item, idx) => {
    const options = [];
    const optionKeys = ['A', 'B', 'C', 'D', 'E'];
    
    if (item.options && typeof item.options === 'object') {
      // HuggingFace format: options is { A: "...", B: "...", ... }
      for (const key of optionKeys) {
        if (item.options[key]) {
          options.push({
            id: key,
            text: item.options[key],
            is_correct: key === item.answer_idx || item.options[key] === item.answer,
          });
        }
      }
    }

    // Extract demographics from vignette (basic NLP)
    const demographics = extractDemographics(item.question);
    
    // Estimate difficulty from question complexity
    const difficulty = estimateDifficulty(item.question);

    return {
      _id: null, // Will be assigned during compile
      hash_id: `medqa_${idx}`,
      q_type: 'MCQ',
      confidence: 5.0, // Board-exam quality
      category: inferCategory(item.question, item.meta_info),
      title: generateTitle(item.question),
      vignette: {
        demographics,
        narrative: item.question,
        vitalSigns: null,
        labFindings: null,
      },
      prompt: extractPrompt(item.question),
      options,
      rationale: {
        correct: item.explanation || 'See reference for detailed explanation.',
        distractors: {},
        pearl: null,
      },
      meta: {
        tags: extractTags(item.question),
        provenance: ['MedQA-USMLE (Jin et al., 2021)'],
        original_difficulty: difficulty,
        examType: 'USMLE',
        difficulty: difficulty <= 0.5 ? 3 : difficulty <= 0.7 ? 2 : 1,
        source: 'medqa',
      }
    };
  }).filter(c => c.options.length >= 2); // Filter out malformed
}

function normalizeComparableText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectMedMCQACopBase(rawData) {
  const values = new Set(
    rawData
      .map((item) => Number.parseInt(item?.cop, 10))
      .filter((value) => Number.isInteger(value)),
  );

  if (values.has(0) && values.has(4)) {
    throw new Error('MedMCQA `cop` values are mixed 0-indexed and 1-indexed in the same batch.');
  }

  if (values.has(0)) {
    return 0;
  }

  if (values.has(4)) {
    return 1;
  }

  throw new Error(
    `Unable to infer MedMCQA \`cop\` base from values: ${[...values].sort((a, b) => a - b).join(', ') || 'none'}`,
  );
}

function rewriteIndexedRationale(text, correctOption) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return 'Refer to subject textbook for detailed explanation.';
  }

  if (!correctOption?.text) {
    return normalized;
  }

  const answerLeadPatterns = [
    /^ans(?:wer)?\.?\s*(?:is|:)?\s*['"`(]*[a-e]['"`)]?(?:\s*(?:i\.?\s*e\.?|ie)\.?)?\s*/i,
    /^(?:the\s+)?correct\s+answer\s+is\s*['"`(]*[a-e]['"`)]?\s*[:.)-]?\s*/i,
    /^answer\s+is\s*['"`(]*[a-e]['"`)]?\s*[:.)-]?\s*/i,
  ];

  for (const pattern of answerLeadPatterns) {
    if (!pattern.test(normalized)) {
      continue;
    }

    const stripped = normalized.replace(pattern, '').trim();
    if (!stripped) {
      return `The correct answer is ${correctOption.id}: ${correctOption.text}.`;
    }

    const comparableStripped = normalizeComparableText(stripped);
    const comparableCorrect = normalizeComparableText(correctOption.text);
    if (comparableStripped.startsWith(comparableCorrect)) {
      return `The correct answer is ${correctOption.id}: ${correctOption.text}.${stripped.slice(correctOption.text.length)}`;
    }

    return `The correct answer is ${correctOption.id}: ${correctOption.text}. ${stripped}`.trim();
  }

  return normalized;
}

function alignAnchoredAnswers(cases) {
  let realigned = 0;
  let rationaleRewritten = 0;

  for (const caseRecord of cases) {
    const anchorText = caseRecord.meta?.answer_anchor_text;
    if (!anchorText || !Array.isArray(caseRecord.options) || caseRecord.options.length === 0) {
      continue;
    }

    const anchorComparable = normalizeComparableText(anchorText);
    const anchoredIndex = caseRecord.options.findIndex(
      (option) => normalizeComparableText(option?.text) === anchorComparable,
    );

    if (anchoredIndex === -1) {
      continue;
    }

    caseRecord.options.forEach((option, index) => {
      const shouldBeCorrect = index === anchoredIndex;
      if (Boolean(option.is_correct) !== shouldBeCorrect) {
        option.is_correct = shouldBeCorrect;
        realigned += 1;
      }
    });

    if (caseRecord.rationale?.correct) {
      const rewritten = rewriteIndexedRationale(caseRecord.rationale.correct, caseRecord.options[anchoredIndex]);
      if (rewritten !== caseRecord.rationale.correct) {
        caseRecord.rationale.correct = rewritten;
        rationaleRewritten += 1;
      }
    }
  }

  return { realigned, rationaleRewritten };
}

// ═══════════════════════════════════════
// MEDMCQA PARSER
// Schema: { question, opa, opb, opc, opd, cop, exp, subject_name, topic_name }
// ═══════════════════════════════════════
function parseMedMCQA(rawData) {
  console.log(`  📊 Parsing ${rawData.length} MedMCQA items...`);
  const copBase = detectMedMCQACopBase(rawData);
  console.log(`  🧭 MedMCQA \`cop\` base detected: ${copBase}-indexed`);
  
  return rawData.map((item, idx) => {
    if (!item.question || !item.opa) return null;
    
    const rawCopValue = Number.parseInt(item.cop, 10);
    const copIndex = rawCopValue - copBase;
    const optionTexts = [item.opa, item.opb || '', item.opc || '', item.opd || ''];
    const options = [
      { id: 'A', text: item.opa, is_correct: copIndex === 0, source_slot: 'opa' },
      { id: 'B', text: item.opb || '', is_correct: copIndex === 1, source_slot: 'opb' },
      { id: 'C', text: item.opc || '', is_correct: copIndex === 2, source_slot: 'opc' },
      { id: 'D', text: item.opd || '', is_correct: copIndex === 3, source_slot: 'opd' },
    ].filter(o => o.text.length > 0);
    const correctOption = options.find((option) => option.is_correct) || null;

    const demographics = extractDemographics(item.question);
    const category = mapSubjectToCategory(item.subject_name);

    return {
      _id: null,
      hash_id: `medmcqa_${item.id || idx}`,
      q_type: 'MCQ',
      confidence: 4.0, // Academic entrance quality
      category,
      title: generateTitle(item.question),
      vignette: {
        demographics,
        narrative: item.question,
        vitalSigns: null,
        labFindings: null,
      },
      prompt: extractPrompt(item.question),
      options,
      rationale: {
        correct: rewriteIndexedRationale(item.exp, correctOption),
        distractors: {},
        pearl: null,
      },
      meta: {
        tags: [item.subject_name, item.topic_name].filter(Boolean).map(t => t.toLowerCase()),
        provenance: ['MedMCQA (Pal et al., 2022)'],
        original_difficulty: 0.5,
        examType: 'USMLE', // AIIMS/NEET maps closer to USMLE format
        difficulty: 2,
        source: 'medmcqa',
        subject: item.subject_name,
        topic: item.topic_name,
        source_cop_base: copBase,
        source_cop_value: rawCopValue,
        source_answer_index: copIndex,
        answer_anchor_text: optionTexts[copIndex] || '',
      }
    };
  }).filter(Boolean);
}

// ═══════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════

function extractDemographics(text) {
  const ageMatch = text.match(/(\d{1,3})[\s-]*(year|yr|yo|y\/o|month|day)/i);
  const sexMatch = text.match(/\b(male|female|man|woman|boy|girl)\b/i);
  
  let age = ageMatch ? parseInt(ageMatch[1]) : null;
  let sex = null;
  if (sexMatch) {
    const s = sexMatch[1].toLowerCase();
    sex = ['male', 'man', 'boy'].includes(s) ? 'M' : 'F';
  }
  
  return { age, sex };
}

function estimateDifficulty(question) {
  // Heuristic: longer questions with more clinical details tend to be harder
  const wordCount = question.split(/\s+/).length;
  if (wordCount > 100) return 0.4; // Hard
  if (wordCount > 60) return 0.6; // Medium
  return 0.75; // Easier
}

function generateTitle(question) {
  // Extract first meaningful clinical concept as title
  const cleaned = question.replace(/^(A|An)\s+/i, '');
  const firstSentence = cleaned.split(/[.?!]/)[0];
  if (firstSentence.length > 60) {
    return firstSentence.substring(0, 57) + '...';
  }
  return firstSentence;
}

function extractPrompt(question) {
  // Find the actual question (last sentence ending with ?)
  const sentences = question.split(/(?<=[.!?])\s+/);
  const questionSentences = sentences.filter(s => s.endsWith('?'));
  if (questionSentences.length > 0) {
    return questionSentences[questionSentences.length - 1];
  }
  // Fallback: last sentence
  return sentences[sentences.length - 1];
}

function extractTags(text) {
  const tags = [];
  const keywords = {
    'cardiology': /\b(heart|cardiac|coronary|STEMI|myocardial|arrhythmia|atrial|ventricular|ECG|EKG)\b/i,
    'pulmonology': /\b(lung|pulmonary|pneumonia|bronch|asthma|COPD|respiratory)\b/i,
    'gastroenterology': /\b(liver|hepat|gastric|intestin|colon|pancreat|GI|abdominal)\b/i,
    'nephrology': /\b(kidney|renal|nephro|dialysis|creatinine|GFR)\b/i,
    'endocrinology': /\b(diabetes|thyroid|adrenal|insulin|glucose|DKA|HbA1c)\b/i,
    'neurology': /\b(brain|neuro|stroke|seizure|epilepsy|headache|migraine)\b/i,
    'oncology': /\b(cancer|tumor|malignant|metasta|carcinoma|lymphoma|leukemia)\b/i,
    'infectious': /\b(infection|bacteria|virus|fungal|HIV|tubercul|sepsis|antibiotic)\b/i,
    'pediatrics': /\b(child|infant|neonate|pediatric|newborn|toddler)\b/i,
    'obstetrics': /\b(pregnan|gestation|preeclampsia|labor|delivery|fetal|trimester)\b/i,
    'psychiatry': /\b(depression|anxiety|schizo|bipolar|psychosis|suicid)\b/i,
    'surgery': /\b(surgery|surgical|appendect|cholecyst|hernia|fracture|trauma)\b/i,
    'dermatology': /\b(skin|rash|dermat|eczema|psoriasis|lesion)\b/i,
    'hematology': /\b(blood|anemia|platelet|coagul|thrombocyt|leukocyt)\b/i,
    'ophthalmology': /\b(eye|visual|retina|glaucoma|cataract|optic)\b/i,
  };
  
  for (const [tag, regex] of Object.entries(keywords)) {
    if (regex.test(text)) tags.push(tag);
  }
  
  return tags.length > 0 ? tags : ['general-medicine'];
}

function inferCategory(question, metaInfo) {
  const text = (question + ' ' + (metaInfo || '')).toLowerCase();
  
  // More specific categories FIRST to reduce internal-medicine over-counting
  if (/\b(pregnan|gestation|obstet|gynecol|cervic|ovarian|uterus|menstrual|antenatal|trimester|labor|delivery|fetal|placenta|preeclamp)\b/i.test(text))
    return 'obgyn';
  if (/\b(child|infant|neonate|pediatr|newborn|immuniz|breast.?feed|toddler|growth|development|mile.?stone|kawasaki|intussusception|febrile.?seizure)\b/i.test(text))
    return 'pediatrics';
  if (/\b(brain|neuro|stroke|seizure|epilepsy|meningit|guillain|multiple.?sclerosis|parkinson|alzheimer|cranial.?nerve|neuropathy)\b/i.test(text))
    return 'neurology';
  if (/\b(depress|anxiety|schizo|bipolar|psycho|mood|suicid|substance.?abuse|alcohol|eating.?disorder|personality.?disorder|PTSD|OCD|panic|phobia)\b/i.test(text))
    return 'psychiatry';
  if (/\b(surgery|surgical|fracture|appendic|hernia|wound|cholecystect|bowel.?obstruct|abdominal.?pain.*surg|peritonit|abscess.*drain)\b/i.test(text))
    return 'surgery';
  if (/\b(emergenc|resuscit|anaphylax|shock|trauma|CPR|burn|triage|ATLS|poisoning|overdose|cardiac.?arrest|tension.?pneumo)\b/i.test(text))
    return 'emergency';
  if (/\b(epidemiol|public.?health|vaccination|screening|prevalence|incidence|outbreak|biostatist|odds.?ratio|relative.?risk|sensitivity|specificity|PPV|NPV|cohort.?study|case.?control|RCT|clinical.?trial|bias|confound|environmental|occupational|sanitation|community|vector.?control|surveillance|WHO|IKM|preventive|promotive|forensic|medicolegal|death.?certificate|autopsy|visum)\b/i.test(text))
    return 'public-health';
  if (/\b(dermat|skin|rash|eczema|psoriasis|lesion|urticaria|acne|melanoma|pemphigus)\b/i.test(text))
    return 'internal-medicine';
  if (/\b(heart|cardiac|coronary|hypertens|arrhythm|atrial|ventricular|ECG|EKG|myocardial|heart.?failure|valvular|endocarditis|pericarditis)\b/i.test(text))
    return 'internal-medicine';
  if (/\b(diabet|thyroid|adrenal|insulin|glucose|DKA|HbA1c|pituitary|cushing|addison|pheochromocytoma)\b/i.test(text))
    return 'internal-medicine';
  if (/\b(liver|hepat|gastric|intestin|colon|pancreat|GI|abdominal|cirrhosis|IBD|crohn|ulcerative|celiac|GERD)\b/i.test(text))
    return 'internal-medicine';
  if (/\b(kidney|renal|nephro|dialysis|creatinine|GFR|glomerulo|nephrotic|nephritic)\b/i.test(text))
    return 'internal-medicine';
  if (/\b(lung|pulmonary|pneumonia|bronch|asthma|COPD|respiratory|tuberculosis|TB)\b/i.test(text))
    return 'internal-medicine';
  if (/\b(anemia|platelet|coagul|thrombocyt|leukocyt|lymphoma|leukemia|blood|hematol)\b/i.test(text))
    return 'internal-medicine';
  if (/\b(infection|bacteria|virus|fungal|HIV|sepsis|antibiotic|malaria|dengue|typhoid|rabies)\b/i.test(text))
    return 'internal-medicine';
  if (/\b(cancer|tumor|malignant|metasta|carcinoma|oncol|staging|chemo)\b/i.test(text))
    return 'internal-medicine';
  
  return 'internal-medicine'; // Default
}

function mapSubjectToCategory(subject) {
  if (!subject) return 'internal-medicine';
  const s = subject.toLowerCase();
  
  const mapping = {
    'medicine': 'internal-medicine',
    'anatomy': 'internal-medicine',
    'biochemistry': 'internal-medicine',
    'physiology': 'internal-medicine',
    'pathology': 'internal-medicine',
    'pharmacology': 'internal-medicine',
    'microbiology': 'internal-medicine',
    'surgery': 'surgery',
    'orthopedics': 'surgery',
    'dental': 'surgery',
    'ent': 'surgery',
    'ophthalmology': 'internal-medicine',
    'radiology': 'internal-medicine',
    'anesthesia': 'surgery',
    'skin': 'internal-medicine',
    'forensic medicine': 'public-health',
    'social & preventive medicine': 'public-health',
    'preventive & social medicine': 'public-health',
    'psm': 'public-health',
    'gynaecology & obstetrics': 'obgyn',
    'gynecology': 'obgyn',
    'obstetrics': 'obgyn',
    'o&g': 'obgyn',
    'pediatrics': 'pediatrics',
    'psychiatry': 'psychiatry',
    'virology': 'internal-medicine',
    'human aging': 'internal-medicine',
    'nutrition': 'public-health',
    'professional_psychology': 'psychiatry',
    'high_school_biology': 'internal-medicine',
  };
  
  for (const [key, val] of Object.entries(mapping)) {
    if (s.includes(key)) return val;
  }
  return 'internal-medicine';
}

// ═══════════════════════════════════════
// PUBMEDQA PARSER
// Schema: { pubid, question, context.contexts, final_decision (yes/no/maybe), long_answer }
// ═══════════════════════════════════════
function parsePubMedQA(rawData) {
  console.log(`  📊 Parsing ${rawData.length} PubMedQA items...`);
  return rawData.map((item, idx) => {
    if (!item.question) return null;
    const answer = (item.final_decision || '').toLowerCase();
    const options = [
      { id: 'A', text: 'Yes', is_correct: answer === 'yes' },
      { id: 'B', text: 'No', is_correct: answer === 'no' },
      { id: 'C', text: 'Maybe', is_correct: answer === 'maybe' },
    ];
    const context = Array.isArray(item.context?.contexts) ? item.context.contexts.join(' ') : '';
    return {
      _id: null, hash_id: `pubmedqa_${item.pubid || idx}`, q_type: 'MCQ', confidence: 4.0,
      category: inferCategory(item.question + ' ' + context, ''),
      title: generateTitle(item.question),
      vignette: { demographics: extractDemographics(context), narrative: context || item.question, vitalSigns: null, labFindings: null },
      prompt: item.question,
      options,
      rationale: { correct: item.long_answer || '', distractors: {}, pearl: null },
      meta: { tags: extractTags(item.question + ' ' + context), provenance: ['PubMedQA (Jin et al., 2019)'], difficulty: 2, examType: 'Research', source: 'pubmedqa' },
      validation: makeValidation(4, 4, 3, 1, item.long_answer ? 3 : 1, 4, 'USMLE'),
    };
  }).filter(Boolean);
}

// ═══════════════════════════════════════
// HEADQA PARSER (Spanish medical exam, English version)
// Schema: { qtext, ra (correct answer 1-4), answers: [{atext}] }
// ═══════════════════════════════════════
function parseHeadQA(rawData) {
  console.log(`  📊 Parsing ${rawData.length} HeadQA items...`);
  return rawData.map((item, idx) => {
    if (!item.qtext || !item.answers) return null;
    const optKeys = ['A','B','C','D','E'];
    const correctIdx = (parseInt(item.ra) || 1) - 1;
    const options = item.answers.map((a, i) => ({
      id: optKeys[i] || String(i+1), text: a.atext || '', is_correct: i === correctIdx,
    })).filter(o => o.text.length > 0);
    return {
      _id: null, hash_id: `headqa_${idx}`, q_type: 'MCQ', confidence: 4.0,
      category: inferCategory(item.qtext, item.category || ''),
      title: generateTitle(item.qtext),
      vignette: { demographics: extractDemographics(item.qtext), narrative: item.qtext, vitalSigns: null, labFindings: null },
      prompt: extractPrompt(item.qtext), options,
      rationale: { correct: '', distractors: {}, pearl: null },
      meta: { tags: extractTags(item.qtext), provenance: ['HeadQA (Vilares & Gómez-Rodríguez, 2019)'], difficulty: 2, examType: 'MIR', source: 'headqa' },
      validation: makeValidation(4, 4, 3, 1, 1, 4, 'USMLE'),
    };
  }).filter(Boolean);
}

// ═══════════════════════════════════════
// MMLU PARSER (Medical subsets)
// Schema: { question, choices: [...], answer: 0-3 }
// ═══════════════════════════════════════
function parseMMLU(rawData, subsetName) {
  console.log(`  📊 Parsing ${rawData.length} MMLU-${subsetName} items...`);
  const optKeys = ['A','B','C','D','E'];
  return rawData.map((item, idx) => {
    if (!item.question) return null;
    const correctIdx = typeof item.answer === 'number' ? item.answer : parseInt(item.answer) || 0;
    const choices = item.choices || [];
    const options = choices.map((c, i) => ({
      id: optKeys[i], text: c, is_correct: i === correctIdx,
    })).filter(o => o.text.length > 0);
    if (options.length < 2) return null;
    return {
      _id: null, hash_id: `mmlu_${subsetName}_${idx}`, q_type: 'MCQ', confidence: 3.5,
      category: inferCategory(item.question, subsetName),
      title: generateTitle(item.question),
      vignette: { demographics: extractDemographics(item.question), narrative: item.question, vitalSigns: null, labFindings: null },
      prompt: extractPrompt(item.question), options,
      rationale: { correct: '', distractors: {}, pearl: null },
      meta: { tags: extractTags(item.question), provenance: [`MMLU-${subsetName} (Hendrycks et al., 2021)`], difficulty: 2, examType: 'Academic', source: `mmlu-${subsetName}`, subject: subsetName },
      validation: makeValidation(4, 3, 3, 1, 1, 5, 'USMLE'),
    };
  }).filter(Boolean);
}

// ═══════════════════════════════════════
// MEDEXPQA PARSER
// Schema: { question, options: {}, correct_option, explanation }
// ═══════════════════════════════════════
function parseMedExpQA(rawData) {
  console.log(`  📊 Parsing ${rawData.length} MedExpQA items...`);
  const optKeys = ['A','B','C','D','E'];
  return rawData.map((item, idx) => {
    if (!item.question) return null;
    const options = [];
    if (item.options && typeof item.options === 'object') {
      for (const key of optKeys) {
        if (item.options[key]) options.push({ id: key, text: item.options[key], is_correct: key === item.correct_option });
      }
    }
    if (options.length < 2) return null;
    return {
      _id: null, hash_id: `medexpqa_${idx}`, q_type: 'MCQ', confidence: 4.0,
      category: inferCategory(item.question, ''),
      title: generateTitle(item.question),
      vignette: { demographics: extractDemographics(item.question), narrative: item.question, vitalSigns: null, labFindings: null },
      prompt: extractPrompt(item.question), options,
      rationale: { correct: item.explanation || '', distractors: {}, pearl: null },
      meta: { tags: extractTags(item.question), provenance: ['MedExpQA (HiTZ, 2024)'], difficulty: 2, examType: 'Expert', source: 'medexpqa' },
      validation: makeValidation(4, 4, 4, 1, item.explanation ? 4 : 1, 5, 'USMLE'),
    };
  }).filter(Boolean);
}

// ═══════════════════════════════════════
// UKMPPD WEB PARSER
// Schema from our scraper: { question, options: [{id,text,is_correct}], correct_answer, explanation, source }
// ═══════════════════════════════════════
function parseUKMPPD(rawData) {
  console.log(`  📊 Parsing ${rawData.length} UKMPPD items...`);
  return rawData.map((item, idx) => {
    if (!item.question || !item.options || item.options.length < 2) return null;
    const hasAnswer = item.correct_answer && item.correct_answer.length > 0;
    return {
      _id: null, hash_id: `ukmppd_web_${idx}`, q_type: 'MCQ', confidence: hasAnswer ? 3.0 : 1.5,
      category: inferCategory(item.question, ''),
      title: generateTitle(item.question),
      vignette: { demographics: extractDemographics(item.question), narrative: item.question, vitalSigns: null, labFindings: null },
      prompt: extractPrompt(item.question),
      options: item.options,
      rationale: { correct: item.explanation || '', distractors: {}, pearl: null },
      meta: { tags: extractTags(item.question), provenance: [item.source || 'informasikedokteran.com'], difficulty: 2, examType: 'UKMPPD', source: 'ukmppd-web' },
      validation: makeValidation(2, hasAnswer ? 2 : 1, 2, 5, item.explanation ? 3 : 1, 3, 'UKMPPD'),
    };
  }).filter(Boolean);
}

// ═══════════════════════════════════════
// VALIDATION SCORE GENERATOR
// 6-layer per-question scoring
// ═══════════════════════════════════════
function makeValidation(sourceAuth, expertVer, guideAlign, localized, reasoning, temporal, examContext) {
  const weights = { sourceAuthority: 0.25, expertVerified: 0.25, guidelineAligned: 0.20, localized: examContext === 'UKMPPD' ? 0.30 : 0.15, reasoningChain: 0.10, temporalValidity: 0.05 };
  const totalWeight = Object.values(weights).reduce((a,b) => a+b, 0);
  const overallScore = (sourceAuth * weights.sourceAuthority + expertVer * weights.expertVerified + guideAlign * weights.guidelineAligned + localized * weights.localized + reasoning * weights.reasoningChain + temporal * weights.temporalValidity) / totalWeight;
  
  const flags = [];
  if (localized <= 2 && examContext === 'UKMPPD') flags.push('NEEDS_LOCAL_REVIEW');
  if (reasoning <= 1) flags.push('NO_EXPLANATION');
  if (sourceAuth <= 1) flags.push('UNVERIFIED_SOURCE');
  
  return {
    overallScore: Math.round(overallScore * 10) / 10,
    layers: { sourceAuthority: sourceAuth, expertVerified: expertVer, guidelineAligned: guideAlign, localized, reasoningChain: reasoning, temporalValidity: temporal },
    flags, examContext,
  };
}

// ═══════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════

function main() {
  console.log('═══════════════════════════════════════');
  console.log(' MedCase Pro — Universal Parser v2');
  console.log(' (with 6-Layer Validation Scoring)');
  console.log('═══════════════════════════════════════\n');

  const allCases = [];

  // 1. MedQA
  const medqaFile = join(SOURCES_DIR, 'medqa', 'medqa_raw.json');
  if (existsSync(medqaFile)) {
    console.log('📂 Processing MedQA...');
    const raw = JSON.parse(readFileSync(medqaFile, 'utf-8'));
    const { valid: validatedMedQA } = validateBatch(raw, MedQAItemSchema, 'MedQA');
    const parsed = parseMedQA(validatedMedQA).map(c => ({ ...c, validation: makeValidation(5, 5, 4, 1, c.rationale.correct ? 3 : 1, 5, 'USMLE') }));
    console.log(`  ✅ Parsed ${parsed.length} MedQA cases\n`);
    allCases.push(...parsed);
  }

  // 2. MedMCQA
  const medmcqaFile = join(SOURCES_DIR, 'medmcqa', 'medmcqa_raw.json');
  if (existsSync(medmcqaFile)) {
    console.log('📂 Processing MedMCQA...');
    const raw = JSON.parse(readFileSync(medmcqaFile, 'utf-8'));
    const { valid: validatedMedMCQA } = validateBatch(raw, MedMCQAItemSchema, 'MedMCQA');
    const parsed = parseMedMCQA(validatedMedMCQA).map(c => ({ ...c, validation: makeValidation(4, 4, 3, 1, c.rationale.correct !== 'Refer to subject textbook for detailed explanation.' ? 4 : 1, 4, 'USMLE') }));
    console.log(`  ✅ Parsed ${parsed.length} MedMCQA cases\n`);
    allCases.push(...parsed);
  }

  // 3. PubMedQA
  const pubmedqaFile = join(SOURCES_DIR, 'pubmedqa', 'pubmedqa_raw.json');
  if (existsSync(pubmedqaFile)) {
    console.log('📂 Processing PubMedQA...');
    const raw = JSON.parse(readFileSync(pubmedqaFile, 'utf-8'));
    allCases.push(...parsePubMedQA(raw));
    console.log(`  ✅ Done\n`);
  }

  // 4. HeadQA (Spanish medical board — MIR — English translation)
  const headqaFile = join(SOURCES_DIR, 'headqa', 'headqa_raw.json');
  if (existsSync(headqaFile)) {
    console.log('📂 Processing HeadQA...');
    const raw = JSON.parse(readFileSync(headqaFile, 'utf-8'));
    const headqaCatMap = { Medicine: 'internal-medicine', Nursing: 'internal-medicine', Pharmacology: 'internal-medicine', Psychology: 'psychiatry', Biology: 'internal-medicine', Chemistry: 'internal-medicine' };
    let count = 0;
    for (const item of raw) {
      if (!item.question || !item.options || item.options.length < 2) continue;
      const cat = headqaCatMap[item.category] || 'internal-medicine';
      allCases.push({
        _id: null, hash_id: `headqa_${count}`, q_type: 'MCQ',
        confidence: 4.5,
        category: cat,
        title: generateTitle(item.question),
        vignette: { demographics: extractDemographics(item.question), narrative: item.question, vitalSigns: null, labFindings: null },
        prompt: extractPrompt(item.question),
        options: item.options,
        rationale: { correct: '', distractors: {}, pearl: null },
        meta: {
          tags: extractTags(item.question), provenance: [`HeadQA MIR-Spain (${item.category}, ${item.year})`],
          difficulty: 3, examType: 'MIR-Spain', source: 'headqa', headqaCategory: item.category,
        },
        validation: makeValidation(5, 5, 4, 1, 1, 4, 'MIR-Spain'),
      });
      count++;
    }
    console.log(`  📊 Parsing ${count} HeadQA items...`);
    console.log(`  ✅ Done\n`);
  }

  // 5. MedExpQA
  const medexpqaFile = join(SOURCES_DIR, 'medexpqa', 'medexpqa_raw.json');
  if (existsSync(medexpqaFile)) {
    console.log('📂 Processing MedExpQA...');
    const raw = JSON.parse(readFileSync(medexpqaFile, 'utf-8'));
    allCases.push(...parseMedExpQA(raw));
    console.log(`  ✅ Done\n`);
  }

  // 6. MMLU medical subsets
  const mmluSubsets = ['clinical_knowledge', 'medical_genetics', 'anatomy', 'college_medicine', 'college_biology', 'professional_medicine', 'nutrition'];
  for (const subset of mmluSubsets) {
    const mmluFile = join(SOURCES_DIR, `mmlu-${subset}`, `${subset}_raw.json`);
    if (existsSync(mmluFile)) {
      console.log(`📂 Processing MMLU-${subset}...`);
      const raw = JSON.parse(readFileSync(mmluFile, 'utf-8'));
      allCases.push(...parseMMLU(raw, subset));
      console.log(`  ✅ Done\n`);
    }
  }

  // 7. UKMPPD web scrape
  const ukmppdFile = join(SOURCES_DIR, 'ukmppd-web', 'ukmppd_raw.json');
  if (existsSync(ukmppdFile)) {
    console.log('📂 Processing UKMPPD (informasikedokteran.com)...');
    const raw = JSON.parse(readFileSync(ukmppdFile, 'utf-8'));
    allCases.push(...parseUKMPPD(raw));
    console.log(`  ✅ Done\n`);
  }

  // 8. LITFL Clinical Cases — tagged as CLINICAL_DISCUSSION (not MCQ)
  const litflFile = join(SOURCES_DIR, 'litfl', 'litfl_raw.json');
  if (existsSync(litflFile)) {
    console.log('📂 Processing LITFL...');
    const raw = JSON.parse(readFileSync(litflFile, 'utf-8'));
    const litflCategoryMap = { toxicology: 'emergency', ophthalmology: 'internal-medicine', trauma: 'surgery', cardiology: 'internal-medicine', pulmonary: 'internal-medicine', pediatrics: 'pediatrics', infectious: 'internal-medicine', neurology: 'neurology', emergency: 'emergency', obstetrics: 'obgyn' };
    let litflCount = 0;
    for (const item of raw) {
      if (!item.fullText || item.fullText.length < 50) continue;
      const cat = litflCategoryMap[item.specialty] || 'emergency';
      const hasQA = item.questions && item.questions.length > 0;
      allCases.push({
        _id: null, hash_id: `litfl_${litflCount}`, q_type: 'CLINICAL_DISCUSSION', confidence: 3.5,
        category: cat,
        title: item.title || generateTitle(item.fullText),
        vignette: { demographics: extractDemographics(item.fullText), narrative: item.vignette || item.fullText.substring(0, 2000), vitalSigns: null, labFindings: null },
        prompt: hasQA ? item.questions[0].q : extractPrompt(item.fullText),
        options: hasQA ? item.questions.map((q, qi) => ({ id: String(qi + 1), text: q.q, is_correct: false })) : [],
        rationale: { correct: hasQA ? item.questions.map(q => `**${q.q}**\n${q.a}`).join('\n\n') : item.fullText, distractors: {}, pearl: null },
        meta: { tags: [...extractTags(item.fullText), item.specialty], provenance: ['LITFL (CC-BY-NC-SA 4.0)'], difficulty: 2, examType: 'Clinical', source: 'litfl', specialty: item.specialty, url: item.url },
        validation: makeValidation(4, 3, 4, 1, hasQA ? 4 : 3, 5, 'USMLE'),
      });
      litflCount++;
    }
    console.log(`  ✅ Parsed ${litflCount} LITFL clinical cases\n`);
  }

  // 9. Geeky Medics (if scraped)
  const geekyFile = join(SOURCES_DIR, 'geekymedics', 'geekymedics_raw.json');
  if (existsSync(geekyFile)) {
    console.log('📂 Processing Geeky Medics...');
    const raw = JSON.parse(readFileSync(geekyFile, 'utf-8'));
    let count = 0;
    for (const item of raw) {
      if (!item.question || !item.options || item.options.length < 2) continue;
      allCases.push({
        _id: null, hash_id: `geekymedics_${count}`, q_type: 'MCQ', confidence: 3.5,
        category: inferCategory(item.question, item.category || ''),
        title: generateTitle(item.question),
        vignette: { demographics: extractDemographics(item.question), narrative: item.question, vitalSigns: null, labFindings: null },
        prompt: extractPrompt(item.question),
        options: item.options,
        rationale: { correct: item.explanation || '', distractors: {}, pearl: null },
        meta: { tags: extractTags(item.question), provenance: ['Geeky Medics'], difficulty: 2, examType: 'USMLE', source: 'geekymedics' },
        validation: makeValidation(3, 3, 3, 1, item.explanation ? 3 : 1, 5, 'USMLE'),
      });
      count++;
    }
    console.log(`  ✅ Parsed ${count} Geeky Medics cases\n`);
  }

  // 10. DocQuiz / Multi-source (if scraped)
  const docquizFile = join(SOURCES_DIR, 'docquiz', 'docquiz_raw.json');
  if (existsSync(docquizFile)) {
    console.log('📂 Processing DocQuiz...');
    const raw = JSON.parse(readFileSync(docquizFile, 'utf-8'));
    let count = 0;
    for (const item of raw) {
      if (!item.question || !item.options || item.options.length < 2) continue;
      const src = item.source || 'docquiz';
      allCases.push({
        _id: null, hash_id: `docquiz_${count}`, q_type: 'MCQ', confidence: 3.5,
        category: inferCategory(item.question, item.subject || ''),
        title: generateTitle(item.question),
        vignette: { demographics: extractDemographics(item.question), narrative: item.question, vitalSigns: null, labFindings: null },
        prompt: extractPrompt(item.question),
        options: item.options,
        rationale: { correct: item.explanation || '', distractors: {}, pearl: null },
        meta: { tags: extractTags(item.question), provenance: [src], difficulty: 2, examType: 'USMLE', source: 'docquiz', originalSource: src },
        validation: makeValidation(3, 3, 3, 1, item.explanation ? 3 : 1, 4, 'USMLE'),
      });
      count++;
    }
    console.log(`  ✅ Parsed ${count} DocQuiz cases\n`);
  }

  // 11. UKMPPD PDF/DOCX extracted questions
  const ukmppdPdfFile = join(SOURCES_DIR, 'ukmppd-pdf', 'ukmppd_pdf_raw.json');
  if (existsSync(ukmppdPdfFile)) {
    console.log('📂 Processing UKMPPD PDFs...');
    const raw = JSON.parse(readFileSync(ukmppdPdfFile, 'utf-8'));
    let count = 0;
    let withImgs = 0;
    for (const item of raw) {
      if (!item.question || !item.options || item.options.length < 2) continue;
      const hasAnswer = !!item.correct_answer;
      const images = item.images || [];
      if (images.length > 0) withImgs++;
      allCases.push({
        _id: null, hash_id: `ukmppdpdf_${count}`, q_type: 'MCQ',
        confidence: hasAnswer ? 4.0 : 2.5,
        category: inferCategory(item.question, ''),
        title: generateTitle(item.question),
        vignette: {
          demographics: extractDemographics(item.question), narrative: item.question,
          vitalSigns: null, labFindings: null, images,
        },
        prompt: extractPrompt(item.question),
        options: item.options,
        rationale: { correct: item.explanation || '', distractors: {}, pearl: null },
        meta: {
          tags: extractTags(item.question), provenance: [`UKMPPD PDF (${item.source})`],
          difficulty: 2, examType: 'UKMPPD', source: 'ukmppd-pdf', originalSource: item.source,
          needs_image: item.needs_image || false,
        },
        validation: makeValidation(3, hasAnswer ? 4 : 1, 3, 1, item.explanation ? 3 : 1, 3, 'UKMPPD'),
      });
      count++;
    }
    console.log(`  ✅ Parsed ${count} UKMPPD PDF cases (${withImgs} with images)\n`);
  }
  const extraMmluSubsets = ['virology', 'professional_psychology', 'high_school_biology', 'human_aging'];
  for (const subset of extraMmluSubsets) {
    const mmluFile = join(SOURCES_DIR, `mmlu-${subset}`, `${subset}_raw.json`);
    if (existsSync(mmluFile)) {
      console.log(`📂 Processing MMLU-${subset}...`);
      const raw = JSON.parse(readFileSync(mmluFile, 'utf-8'));
      allCases.push(...parseMMLU(raw, subset));
      console.log(`  ✅ Done\n`);
    }
  }

  // OLD: Simple 100-char fingerprint dedup (destructive, loses explanation data)
  // NEW: Frankenstein Merge Engine (enrichment: grafts explanations from donors)
  const mergedCases = executeFrankensteinMerge(allCases);

  // Rationale Enrichment: Hack 1 (Reverse-Lookup) + Hack 2 (Regex Cleaver) + Hack 3 (Kemenkes) + Hack 4 (LLM Queue)
  const enrichedCases = executeEnrichment(mergedCases);
  const answerAlignment = alignAnchoredAnswers(enrichedCases);
  console.log(`  🔒 Answer-anchor realignment: ${answerAlignment.realigned} option flags updated, ${answerAlignment.rationaleRewritten} rationale leads normalized`);

  // Quality filter: remove MCQ cases with <2 options or no correct answer
  let filteredOut = 0;
  const qualityCases = enrichedCases.filter(c => {
    if (c.q_type === 'CLINICAL_DISCUSSION') return true;
    if (!Array.isArray(c.options) || c.options.length < 2) { filteredOut++; return false; }
    const hasCorrect = c.options.some(o => o.is_correct);
    if (!hasCorrect) { filteredOut++; return false; }
    return true;
  });
  console.log(`  Quality-filtered: ${filteredOut} malformed MCQ cases`);
  console.log(`  Final count: ${qualityCases.length} (from ${allCases.length} raw)\n`);

  // Assign sequential IDs
  qualityCases.forEach((c, i) => { c._id = i; });

  // Write compiled output
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputFile = join(OUTPUT_DIR, 'compiled_cases.json');
  writeFileSync(outputFile, JSON.stringify(qualityCases, null, 0), 'utf-8');

  // Stats
  const stats = {};
  const sourceStats = {};
  const validationStats = { total: allCases.length, withExplanation: 0, withValidation: 0, avgScore: 0 };
  let scoreSum = 0;

  qualityCases.forEach(c => {
    stats[c.category] = (stats[c.category] || 0) + 1;
    const src = c.meta?.source || 'unknown';
    sourceStats[src] = (sourceStats[src] || 0) + 1;
    if (c.validation) { validationStats.withValidation++; scoreSum += c.validation.overallScore; }
    if (c.rationale?.correct && c.rationale.correct.length > 10) validationStats.withExplanation++;
  });
  validationStats.avgScore = validationStats.withValidation > 0 ? (scoreSum / validationStats.withValidation).toFixed(1) : 0;

  const mcqCount = qualityCases.filter(c => c.q_type === 'MCQ').length;
  const discussCount = qualityCases.filter(c => c.q_type === 'CLINICAL_DISCUSSION').length;

  console.log('═══════════════════════════════════════');
  console.log(` COMPILATION COMPLETE (v3 — Frankenstein Merge)`);
  console.log(`  Total cases: ${qualityCases.length}`);
  console.log(`    MCQ: ${mcqCount}`);
  console.log(`    Clinical Discussion: ${discussCount}`);
  console.log(`  With explanations: ${validationStats.withExplanation}`);
  console.log(`  Avg validation score: ${validationStats.avgScore}/5.0`);
  console.log(`  Quality-filtered: ${filteredOut}`);
  console.log(`  Output: ${outputFile}`);
  console.log(`\n  By Source:`);
  Object.entries(sourceStats).sort((a,b) => b[1]-a[1]).forEach(([src, count]) => {
    console.log(`    ${src}: ${count}`);
  });
  console.log(`\n  By Category:`);
  Object.entries(stats).sort((a,b) => b[1]-a[1]).forEach(([cat, count]) => {
    const pct = ((count / qualityCases.length) * 100).toFixed(1);
    console.log(`    ${cat}: ${count} (${pct}%)`);
  });
  console.log('═══════════════════════════════════════');
}

main();
