/**
 * MedCase Pro — Unified Medical Resource Schema (UMRS)
 * Clinical Case Bank with sample cases across all categories
 * Follows the UMRS schema from the Deepthink architecture
 */

export const CATEGORIES = {
  'Ilmu Penyakit Dalam': { label: 'Ilmu Penyakit Dalam', labelEn: 'Internal Medicine', color: '#6366f1', icon: 'Heart' },
  'Bedah': { label: 'Bedah', labelEn: 'Surgery', color: '#ef4444', icon: 'Scissors' },
  'Obstetri & Ginekologi': { label: 'Obstetri & Ginekologi', labelEn: 'OB/GYN', color: '#ec4899', icon: 'Baby' },
  'Ilmu Kesehatan Anak': { label: 'Ilmu Kesehatan Anak', labelEn: 'Pediatrics', color: '#f59e0b', icon: 'SmilePlus' },
  'Neurologi': { label: 'Neurologi', labelEn: 'Neurology', color: '#8b5cf6', icon: 'Brain' },
  'Psikiatri': { label: 'Psikiatri', labelEn: 'Psychiatry', color: '#14b8a6', icon: 'HeartHandshake' },
  'Anestesi & Emergency Medicine': { label: 'Anestesi & Emergency Medicine', labelEn: 'Emergency', color: '#f97316', icon: 'Siren' },
  'Ilmu Kesehatan Masyarakat': { label: 'IKM', labelEn: 'Public Health', color: '#22c55e', icon: 'ShieldCheck' },
  'Radiologi': { label: 'Radiologi', labelEn: 'Radiology', color: '#06b6d4', icon: 'Search' },
  'Mata': { label: 'Mata', labelEn: 'Ophthalmology', color: '#3b82f6', icon: 'Eye' },
  'THT': { label: 'THT', labelEn: 'ENT', color: '#a855f7', icon: 'Ear' },
  'Kulit & Kelamin': { label: 'Kulit & Kelamin', labelEn: 'Dermatology', color: '#e879f9', icon: 'Fingerprint' },
  'Forensik': { label: 'Forensik', labelEn: 'Forensic Medicine', color: '#64748b', icon: 'Scale' },
  'Farmakologi': { label: 'Farmakologi', labelEn: 'Pharmacology', color: '#10b981', icon: 'Pill' },
  'Anatomi': { label: 'Anatomi', labelEn: 'Anatomy', color: '#f43f5e', icon: 'Bone' },
  'Kedokteran Gigi': { label: 'Kedokteran Gigi', labelEn: 'Dentistry', color: '#fbbf24', icon: 'Smile' },
  'Biokimia': { label: 'Biokimia', labelEn: 'Biochemistry', color: '#84cc16', icon: 'FlaskConical' },
  'Mikrobiologi': { label: 'Mikrobiologi', labelEn: 'Microbiology', color: '#0ea5e9', icon: 'Bug' },
  'Patologi Anatomi': { label: 'Patologi Anatomi', labelEn: 'Pathology', color: '#d946ef', icon: 'Microscope' },
  'Rehabilitasi Medik': { label: 'Rehabilitasi Medik', labelEn: 'Rehab Medicine', color: '#78716c', icon: 'Activity' },
  'Unclassified': { label: 'Unclassified', labelEn: 'Unclassified', color: '#94a3b8', icon: 'HelpCircle' },
};

export const EXAM_TYPES = {
  UKMPPD: 'UKMPPD',
  USMLE: 'USMLE',
  BOTH: 'BOTH'
};

/**
 * Sample Case Bank
 * Each case follows the UnifiedCase schema (UMRS)
 */
