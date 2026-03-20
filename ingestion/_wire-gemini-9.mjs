/**
 * Wire 9 Gemini-translated IgakuQA with proper SKDI categories + case_codes
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const maxId = Math.max(...db.map(c => c._id || 0));

// SKDI category mapping based on question content
const cases = [
  {
    sample_id: '113A58', year: 2019,
    category: 'Neurologi',   // DLB = neurology
    question: 'A 72-year-old man presents with a chief complaint of visual hallucinations. For the past year, his wife has noted that he shouts, kicks his blankets, and thrashes his legs during sleep. Around the same time, he began experiencing occasional lightheadedness upon standing. Over the past 6 months, his eating and dressing have gradually slowed. One month ago, he began claiming that "strangers are dancing in the room" during the night. He is alert and oriented. Height 163 cm, weight 56 kg. Temperature 36.4°C. Pulse 68/min. BP 158/86 mmHg. Revised Hasegawa Dementia Scale 23/30, MMSE 25/30. Mild symmetrical muscle rigidity in extremities. Stooped posture with short-stepped gait. Which of the following is the most useful for diagnosis?',
    options: [
      { id: 'A', text: 'Blood CK', is_correct: false },
      { id: 'B', text: 'Head MRI', is_correct: false },
      { id: 'C', text: 'Cerebrospinal fluid analysis', is_correct: false },
      { id: 'D', text: 'Brain perfusion SPECT', is_correct: true },
      { id: 'E', text: 'Abdominal ultrasound', is_correct: false },
    ],
    rationale: 'The patient exhibits core features of Dementia with Lewy Bodies (DLB): visual hallucinations, REM sleep behavior disorder, dysautonomia, and parkinsonism. Brain perfusion SPECT shows reduced occipital blood flow, differentiating DLB from Alzheimer\'s.',
  },
  {
    sample_id: '115C60', year: 2021,
    category: 'Bedah',  // post-op sepsis/qSOFA
    question: 'A 65-year-old man is hospitalized following esophageal cancer surgery. 10 days post-op, central venous catheter placed 7 days ago. This morning at 9 AM, altered mental status noted. Consciousness JCS II-10, GCS E3V4M6. Temperature 38.5°C. Pulse 114/min. BP 88/50 mmHg. RR 24/min. SpO2 96%. WBC 17,300 with left shift. CRP 24 mg/dL. What is his quick SOFA (qSOFA) score at this time?',
    options: [
      { id: 'A', text: '0 points', is_correct: false },
      { id: 'B', text: '1 point', is_correct: false },
      { id: 'C', text: '2 points', is_correct: false },
      { id: 'D', text: '3 points', is_correct: true },
      { id: 'E', text: '4 points', is_correct: false },
    ],
    rationale: 'qSOFA: altered mental status (GCS 13), SBP ≤100 (88), RR ≥22 (24). All 3 criteria met = score 3. Likely CLABSI-related sepsis.',
  },
  {
    sample_id: '116E41', year: 2022,
    category: 'Ilmu Penyakit Dalam',  // COPD exacerbation
    question: 'An 83-year-old man presents with dyspnea. 6-year history of respiratory disease, on Home Oxygen Therapy. SpO2 88% on 1L nasal cannula. Expiratory wheezing, pursed-lip breathing. ABG (1L O2): pH 7.33, PaCO2 56 Torr, PaO2 58 Torr, HCO3- 30 mEq/L. What is the appropriate oxygen delivery dose?',
    options: [
      { id: 'A', text: 'Nasal cannula 2 L/min', is_correct: true },
      { id: 'B', text: 'Nasal cannula 4 L/min', is_correct: false },
      { id: 'C', text: 'Nasal cannula 6 L/min', is_correct: false },
      { id: 'D', text: 'Face mask 6 L/min', is_correct: false },
      { id: 'E', text: 'Face mask 10 L/min', is_correct: false },
    ],
    rationale: 'COPD with type II respiratory failure and chronic CO2 retention. High-flow O2 suppresses hypoxic respiratory drive → CO2 narcosis. Controlled low-flow (2L) targets SpO2 88-92%.',
  },
  {
    sample_id: '113C51', year: 2019,
    category: 'Obstetri & Ginekologi',  // GDM
    question: 'A 36-year-old primigravida at 33 weeks presents with fatigue and polydipsia. Blood glucose 255 mg/dL, HbA1c 7.8%. Anti-GAD antibody negative. Estimated fetal weight 2,450g (+2.0 SD). Which statement about the maternal and fetal condition is correct?',
    options: [
      { id: 'A', text: 'This is pregnancy complicated by pre-existing diabetes mellitus', is_correct: false },
      { id: 'B', text: 'The fetus is prone to hypoglycemia', is_correct: false },
      { id: 'C', text: 'Her glucose tolerance one week ago was normal', is_correct: false },
      { id: 'D', text: 'Insulin resistance has occurred due to the pregnancy', is_correct: true },
      { id: 'E', text: 'Maternal hyperglycemia correlates with fetal overweight', is_correct: false },
    ],
    rationale: 'Placental hormones (hPL, cortisol, progesterone) induce maternal insulin resistance. When pancreas cannot compensate, gestational diabetes develops.',
  },
  {
    sample_id: '114C72', year: 2020,
    category: 'Farmakologi',  // medication management
    question: 'A 76-year-old woman with hypertension, osteoporosis, and knee osteoarthritis presents bedridden with fatigue. BP 86/54. BUN 52, Cr 2.2, Ca 12.4 mg/dL. Medications: Amlodipine 5mg, Aspirin 100mg, Mecobalamin 500μg, Alfacalcidol 1μg, Loxoprofen 60mg. Which medications should be discontinued?',
    options: [
      { id: 'A', text: 'Antihypertensive drug (Amlodipine)', is_correct: true },
      { id: 'B', text: 'Antiplatelet drug (Aspirin)', is_correct: false },
      { id: 'C', text: 'Vitamin B12 (Mecobalamin)', is_correct: false },
      { id: 'D', text: 'Active Vitamin D (Alfacalcidol)', is_correct: false },
      { id: 'E', text: 'NSAID (Loxoprofen)', is_correct: false },
    ],
    rationale: 'Hypotension (BP 86/54) contraindicates continuing antihypertensive. Also should stop NSAID (AKI) and Alfacalcidol (worsening hypercalcemia).',
  },
  {
    sample_id: '114D52', year: 2020,
    category: 'Bedah',  // hilar cholangiocarcinoma workup
    question: 'An 80-year-old woman presents with RUQ pain, weight loss, and jaundice. Total bilirubin 4.8, CEA 6.7, CA19-9 89. Abdominal US shows bilateral intrahepatic bile duct dilation with cutoff at hepatic hilum. What is the most appropriate next test?',
    options: [
      { id: 'A', text: 'Contrast-enhanced abdominal CT', is_correct: true },
      { id: 'B', text: 'Endoscopic ultrasound (EUS)', is_correct: false },
      { id: 'C', text: 'Lower GI endoscopy', is_correct: false },
      { id: 'D', text: 'Upper GI endoscopy', is_correct: false },
      { id: 'E', text: 'ERCP', is_correct: false },
    ],
    rationale: 'Hilar biliary obstruction suggests Klatskin tumor or GB cancer. CT with contrast is standard next step for staging, vascular involvement, and metastases before invasive procedures like ERCP.',
  },
  {
    sample_id: '115E47', year: 2021,
    category: 'Ilmu Penyakit Dalam',  // C. diff infection control
    question: 'A 75-year-old man with fever, abdominal pain, and watery diarrhea 5x/day, 4 days after discharge on oral antibiotics for cellulitis. Which infection prevention measure during examination is INCORRECT?',
    options: [
      { id: 'A', text: 'Examination in a private room', is_correct: false },
      { id: 'B', text: 'Wearing goggles during rectal examination', is_correct: false },
      { id: 'C', text: 'Wearing disposable gown upon entering', is_correct: false },
      { id: 'D', text: 'Wearing surgical mask when collecting stool', is_correct: false },
      { id: 'E', text: 'Hand hygiene with sodium hypochlorite after examination', is_correct: true },
    ],
    rationale: 'C. difficile suspicion. Sodium hypochlorite (bleach) is for environmental surfaces, NEVER for hand hygiene (toxic to skin). Hands must be washed with soap and water; alcohol sanitizers ineffective against spores.',
  },
  {
    sample_id: '116C69', year: 2022,
    category: 'Neurologi',  // ALS
    question: 'A 56-year-old woman diagnosed with ALS. Neurological exam: ① Eye movements normal, ② Masseter/orbicularis oris strength preserved, ③ Tongue atrophy with fasciculations, ④ Can stand but walking needs support, ⑤ Excretion possible. Which underlined functions will likely be preserved in the future?',
    options: [
      { id: 'A', text: '① Eye movements', is_correct: true },
      { id: 'B', text: '② Jaw/lip muscles', is_correct: false },
      { id: 'C', text: '③ Tongue function', is_correct: false },
      { id: 'D', text: '④ Standing/walking', is_correct: false },
      { id: 'E', text: '⑤ Sphincter control', is_correct: false },
    ],
    rationale: 'ALS classically spares extraocular muscles, sphincter control, sensory nerves, and cognition ("negative signs"). Eye movements (①) and sphincter function (⑤) are typically preserved.',
  },
  {
    sample_id: '116E47', year: 2022,
    category: 'Ilmu Penyakit Dalam',  // Bayes theorem / clinical epidemiology
    question: 'A 21-year-old woman with fever, sore throat, tonsillar exudate, and posterior (not anterior) cervical lymphadenopathy. Centor score = 3 items. Pre-test probability for GAS pharyngitis at score 3 is 35%. Rapid antigen test negative (LR- = 0.2). What is the post-test probability?',
    options: [
      { id: 'A', text: '10%', is_correct: true },
      { id: 'B', text: '25%', is_correct: false },
      { id: 'C', text: '40%', is_correct: false },
      { id: 'D', text: '50%', is_correct: false },
      { id: 'E', text: '75%', is_correct: false },
    ],
    rationale: 'Pre-test odds = 0.35/0.65 = 0.538. Post-test odds = 0.538 × 0.2 (negative LR) = 0.1076. Post-test probability = 0.1076/1.1076 ≈ 9.7% ≈ 10%.',
  },
];

let added = 0;
for (const c of cases) {
  // Map category to case_code prefix
  const catMap = {
    'Neurologi': 'NEU', 'Bedah': 'BDH', 'Ilmu Penyakit Dalam': 'IPD',
    'Obstetri & Ginekologi': 'OBG', 'Farmakologi': 'FRM',
  };
  const catCode = catMap[c.category] || 'GEN';
  const seq = String(138 + added).padStart(5, '0');  // after 137 existing
  
  db.push({
    _id: maxId + 1 + added,
    case_code: `IGK-${catCode}-MCQ-${seq}`,
    question: c.question,
    title: c.question.length <= 80 ? c.question : c.question.slice(0, 77) + '...',
    options: c.options,
    rationale: { correct: c.rationale },
    category: c.category,
    q_type: 'MCQ',
    meta: {
      source: 'igakuqa',
      original_year: c.year,
      original_id: c.sample_id,
      difficulty_score: 1,
      tags: ['japanese-medical-exam', 'translated', 'gemini-translated'],
    },
  });
  added++;
}

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log(`✅ Wired ${added} Gemini IgakuQA. Total DB: ${db.length}`);
// Show case codes
cases.forEach((c, i) => {
  const catMap = { 'Neurologi': 'NEU', 'Bedah': 'BDH', 'Ilmu Penyakit Dalam': 'IPD', 'Obstetri & Ginekologi': 'OBG', 'Farmakologi': 'FRM' };
  const catCode = catMap[c.category] || 'GEN';
  console.log(`  IGK-${catCode}-MCQ-${String(138+i).padStart(5,'0')}  ${c.category}  ${c.sample_id}`);
});
