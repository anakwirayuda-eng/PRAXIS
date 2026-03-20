/**
 * Wire PedMedQA (2,682) + MedExpQA (125) into compiled_cases.json
 * 
 * - Assigns SKDI-standard categories via keyword mapping
 * - Generates semantic case_codes: PMD-{CAT}-MCQ-{SEQ} / MEQ-{CAT}-MCQ-{SEQ}
 * - Keeps _id sequential from max existing _id
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

// ── SKDI category mapper (keyword-based) ──
const CATEGORY_KEYWORDS = {
  'Ilmu Penyakit Dalam': ['diabetes','hypertension','hepatitis','cirrhosis','anemia','lupus','thyroid','cardiac','heart failure','myocardial','atrial','coronary','angina','endocarditis','pneumonia','tuberculosis','asthma','copd','renal','kidney','glomerulo','nephrotic','nephritic','liver','pancreatitis','gastrointestinal','peptic','ulcer','crohn','colitis','rheumatoid','arthritis','gout','sle','hiv','malaria','dengue','sepsis','meningitis','cellulitis','uti','pyelonephritis','electrolyte','acid-base','dka','addison','cushing','pheochromocytoma','acromegaly','hyperthyroid','hypothyroid','leukemia','lymphoma','myeloma','iron deficiency','b12','folate','sickle cell','thalassemia','dvt','pulmonary embolism','pleural effusion','lung cancer'],
  'Bedah': ['appendicitis','cholecystitis','hernia','bowel obstruction','intussusception','volvulus','fracture','dislocation','compartment syndrome','surgical','trauma','wound','burn','abscess','peritonitis','diverticulitis','hemorrhoids','fistula','pilonidal','mastectomy','thyroidectomy','splenectomy','laparoscop'],
  'Obstetri & Ginekologi': ['pregnancy','pregnant','trimester','preeclampsia','eclampsia','gestational','labor','delivery','postpartum','cesarean','placenta','ectopic','miscarriage','abortion','cervical','uterine','ovarian','endometriosis','pcos','amenorrhea','menstrual','contraception','pap smear','breastfeeding','obstetric','gynecolog','vulvovaginal','fibroids'],
  'Ilmu Kesehatan Anak': ['infant','newborn','neonate','pediatric','child','toddler','adolescent','vaccination','immunization','growth','developmental','milestone','failure to thrive','kawasaki','neonatal','jaundice','congenital','croup','bronchiolitis','roseola','measles','mumps','rubella','chickenpox','pertussis','sudden infant','sids','pyloric stenosis','hirschsprung','tracheoesophageal'],
  'Neurologi': ['stroke','seizure','epilepsy','headache','migraine','multiple sclerosis','parkinson','alzheimer','dementia','neuropathy','guillain','myasthenia','cerebral','meningitis','encephalitis','lumbar puncture','csf','cranial nerve','motor neuron','ataxia','vertigo','bell palsy','trigeminal'],
  'Psikiatri': ['depression','anxiety','bipolar','schizophrenia','psychosis','ocd','ptsd','panic','phobia','eating disorder','anorexia','bulimia','substance abuse','alcohol','suicide','delirium','personality disorder','adhd','autism','insomnia','psychiatric','antidepressant','antipsychotic','benzodiazepine','lithium'],
  'Kulit & Kelamin': ['dermatitis','eczema','psoriasis','acne','urticaria','melanoma','basal cell','squamous cell','skin','rash','vesicle','bulla','papule','macule','fungal infection','tinea','scabies','herpes','warts','vitiligo','alopecia','pemphigus','stevens-johnson','drug eruption','skin biopsy'],
  'Mata': ['cataract','glaucoma','retinopathy','macular','conjunctivitis','uveitis','optic neuritis','strabismus','amblyopia','visual field','intraocular','corneal','retinal','eye','vision loss','diplopia','papilledema','orbital'],
  'THT': ['otitis','hearing loss','tonsillitis','pharyngitis','sinusitis','epistaxis','laryngitis','stridor','dysphagia','ear','nasal','throat','tympanic','cholesteatoma','vertigo','meniere','vocal cord','acoustic neuroma','tracheostomy'],
  'Ilmu Kesehatan Masyarakat': ['epidemiolog','prevalence','incidence','screening','sensitivity','specificity','odds ratio','relative risk','public health','vaccine','outbreak','quarantine','surveillance','mortality rate','morbidity','biostatistics','randomized','clinical trial','cohort','case-control','cross-sectional','bias','confound'],
  'Farmakologi': ['drug','pharmacokinetic','pharmacodynamic','mechanism of action','side effect','adverse effect','toxicity','overdose','antidote','receptor','agonist','antagonist','inhibitor','enzyme','metabolism','clearance','half-life','bioavailability','interaction','contraindication','dosage'],
  'Forensik': ['autopsy','postmortem','cause of death','manner of death','forensic','rigor mortis','livor mortis','decomposition','toxicolog','medico-legal','wound pattern','asphyxia','drowning','hanging','poisoning','child abuse','sexual assault','time of death','death certificate'],
  'Anestesi & Emergency Medicine': ['intubation','ventilator','anesthesia','sedation','airway','cpr','resuscitation','shock','anaphylaxis','cardiac arrest','emergency','triage','trauma','icu','critical care','mechanical ventilation','vasopressor'],
  'Radiologi': ['x-ray','ct scan','mri','ultrasound','mammograph','radiograph','imaging','barium','contrast','radioluc','radiopaque'],
};

function categorize(text) {
  const lower = (text || '').toLowerCase();
  let bestCat = 'Ilmu Penyakit Dalam'; // fallback
  let bestScore = 0;
  
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }
  return bestCat;
}

// Category → 3-char code mapping
const CAT_CODES = {
  'Ilmu Penyakit Dalam': 'IPD', 'Bedah': 'BDH', 'Obstetri & Ginekologi': 'OBG',
  'Ilmu Kesehatan Anak': 'ANA', 'Neurologi': 'NEU', 'Psikiatri': 'PSI',
  'Kulit & Kelamin': 'KLT', 'Mata': 'MTA', 'THT': 'THT',
  'Ilmu Kesehatan Masyarakat': 'IKM', 'Farmakologi': 'FRM', 'Forensik': 'FOR',
  'Anestesi & Emergency Medicine': 'ANS', 'Radiologi': 'RAD',
};

console.log('📦 Wiring PedMedQA + MedExpQA');
console.log('━'.repeat(60));

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
let maxId = Math.max(...db.map(c => c._id || 0));
const codeCounters = {};

function makeCode(srcCode, catCode) {
  const key = `${srcCode}-${catCode}-MCQ`;
  codeCounters[key] = (codeCounters[key] || 0) + 1;
  return `${key}-${String(codeCounters[key]).padStart(5, '0')}`;
}

// ── 1. PedMedQA ──
const ped = JSON.parse(readFileSync(join(__dirname, 'sources/pedmedqa/pedmedqa_raw.json'), 'utf8'));
let pedAdded = 0;
const pedCats = {};

for (const p of ped) {
  maxId++;
  const opts = (p.options || []).map((text, i) => ({
    id: String.fromCharCode(65 + i),
    text: typeof text === 'string' ? text : (text.text || String(text)),
    is_correct: String.fromCharCode(65 + i) === p.correct_answer,
  }));
  
  if (opts.length < 2) continue;
  
  const category = categorize(p.question);
  const catCode = CAT_CODES[category] || 'GEN';
  
  pedCats[category] = (pedCats[category] || 0) + 1;
  
  db.push({
    _id: maxId,
    case_code: makeCode('PMD', catCode),
    title: (p.question || '').slice(0, 80),
    question: p.question,
    category,
    q_type: 'MCQ',
    options: opts,
    rationale: { correct: '', distractors: {}, pearl: null },
    vignette: { narrative: p.question, demographics: {} },
    meta: {
      source: 'pedmedqa',
      tags: [],
      quality_score: opts.some(o => o.is_correct) ? 50 : 25,
      organ_system: 'pediatrics',
      topic_keywords: p.category ? [p.category] : [],
      language: 'en',
      age_years: p.age_years || null,
      exam_type: p.examType || null,
    },
  });
  pedAdded++;
}

console.log(`✅ PedMedQA: ${pedAdded} cases added`);
console.log('   Category distribution:');
for (const [c, n] of Object.entries(pedCats).sort((a,b) => b[1]-a[1])) {
  console.log(`     ${c}: ${n}`);
}

// ── 2. MedExpQA ──
const medRaw = JSON.parse(readFileSync(join(__dirname, 'sources/medexpqa/medexpqa_raw.json'), 'utf8'));
const medItems = Array.isArray(medRaw) ? medRaw : Object.values(medRaw).flat();
let medAdded = 0;

for (const m of medItems) {
  maxId++;
  const question = m.full_question || m.question || '';
  if (!question || question.length < 20) continue;
  
  const opts = Object.entries(m.options || {}).map(([key, text]) => ({
    id: key,
    text: typeof text === 'string' ? text : String(text),
    is_correct: Number(key) === m.correct_option,
  }));
  
  if (opts.length < 2) continue;
  
  // Build rationale from explanations
  const explanations = m.explanations || {};
  const correctExpl = explanations[String(m.correct_option)]?.text || m.full_answer_no_ref || m.full_answer || '';
  const distractors = {};
  for (const [k, v] of Object.entries(explanations)) {
    if (Number(k) !== m.correct_option && v?.text) {
      distractors[opts.find(o => o.id === k)?.id || k] = v.text;
    }
  }
  
  const category = categorize(question);
  const catCode = CAT_CODES[category] || 'GEN';
  
  db.push({
    _id: maxId,
    case_code: makeCode('MEQ', catCode),
    title: question.slice(0, 80),
    question,
    category,
    q_type: 'MCQ',
    options: opts,
    rationale: {
      correct: correctExpl.slice(0, 2000),
      distractors,
      pearl: null,
    },
    vignette: { narrative: question, demographics: {} },
    meta: {
      source: 'medexpqa',
      tags: [],
      quality_score: correctExpl.length > 50 ? 80 : 50,
      language: m.lang || 'en',
      topic_keywords: [],
    },
  });
  medAdded++;
}

console.log(`✅ MedExpQA: ${medAdded} cases added`);
console.log(`\n📊 Total DB: ${db.length.toLocaleString()} cases`);

const tmp = `${DB_PATH}.tmp`;
writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
renameSync(tmp, DB_PATH);
console.log('💾 Saved.');