export const caseBank = [
  // ════════════════════════════════════════
  //  INTERNAL MEDICINE
  // ════════════════════════════════════════
  {
    _id: 0,
    hash_id: 'im_stemi_001',
    q_type: 'MCQ',
    confidence: 5.0,
    category: 'Ilmu Penyakit Dalam',
    title: 'Acute ST-Elevation Myocardial Infarction',
    vignette: {
      demographics: { age: 58, sex: 'M' },
      narrative: 'A 58-year-old male presents to the emergency department with sudden onset severe crushing substernal chest pain radiating to his left arm and jaw for the past 45 minutes. He is diaphoretic and nauseated. His medical history includes hypertension, type 2 diabetes mellitus, and a 30-pack-year smoking history. Vital signs: BP 90/60 mmHg, HR 110 bpm, RR 24/min, SpO2 94% on room air. ECG shows ST-segment elevation in leads II, III, and aVF with reciprocal ST depression in leads I and aVL.',
      vitalSigns: { bp: '90/60', hr: 110, rr: 24, spo2: 94, temp: 36.8 },
      labFindings: 'Troponin I: 12.5 ng/mL (elevated), CK-MB: 85 U/L (elevated), BNP: 450 pg/mL'
    },
    prompt: 'What is the most appropriate next step in management?',
    options: [
      { id: 'A', text: 'Administer thrombolytics (Alteplase)', is_correct: false, sct_panel_votes: null },
      { id: 'B', text: 'Emergent percutaneous coronary intervention (PCI)', is_correct: true, sct_panel_votes: null },
      { id: 'C', text: 'Start IV heparin drip and observe', is_correct: false, sct_panel_votes: null },
      { id: 'D', text: 'Obtain CT angiography of the chest', is_correct: false, sct_panel_votes: null },
      { id: 'E', text: 'Administer morphine and nitroglycerin only', is_correct: false, sct_panel_votes: null },
    ],
    rationale: {
      correct: 'This patient presents with an inferior STEMI (ST elevation in II, III, aVF). The standard of care for STEMI is emergent PCI (percutaneous coronary intervention) if available within 120 minutes of first medical contact. PCI has superior outcomes compared to thrombolysis, with lower mortality, re-infarction, and hemorrhagic stroke rates.',
      distractors: {
        A: 'Thrombolytics are indicated only if PCI is not available within 120 minutes. PCI is the gold standard for STEMI management.',
        C: 'Heparin alone without reperfusion therapy is insufficient for STEMI. Immediate revascularization is mandatory.',
        D: 'CT angiography would cause dangerous delay. The ECG already confirms the diagnosis of STEMI.',
        E: 'While morphine and nitroglycerin may provide symptom relief, they do not address the underlying coronary occlusion.',
      },
      pearl: 'For inferior STEMI, always check right-sided leads (V4R) to rule out right ventricular involvement. Avoid nitroglycerin if RV infarction is suspected due to preload dependency.'
    },
    meta: {
      tags: ['cardiology', 'STEMI', 'PCI', 'acute coronary syndrome', 'emergency'],
      provenance: ['Harrison\'s Principles of Internal Medicine, 21st Ed', 'AHA/ACC 2023 STEMI Guidelines'],
      original_difficulty: 0.72,
      examType: 'BOTH',
      difficulty: 2
    }
  },
  {
    _id: 1,
    hash_id: 'im_dka_001',
    q_type: 'MCQ',
    confidence: 5.0,
    category: 'Ilmu Penyakit Dalam',
    title: 'Diabetic Ketoacidosis',
    vignette: {
      demographics: { age: 24, sex: 'F' },
      narrative: 'A 24-year-old female with type 1 diabetes mellitus is brought to the emergency department by her roommate who found her lethargic and confused. The patient has been experiencing polyuria, polydipsia, and abdominal pain for the past 2 days. She ran out of her insulin 3 days ago. On examination, she has dry mucous membranes, Kussmaul breathing, and a fruity odor on her breath. Vital signs: BP 100/65 mmHg, HR 120 bpm, RR 30/min (deep and labored), Temp 37.2°C.',
      vitalSigns: { bp: '100/65', hr: 120, rr: 30, spo2: 98, temp: 37.2 },
      labFindings: 'Blood glucose: 485 mg/dL, pH: 7.12, HCO3: 8 mEq/L, Anion gap: 28, Serum ketones: strongly positive, K+: 5.8 mEq/L, Na+: 130 mEq/L, BUN: 32 mg/dL'
    },
    prompt: 'What is the initial priority in management of this patient?',
    options: [
      { id: 'A', text: 'Start continuous IV insulin infusion immediately', is_correct: false },
      { id: 'B', text: 'Aggressive IV fluid resuscitation with 0.9% normal saline', is_correct: true },
      { id: 'C', text: 'Administer IV sodium bicarbonate', is_correct: false },
      { id: 'D', text: 'Correct hyperkalemia with IV calcium gluconate', is_correct: false },
      { id: 'E', text: 'Administer subcutaneous rapid-acting insulin', is_correct: false },
    ],
    rationale: {
      correct: 'The initial priority in DKA management is aggressive IV fluid resuscitation with isotonic saline (0.9% NaCl). Patients with DKA are typically 5-10L fluid depleted. IV fluids restore tissue perfusion, reduce blood glucose (by dilution and enhancing renal clearance), and improve insulin sensitivity. Insulin should be started AFTER fluid resuscitation is initiated and hypokalemia is ruled out (K+ > 3.3 mEq/L).',
      distractors: {
        A: 'While insulin is essential, it should NOT be the first intervention. Starting insulin without adequate fluid resuscitation can cause cardiovascular collapse. Also, insulin drives K+ intracellularly — if K+ drops below 3.3, fatal hypokalemia can occur.',
        C: 'Bicarbonate is only indicated if pH < 6.9. At pH 7.12, the acidosis will correct with fluid resuscitation and insulin therapy.',
        D: 'The K+ of 5.8 is "pseudo-hyperkalemia" — it appears high due to acidosis and insulin deficiency. Once insulin starts, K+ will drop rapidly. The concern here is actually preventing HYPOkalemia.',
        E: 'Subcutaneous insulin is inappropriate for DKA. Continuous IV infusion allows precise dose titration and rapid adjustment.',
      },
      pearl: 'The DKA management mantra: "Fluids First, Potassium Second, Insulin Third." Always check K+ before starting insulin — if K+ < 3.3, replete K+ BEFORE insulin.'
    },
    meta: {
      tags: ['endocrinology', 'DKA', 'diabetes', 'metabolic acidosis', 'emergency'],
      provenance: ['ADA 2024 DKA Management Guidelines', 'Harrison\'s 21st Ed Ch. 403'],
      original_difficulty: 0.65,
      examType: 'BOTH',
      difficulty: 2
    }
  },
  {
    _id: 2,
    hash_id: 'im_pneumonia_001',
    q_type: 'MCQ',
    confidence: 5.0,
    category: 'Ilmu Penyakit Dalam',
    title: 'Community-Acquired Pneumonia',
    vignette: {
      demographics: { age: 67, sex: 'M' },
      narrative: 'A 67-year-old male presents with a 4-day history of productive cough with rust-colored sputum, fever (39.2°C), and right-sided pleuritic chest pain. He has a history of COPD and is a current smoker. On examination, there are decreased breath sounds and bronchial breathing over the right lower lobe with dullness to percussion. His CURB-65 score is 3 (Confusion present, Urea 42 mg/dL, RR 32/min, BP 85/55 mmHg, Age 67).',
      vitalSigns: { bp: '85/55', hr: 105, rr: 32, spo2: 89, temp: 39.2 },
      labFindings: 'WBC: 18,500/μL with left shift, CRP: 180 mg/L, Procalcitonin: 4.2 ng/mL, Chest X-ray: dense consolidation right lower lobe with air bronchograms'
    },
    prompt: 'Based on the CURB-65 score and presentation, what is the most appropriate disposition and empiric antibiotic regimen?',
    options: [
      { id: 'A', text: 'Outpatient treatment with oral amoxicillin', is_correct: false },
      { id: 'B', text: 'Hospital ward admission with IV levofloxacin alone', is_correct: false },
      { id: 'C', text: 'ICU admission with IV beta-lactam + macrolide combination', is_correct: true },
      { id: 'D', text: 'Hospital ward admission with oral azithromycin', is_correct: false },
      { id: 'E', text: 'ICU admission with IV vancomycin + piperacillin-tazobactam', is_correct: false },
    ],
    rationale: {
      correct: 'CURB-65 score ≥3 indicates a high-severity CAP with >15% 30-day mortality, warranting ICU admission. ATS/IDSA guidelines recommend empiric therapy with IV beta-lactam (ceftriaxone or ampicillin-sulbactam) PLUS a macrolide (azithromycin) OR a respiratory fluoroquinolone as dual therapy for severe CAP requiring ICU admission.',
      distractors: {
        A: 'CURB-65 ≥3 mandates hospital admission. Outpatient therapy is only for CURB-65 0-1.',
        B: 'While levofloxacin monotherapy may be appropriate for ward patients, ICU-level CAP requires combination therapy for broader coverage including atypical organisms.',
        D: 'Oral monotherapy is completely inadequate for a patient with hypotension, hypoxemia, and high CURB-65.',
        E: 'Vancomycin + piperacillin-tazobactam is a hospital-acquired/ventilator-associated pneumonia (HAP/VAP) regimen, not the empiric CAP regimen.',
      },
      pearl: 'CURB-65 Scoring: Confusion, Urea >42mg/dL, RR ≥30, BP systolic <90 or diastolic ≤60, Age ≥65. Score 0-1: outpatient, 2: short admission, ≥3: ICU.'
    },
    meta: {
      tags: ['pulmonology', 'pneumonia', 'CAP', 'CURB-65', 'antibiotics'],
      provenance: ['ATS/IDSA 2023 CAP Guidelines', 'PAPDI Guidelines'],
      original_difficulty: 0.58,
      examType: 'BOTH',
      difficulty: 3
    }
  },

  // ════════════════════════════════════════
  //  SURGERY
  // ════════════════════════════════════════
  {
    _id: 3,
    hash_id: 'sx_appendicitis_001',
    q_type: 'MCQ',
    confidence: 5.0,
    category: 'Bedah',
    title: 'Acute Appendicitis',
    vignette: {
      demographics: { age: 22, sex: 'M' },
      narrative: 'A 22-year-old male presents to the ER with 18 hours of periumbilical pain that has migrated to the right lower quadrant. He reports anorexia, nausea, and one episode of vomiting. On examination, there is rebound tenderness and guarding at McBurney\'s point. Rovsing\'s sign and Psoas sign are positive. He has a low-grade fever of 38.2°C.',
      vitalSigns: { bp: '120/80', hr: 92, rr: 18, spo2: 99, temp: 38.2 },
      labFindings: 'WBC: 14,200/μL with neutrophilic predominance (85%), CRP: 45 mg/L, Urinalysis: normal'
    },
    prompt: 'What is the most appropriate next step?',
    options: [
      { id: 'A', text: 'Obtain CT scan of the abdomen with IV contrast', is_correct: false },
      { id: 'B', text: 'Start IV antibiotics and observe for 24 hours', is_correct: false },
      { id: 'C', text: 'Proceed to laparoscopic appendectomy', is_correct: true },
      { id: 'D', text: 'Perform diagnostic peritoneal lavage', is_correct: false },
      { id: 'E', text: 'Order abdominal ultrasound', is_correct: false },
    ],
    rationale: {
      correct: 'This presentation is classic for acute appendicitis (periumbilical pain migrating to RLQ, McBurney\'s point tenderness, positive Rovsing\'s and Psoas signs, fever, leukocytosis). With an Alvarado score ≥7, the clinical diagnosis is sufficient to proceed directly to laparoscopic appendectomy without imaging. Delay increases perforation risk.',
      distractors: {
        A: 'CT scan is indicated for atypical presentations or Alvarado score 4-6. This classic presentation does not require imaging confirmation.',
        B: 'Conservative management with antibiotics alone has higher recurrence rates. Surgery remains the gold standard for uncomplicated appendicitis.',
        D: 'Diagnostic peritoneal lavage is used for blunt abdominal trauma, not appendicitis.',
        E: 'Ultrasound may be considered in pregnant women or children to avoid radiation, but is not needed here.',
      },
      pearl: 'Alvarado Score (MANTRELS): Migration of pain (1), Anorexia (1), Nausea/Vomiting (1), Tenderness RLQ (2), Rebound (1), Elevated temp (1), Leukocytosis (2), Shift left (1). Score ≥7: operate. Score 4-6: imaging.'
    },
    meta: {
      tags: ['general surgery', 'appendicitis', 'acute abdomen', 'Alvarado score'],
      provenance: ['Schwartz\'s Principles of Surgery, 11th Ed', 'WSES 2020 Jerusalem Guidelines'],
      original_difficulty: 0.80,
      examType: 'BOTH',
      difficulty: 1
    }
  },

  // ════════════════════════════════════════
  //  OB/GYN
  // ════════════════════════════════════════
  {
    _id: 4,
    hash_id: 'obgyn_preeclampsia_001',
    q_type: 'MCQ',
    confidence: 5.0,
    category: 'Obstetri & Ginekologi',
    title: 'Severe Preeclampsia',
    vignette: {
      demographics: { age: 28, sex: 'F' },
      narrative: 'A 28-year-old primigravida at 34 weeks gestation presents with persistent headache, visual disturbances ("seeing spots"), and epigastric pain for the past 6 hours. Her prenatal course was unremarkable until 2 weeks ago when her blood pressure was noted to be 145/95 mmHg. Today, BP is 168/110 mmHg on repeated measurements. She has 3+ proteinuria on dipstick and bilateral lower extremity edema.',
      vitalSigns: { bp: '168/110', hr: 88, rr: 18, spo2: 98, temp: 36.6 },
      labFindings: 'Platelets: 92,000/μL, AST: 185 U/L, ALT: 210 U/L, LDH: 680 U/L, Creatinine: 1.3 mg/dL, Uric acid: 7.8 mg/dL, Protein/Creatinine ratio: 3.2'
    },
    prompt: 'What is the most critical initial step in management?',
    options: [
      { id: 'A', text: 'Immediate cesarean delivery', is_correct: false },
      { id: 'B', text: 'Start IV magnesium sulfate for seizure prophylaxis', is_correct: true },
      { id: 'C', text: 'Administer betamethasone and wait 48 hours', is_correct: false },
      { id: 'D', text: 'Start oral nifedipine for blood pressure control', is_correct: false },
      { id: 'E', text: 'Perform emergency cesarean section within 1 hour', is_correct: false },
    ],
    rationale: {
      correct: 'This patient has severe preeclampsia with features (BP ≥160/110, headache, visual disturbances, epigastric pain, thrombocytopenia, elevated liver enzymes — concerning for HELLP syndrome). The MOST critical first step is IV magnesium sulfate for seizure (eclampsia) prophylaxis. MgSO4 reduces eclampsia risk by 58% (Magpie Trial). Loading dose: 4-6g IV over 15-20 min, then 1-2g/hr maintenance.',
      distractors: {
        A: 'Delivery is ultimately indicated, but stabilization with MgSO4 and antihypertensives must come first to prevent eclamptic seizures during surgery.',
        C: 'While betamethasone is given for fetal lung maturity at 34 weeks, you cannot wait 48 hours with severe features — the patient needs stabilization and likely delivery within 24-48 hours.',
        D: 'Blood pressure control is important but secondary to seizure prevention. IV labetalol or hydralazine (not oral nifedipine as first-line) is preferred for acute severe hypertension.',
        E: 'Emergency cesarean without stabilization risks intraoperative eclamptic seizure.',
      },
      pearl: 'Severe preeclampsia management priorities: 1) MgSO4 (seizure prevention), 2) Antihypertensive (labetalol/hydralazine), 3) Corticosteroids if <34 weeks, 4) Delivery planning. MgSO4 toxicity signs: loss of deep tendon reflexes, respiratory depression — antidote is IV calcium gluconate.'
    },
    meta: {
      tags: ['obstetrics', 'preeclampsia', 'HELLP syndrome', 'magnesium sulfate', 'hypertension'],
      provenance: ['ACOG Practice Bulletin 2020', 'Williams Obstetrics, 26th Ed'],
      original_difficulty: 0.62,
      examType: 'BOTH',
      difficulty: 2
    }
  },

  // ════════════════════════════════════════
  //  PEDIATRICS
  // ════════════════════════════════════════
  {
    _id: 5,
    hash_id: 'ped_kawasaki_001',
    q_type: 'MCQ',
    confidence: 5.0,
    category: 'Ilmu Kesehatan Anak',
    title: 'Kawasaki Disease',
    vignette: {
      demographics: { age: 4, sex: 'M' },
      narrative: 'A 4-year-old boy is brought in with 6 days of high fever (>39°C) that has not responded to amoxicillin prescribed by his pediatrician for presumed pharyngitis. On examination, he has bilateral non-exudative conjunctival injection, erythematous cracked lips with a "strawberry tongue," a polymorphous rash on the trunk, swollen and erythematous hands and feet, and a single enlarged cervical lymph node (2 cm). He is irritable and refuses to walk.',
      vitalSigns: { bp: '90/60', hr: 140, rr: 24, spo2: 99, temp: 39.8 },
      labFindings: 'WBC: 16,800/μL, Platelets: 580,000/μL (elevated), ESR: 82 mm/hr, CRP: 95 mg/L, Albumin: 2.8 g/dL, ALT: 68 U/L, Urinalysis: sterile pyuria'
    },
    prompt: 'What is the most appropriate treatment to prevent the most serious complication?',
    options: [
      { id: 'A', text: 'High-dose oral prednisone for 2 weeks', is_correct: false },
      { id: 'B', text: 'IV immunoglobulin (IVIG) 2 g/kg + high-dose aspirin', is_correct: true },
      { id: 'C', text: 'IV ceftriaxone for bacterial infection', is_correct: false },
      { id: 'D', text: 'Oral ibuprofen and supportive care', is_correct: false },
      { id: 'E', text: 'IV methylprednisolone pulse therapy', is_correct: false },
    ],
    rationale: {
      correct: 'This patient meets ≥5 criteria for Kawasaki Disease (KD): fever ≥5 days, bilateral conjunctivitis, oral mucosal changes, extremity changes, polymorphous rash, and cervical lymphadenopathy. The treatment is IVIG 2 g/kg as a single infusion + high-dose aspirin (80-100 mg/kg/day). IVIG reduces the incidence of coronary artery aneurysms from ~25% to <4% if given within 10 days of fever onset.',
      distractors: {
        A: 'Corticosteroids alone are not first-line for KD. They may be used as adjunct therapy in refractory cases along with IVIG.',
        C: 'KD is a vasculitis, not a bacterial infection. Antibiotics have no role.',
        D: 'Aspirin alone without IVIG does not adequately prevent coronary artery aneurysms.',
        E: 'Pulse steroids may be considered in IVIG-refractory KD but are not first-line therapy.',
      },
      pearl: 'Kawasaki Disease is the #1 cause of acquired heart disease in children in developed countries. The most feared complication is coronary artery aneurysm. Note: Aspirin is used in KD despite being generally avoided in children (Reye syndrome risk) — it is one of the few pediatric exceptions.'
    },
    meta: {
      tags: ['pediatrics', 'Kawasaki disease', 'vasculitis', 'IVIG', 'coronary artery aneurysm'],
      provenance: ['Nelson Textbook of Pediatrics, 22nd Ed', 'AHA 2024 KD Guidelines'],
      original_difficulty: 0.68,
      examType: 'BOTH',
      difficulty: 2
    }
  },

  // ════════════════════════════════════════
  //  NEUROLOGY
  // ════════════════════════════════════════
  {
    _id: 6,
    hash_id: 'neuro_stroke_001',
    q_type: 'MCQ',
    confidence: 5.0,
    category: 'Neurologi',
    title: 'Acute Ischemic Stroke — Thrombolysis Window',
    vignette: {
      demographics: { age: 72, sex: 'F' },
      narrative: 'A 72-year-old female is brought to the ER by ambulance after her husband found her with sudden onset right-sided weakness and inability to speak 2 hours ago. She was last seen normal at 08:00 AM and found symptomatic at 10:00 AM (it is now 10:30 AM). She has a history of atrial fibrillation but stopped her apixaban 2 weeks ago because "it was too expensive." On examination, she has right hemiparesis (MRC grade 2/5), global aphasia, right facial droop, and right-sided neglect. NIHSS score is 18.',
      vitalSigns: { bp: '178/95', hr: 88, rr: 16, spo2: 97, temp: 36.9 },
      labFindings: 'Non-contrast CT head: no hemorrhage, early hyperdensity of left MCA. Blood glucose: 145 mg/dL. INR: 1.0. Platelets: 220,000/μL'
    },
    prompt: 'What is the most appropriate immediate management?',
    options: [
      { id: 'A', text: 'Administer IV alteplase (tPA) 0.9 mg/kg', is_correct: true },
      { id: 'B', text: 'Start IV heparin anticoagulation', is_correct: false },
      { id: 'C', text: 'Obtain MRI brain with diffusion-weighted imaging first', is_correct: false },
      { id: 'D', text: 'Lower blood pressure to <140/90 before thrombolysis', is_correct: false },
      { id: 'E', text: 'Administer aspirin 325 mg and clopidogrel 300 mg', is_correct: false },
    ],
    rationale: {
      correct: 'This patient has an acute ischemic stroke within the 4.5-hour thrombolysis window (onset ~2.5 hours ago). Non-contrast CT shows no hemorrhage. IV alteplase (tPA) 0.9 mg/kg (max 90 mg, 10% bolus, rest over 60 min) is indicated. The patient\'s apixaban was stopped 2 weeks ago and INR is normal, so anticoagulant reversal is not needed. BP must be <185/110 before tPA (currently 178/95 — acceptable).',
      distractors: {
        B: 'IV heparin is NOT indicated in acute ischemic stroke. Anticoagulation increases hemorrhagic conversion risk.',
        C: 'MRI would delay treatment. Non-contrast CT is sufficient to rule out hemorrhage before tPA. "Time is brain" — each minute of delay loses 1.9 million neurons.',
        D: 'BP threshold for tPA is <185/110 (not <140/90). This patient\'s BP of 178/95 is already within the acceptable range.',
        E: 'Dual antiplatelet therapy has no role in acute stroke management. Aspirin alone may be given if tPA is contraindicated, but no sooner than 24 hours after tPA administration.',
      },
      pearl: 'Stroke tPA window: 0-3 hours (standard), 3-4.5 hours (extended criteria — age <80, no diabetes+prior stroke combo, NIHSS <25). Door-to-needle time target: <60 minutes. For large vessel occlusion (NIHSS ≥6), consider mechanical thrombectomy up to 24 hours with favorable perfusion imaging.'
    },
    meta: {
      tags: ['neurology', 'stroke', 'thrombolysis', 'tPA', 'cerebrovascular'],
      provenance: ['AHA/ASA 2024 Stroke Guidelines', 'Adams & Victor\'s Neurology, 12th Ed'],
      original_difficulty: 0.55,
      examType: 'BOTH',
      difficulty: 3
    }
  },

  // ════════════════════════════════════════
  //  PSYCHIATRY
  // ════════════════════════════════════════
  {
    _id: 7,
    hash_id: 'psych_mdd_001',
    q_type: 'MCQ',
    confidence: 4.5,
    category: 'Psikiatri',
    title: 'Major Depressive Disorder with Suicidal Ideation',
    vignette: {
      demographics: { age: 35, sex: 'F' },
      narrative: 'A 35-year-old woman is brought to the clinic by her sister who is concerned about her behavior over the past 3 weeks. The patient reports persistent sadness, loss of interest in activities she previously enjoyed, insomnia with early morning awakening, significant weight loss (5 kg in 3 weeks), difficulty concentrating at work, and feeling "worthless." When asked directly, she admits to having thoughts of ending her life and has been researching methods online, though she denies a specific plan or intent. She has no prior psychiatric history.',
      vitalSigns: { bp: '118/76', hr: 72, rr: 14, spo2: 99, temp: 36.5 },
      labFindings: 'PHQ-9 score: 23 (severe). TSH: 2.4 mIU/L (normal). CBC: normal. BMP: normal.'
    },
    prompt: 'What is the most appropriate initial management?',
    options: [
      { id: 'A', text: 'Start fluoxetine 20 mg daily and schedule weekly follow-up', is_correct: false },
      { id: 'B', text: 'Start fluoxetine and refer for cognitive behavioral therapy', is_correct: false },
      { id: 'C', text: 'Psychiatric hospitalization for safety and initiate treatment', is_correct: true },
      { id: 'D', text: 'Start benzodiazepine for acute anxiety and insomnia', is_correct: false },
      { id: 'E', text: 'Refer to outpatient psychiatrist within 2 weeks', is_correct: false },
    ],
    rationale: {
      correct: 'This patient has severe MDD (PHQ-9: 23) with active suicidal ideation AND has been researching methods (indicating planning behavior, even without explicit "plan"). This represents high suicide risk. The priority is patient safety — psychiatric hospitalization allows 24-hour monitoring, safety assessment, and initiation of pharmacotherapy + psychotherapy in a controlled environment. SSRIs take 2-4 weeks for effect, making outpatient management dangerous in the interim.',
      distractors: {
        A: 'Starting an SSRI without addressing immediate safety is dangerous. Fluoxetine can initially increase anxiety and agitation before therapeutic effect, potentially worsening suicidal risk in the first 2 weeks.',
        B: 'Combination therapy is correct long-term, but outpatient management is inappropriate given active suicidal ideation with research into methods.',
        D: 'Benzodiazepines do not treat depression and may paradoxically disinhibit suicidal behavior. They are also high-risk for overdose.',
        E: 'A 2-week wait is unacceptable with active suicidal ideation. The patient needs immediate intervention.',
      },
      pearl: 'Suicide Risk Assessment: Ask about Ideation, Plan, Intent, Access to means, and Protective factors. "Researching methods" is a red flag equivalent to planning. Columbia Suicide Severity Rating Scale (C-SSRS) is the gold standard screening tool.'
    },
    meta: {
      tags: ['psychiatry', 'depression', 'MDD', 'suicidal ideation', 'safety'],
      provenance: ['Kaplan & Sadock\'s Synopsis, 12th Ed', 'APA Practice Guidelines for MDD'],
      original_difficulty: 0.70,
      examType: 'BOTH',
      difficulty: 2
    }
  },

  // ════════════════════════════════════════
  //  EMERGENCY MEDICINE
  // ════════════════════════════════════════
  {
    _id: 8,
    hash_id: 'em_anaphylaxis_001',
    q_type: 'MCQ',
    confidence: 5.0,
    category: 'Anestesi & Emergency Medicine',
    title: 'Anaphylaxis Management',
    vignette: {
      demographics: { age: 19, sex: 'M' },
      narrative: 'A 19-year-old male develops sudden onset of generalized urticaria, facial and tongue swelling, wheezing, and lightheadedness within 10 minutes of eating shrimp at a restaurant. His friend calls 911. On arrival, paramedics note stridor, diffuse urticaria, and the patient is becoming unresponsive. Vital signs: BP 70/40 mmHg, HR 130 bpm, RR 32/min with accessory muscle use, SpO2 85% on room air.',
      vitalSigns: { bp: '70/40', hr: 130, rr: 32, spo2: 85, temp: 37.0 },
      labFindings: 'Clinical diagnosis — no time for labs'
    },
    prompt: 'What is the first-line treatment that must be given immediately?',
    options: [
      { id: 'A', text: 'IV diphenhydramine 50 mg', is_correct: false },
      { id: 'B', text: 'IM epinephrine 0.3-0.5 mg (1:1000) in the anterolateral thigh', is_correct: true },
      { id: 'C', text: 'IV methylprednisolone 125 mg', is_correct: false },
      { id: 'D', text: 'Nebulized albuterol 2.5 mg', is_correct: false },
      { id: 'E', text: 'IV normal saline 2L bolus', is_correct: false },
    ],
    rationale: {
      correct: 'IM epinephrine is the ONLY first-line treatment for anaphylaxis. It is the only drug that addresses ALL pathophysiological mechanisms: bronchospasm (β2-agonism), vasodilation/hypotension (α1-agonism), and mast cell degranulation (β2-mediated stabilization). Administer 0.3-0.5 mg (0.01 mg/kg in children) of 1:1000 (1 mg/mL) concentration IM in the anterolateral thigh. Can repeat every 5-15 minutes.',
      distractors: {
        A: 'Antihistamines (H1 blockers like diphenhydramine) are adjunctive — they treat urticaria/itch but do NOT reverse bronchospasm, laryngeal edema, or cardiovascular collapse.',
        C: 'Corticosteroids have a delayed onset (4-6 hours) and are used to prevent biphasic reactions. They have NO role as first-line acute treatment.',
        D: 'Nebulized albuterol may help bronchospasm but does not address cardiovascular collapse or angioedema.',
        E: 'IV fluids are important for volume resuscitation but are secondary to epinephrine.',
      },
      pearl: 'Anaphylaxis Treatment: "Epi First, Epi Fast, Epi on the Thigh, Epi That Lasts." Never use IV (1:10,000) unless cardiac arrest — risk of fatal arrhythmia. IM (1:1,000) in thigh gives fastest absorption. Delay in epinephrine administration is the #1 cause of fatal anaphylaxis.'
    },
    meta: {
      tags: ['emergency', 'anaphylaxis', 'epinephrine', 'allergy', 'shock'],
      provenance: ['WAO Anaphylaxis Guidelines 2024', 'Tintinalli\'s Emergency Medicine, 9th Ed'],
      original_difficulty: 0.88,
      examType: 'BOTH',
      difficulty: 1
    }
  },

  // ════════════════════════════════════════
  //  PUBLIC HEALTH / IKM
  // ════════════════════════════════════════
  {
    _id: 9,
    hash_id: 'ph_dhf_001',
    q_type: 'MCQ',
    confidence: 4.5,
    category: 'Ilmu Kesehatan Masyarakat',
    title: 'Dengue Hemorrhagic Fever — Outbreak Investigation',
    vignette: {
      demographics: { age: null, sex: null },
      narrative: 'You are a newly assigned Puskesmas (Community Health Center) doctor in a subdistrict in Central Java. Over the past 2 weeks, 15 patients have been hospitalized for dengue hemorrhagic fever (DHF), compared to an average of 2 cases per month over the past year. The district health office reports a case fatality rate of 1.2% for the current period. Your Puskesmas covers a population of 30,000 residents. The area has high population density, open water storage containers (bak mandi), and poor waste management.',
      vitalSigns: null,
      labFindings: 'NS1 antigen positive in 12/15 cases. IgM anti-dengue positive in all 15. Dominant serotype: DENV-2.'
    },
    prompt: 'According to Indonesian public health protocols (Kemenkes RI), what is the most important initial step as the Puskesmas doctor?',
    options: [
      { id: 'A', text: 'Conduct fogging (thermal fogging insecticide) immediately in the affected area', is_correct: false },
      { id: 'B', text: 'Perform Penyelidikan Epidemiologi (PE) — epidemiological investigation within 24 hours', is_correct: true },
      { id: 'C', text: 'Report to the national KLB (Kejadian Luar Biasa) task force', is_correct: false },
      { id: 'D', text: 'Distribute abate (temephos) to all households', is_correct: false },
      { id: 'E', text: 'Conduct mass blood screening of the population', is_correct: false },
    ],
    rationale: {
      correct: 'Per Kemenkes RI Kepmenkes 581/2017, when a dengue case is reported, the Puskesmas must conduct Penyelidikan Epidemiologi (PE) within 1x24 hours. PE involves: (1) confirming the diagnosis, (2) identifying additional cases through active case finding within 100-meter radius, (3) inspecting larvae (Angka Bebas Jentik/ABJ survey), (4) determining if an outbreak (KLB) criteria are met. PE results determine whether fogging, PSN (Pemberantasan Sarang Nyamuk), or KLB declaration is warranted.',
      distractors: {
        A: 'Fogging is NOT the first step. Fogging without PE data is ineffective — it kills adult mosquitoes temporarily but does not address larval breeding sites. Fogging is only indicated after PE confirms active transmission foci.',
        C: 'KLB declaration requires PE data first (attack rate, CFR, geographic spread). You cannot skip PE.',
        D: 'Abate distribution is part of PSN (vector control) strategy but must be guided by PE results — specifically the ABJ (larval index) survey.',
        E: 'Mass screening is neither practical nor indicated in dengue outbreak management.',
      },
      pearl: 'Indonesian DHF Outbreak Protocol: PE (24h) → PSN-3M Plus → Fogging (if PE shows ABJ <95%) → KLB declaration (if criteria met). The 3M: Menguras (drain), Menutup (cover), Mendaur ulang (recycle). ABJ target: ≥95% (houses free of Aedes larvae).'
    },
    meta: {
      tags: ['public health', 'dengue', 'DHF', 'outbreak', 'epidemiology', 'UKMPPD', 'IKM'],
      provenance: ['Kemenkes RI Kepmenkes 581/2017', 'SKDI 2019', 'Buku Panduan Tatalaksana DBD Kemenkes 2017'],
      original_difficulty: 0.55,
      examType: 'UKMPPD',
      difficulty: 3
    }
  },

  // ════════════════════════════════════════
  //  SCT FORMAT — UKMPPD STYLE
  // ════════════════════════════════════════
  {
    _id: 10,
    hash_id: 'sct_tb_001',
    q_type: 'SCT',
    confidence: 4.0,
    category: 'Ilmu Penyakit Dalam',
    title: 'Pulmonary Tuberculosis — SCT Clinical Reasoning',
    vignette: {
      demographics: { age: 32, sex: 'M' },
      narrative: 'A 32-year-old male presents with productive cough for 3 weeks, night sweats, and unintentional weight loss of 8 kg over 2 months. He works as a construction worker and lives in a crowded dormitory.',
      vitalSigns: { bp: '110/70', hr: 78, rr: 18, spo2: 97, temp: 37.8 },
      labFindings: null
    },
    prompt: 'If you were thinking that this patient has pulmonary tuberculosis, and then you find that his sputum AFB (Acid-Fast Bacilli) smear is NEGATIVE on 3 consecutive morning specimens...',
    options: [
      { id: '-2', text: 'Almost eliminates this hypothesis', is_correct: false, sct_panel_votes: 0 },
      { id: '-1', text: 'Makes this hypothesis less likely', is_correct: false, sct_panel_votes: 3 },
      { id: '0', text: 'Neither supports nor weakens', is_correct: false, sct_panel_votes: 2 },
      { id: '+1', text: 'Makes this hypothesis slightly less likely but does not rule it out', is_correct: true, sct_panel_votes: 8 },
      { id: '+2', text: 'Strongly supports this hypothesis', is_correct: false, sct_panel_votes: 2 },
    ],
    rationale: {
      correct: 'A negative AFB smear does NOT rule out pulmonary TB. Smear-negative TB accounts for ~50% of culture-confirmed TB cases. AFB smear sensitivity is only 50-80% (requires >5,000-10,000 bacilli/mL for detection). Given the strong clinical picture (chronic cough, night sweats, weight loss, crowded living) and high pre-test probability, the hypothesis of TB remains. Most experts would say this finding makes the diagnosis slightly less likely but does not eliminate it — hence "+1" on the Likert scale as the modal expert response.',
      distractors: {
        '-2': 'No expert would choose this. Negative AFB does not "almost eliminate" TB — GeneXpert, culture, or clinical-radiological correlation must follow.',
        '-1': 'Some experts may select this, acknowledging the decreased likelihood, but it underestimates the prevalence of smear-negative TB.',
        '0': 'A negative test result cannot be "neutral" — it must shift the probability in some direction.',
        '+2': 'A negative result cannot "strongly support" the TB hypothesis.',
      },
      pearl: 'In TB-endemic countries (like Indonesia), clinical diagnosis matters. WHO recommends GeneXpert MTB/RIF as the initial diagnostic test. Kemenkes RI protocol: if 3 AFB smears are negative but clinical suspicion is high → perform GeneXpert or chest X-ray. Do not withhold treatment based on smear alone in high-risk patients.'
    },
    meta: {
      tags: ['internal medicine', 'tuberculosis', 'AFB', 'clinical reasoning', 'SCT', 'UKMPPD'],
      provenance: ['PPK Kemenkes RI', 'WHO 2024 TB Guidelines', 'PDPI Guidelines'],
      original_difficulty: 0.45,
      examType: 'UKMPPD',
      difficulty: 3
    }
  },

  // ════════════════════════════════════════
  //  MORE UKMPPD-SPECIFIC CASES
  // ════════════════════════════════════════
  {
    _id: 11,
    hash_id: 'im_dhf_001',
    q_type: 'MCQ',
    confidence: 4.5,
    category: 'Ilmu Penyakit Dalam',
    title: 'Dengue Hemorrhagic Fever — Fluid Management',
    vignette: {
      demographics: { age: 25, sex: 'F' },
      narrative: 'A 25-year-old female presents on day 4 of illness with high fever, myalgia, retro-orbital headache, and red spots appearing on her arms. She had a positive tourniquet test. Today her fever starts to subside (defervescence phase). She becomes restless, with cold clammy extremities, and reports abdominal pain. On examination: hepatomegaly 2 cm below costal margin, ascites detected by shifting dullness.',
      vitalSigns: { bp: '90/70', hr: 120, rr: 24, spo2: 96, temp: 36.5 },
      labFindings: 'Hematocrit: 48% (baseline 35%), Platelets: 42,000/μL, WBC: 3,200/μL, Albumin: 2.5 g/dL'
    },
    prompt: 'What grade of DHF is this patient, and what is the appropriate initial fluid management?',
    options: [
      { id: 'A', text: 'DHF Grade I — oral rehydration therapy', is_correct: false },
      { id: 'B', text: 'DHF Grade II — IV crystalloid maintenance rate', is_correct: false },
      { id: 'C', text: 'DHF Grade III (DSS) — IV crystalloid resuscitation 20 mL/kg bolus', is_correct: true },
      { id: 'D', text: 'DHF Grade IV — immediate blood transfusion', is_correct: false },
      { id: 'E', text: 'DHF Grade II — IV colloid albumin replacement', is_correct: false },
    ],
    rationale: {
      correct: 'This patient is in Dengue Shock Syndrome (DSS) = DHF Grade III. Evidence: narrow pulse pressure (90/70 = PP 20 mmHg), tachycardia, cold extremities, restlessness, plus hemoconcentration (Hct rise >20% from baseline: 48 vs 35 = 37% rise) and plasma leakage signs (ascites, hepatomegaly, hypoalbuminemia). Per WHO/Kemenkes protocol, Grade III DSS requires immediate IV crystalloid (RL/NS) bolus at 20 mL/kg over 15-30 minutes, then reassess. If no improvement, switch to colloid.',
      distractors: {
        A: 'Grade I is fever + positive tourniquet test only, without evidence of plasma leakage or shock.',
        B: 'Grade II has spontaneous bleeding (petechiae, GI bleeding) but stable hemodynamics. This patient is in shock.',
        D: 'Grade IV is profound shock (undetectable BP/pulse). Blood transfusion is for severe hemorrhage, not initial DSS management.',
        E: 'Colloid is second-line after crystalloid fails to improve hemodynamics.',
      },
      pearl: 'DHF Grading (WHO): I=Fever+Tourniquet test, II=+Spontaneous bleeding, III=Circulatory failure (narrow PP, cold extremities), IV=Profound shock. Critical phase is during DEFERVESCENCE (day 3-7). The "Hematocrit Trap": rising Hct = ongoing plasma leak. Falling Hct without bleeding = recovery.'
    },
    meta: {
      tags: ['internal medicine', 'dengue', 'DHF', 'DSS', 'fluid management', 'UKMPPD'],
      provenance: ['Kemenkes RI Tatalaksana DBD 2017', 'WHO Dengue Guidelines 2024'],
      original_difficulty: 0.52,
      examType: 'UKMPPD',
      difficulty: 3
    }
  },
];

// Helper functions
export const getCasesByCategory = (category) => caseBank.filter(c => c.category === category);
export const getCasesByExamType = (examType) => caseBank.filter(c => c.meta.examType === examType || c.meta.examType === 'BOTH');
export const getCasesByDifficulty = (difficulty) => caseBank.filter(c => c.meta.difficulty === difficulty);
export const getCaseById = (id) => caseBank.find(c => c._id === id);
export const getSCTCases = () => caseBank.filter(c => c.q_type === 'SCT');
export const getMCQCases = () => caseBank.filter(c => c.q_type === 'MCQ');
export const getRandomCase = () => caseBank[Math.floor(Math.random() * caseBank.length)];

export const getCaseStats = () => {
  const stats = {};
  Object.keys(CATEGORIES).forEach(cat => {
    stats[cat] = {
      total: caseBank.filter(c => c.category === cat).length,
      completed: 0, // Will be populated from store
    };
  });
  return stats;
};
