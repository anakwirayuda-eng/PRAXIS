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
    'dermatology', 'venereology', 'dermatitis', 'psoriasis', 'urticaria',
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
    'anatomy', 'artery', 'vein', 'ligament',
    'sacrum', 'foramen',
  ],
  'Kedokteran Gigi': [
    'dental', 'dentistry', 'tooth', 'teeth', 'gingiva', 'gingival', 'periodont',
    'orthodont', 'endodont', 'prosthodont', 'cej', 'tmj', 'plaque', 'enamel',
    'dentin', 'pulp', 'malocclusion', 'steiner', 'maxilla', 'maxillary',
    'mandible', 'mandibular', 'molar', 'incisor', 'canine', 'premolar',
    'occlusal', 'root canal', 'rubber dam', 'caries',
    'alveolar ridge', 'alveolar socket', 'alveolar bone', 'alveolar process',
    'pulpitis',
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

const PUBMEDQA_PROMOTION_MATCHES = {
  Farmakologi: new Set(['pharmacology'].map((term) => normalizeText(term))),
  Bedah: new Set(['surgical', 'postoperative'].map((term) => normalizeText(term))),
  'Ilmu Kesehatan Masyarakat': new Set(['public health'].map((term) => normalizeText(term))),
  Neurologi: new Set(['neurological'].map((term) => normalizeText(term))),
  Anatomi: new Set(['ligament', 'vein'].map((term) => normalizeText(term))),
  'Anestesi & Emergency Medicine': new Set(['anesthesia', 'emergency'].map((term) => normalizeText(term))),
};

const TW_MEDQA_PROMOTION_MATCHES = {
  Biokimia: new Set(['dna', 'rna', 'metabolism'].map((term) => normalizeText(term))),
  Radiologi: new Set(['ct scan', 'mri', 'x ray'].map((term) => normalizeText(term))),
  'Obstetri & Ginekologi': new Set(['gynecology', 'labor'].map((term) => normalizeText(term))),
  Neurologi: new Set(['neurological'].map((term) => normalizeText(term))),
  'Ilmu Kesehatan Anak': new Set(['pediatric'].map((term) => normalizeText(term))),
  'Ilmu Kesehatan Masyarakat': new Set(['public health', 'surveillance'].map((term) => normalizeText(term))),
  'Kulit & Kelamin': new Set(['dermatology'].map((term) => normalizeText(term))),
  Farmakologi: new Set(['receptor'].map((term) => normalizeText(term))),
  'Ilmu Penyakit Dalam': new Set(['endocrine'].map((term) => normalizeText(term))),
};

const HEADQA_BIOCHEM_PROMOTION_MATCHES = new Set(
  ['dna', 'rna', 'amino acid', 'enzyme', 'metabolism', 'glycolysis']
    .map((term) => normalizeText(term)),
);

const SAFE_PROMOTION_SIGNAL_SOURCES = new Set([
  'keyword',
  'narrative',
  'organ_system',
  'topic_keywords',
  'topic',
]);

const TEXT_ONLY_PROMOTION_SIGNAL_SOURCES = new Set([
  'keyword',
  'narrative',
]);

const CONTENT_CONSENSUS_SOURCES = new Set([
  'subject',
  'tags',
  'keyword',
  'narrative',
  'options',
  'organ_system',
  'topic_keywords',
  'topic',
]);

const TEXTUAL_CONSENSUS_SOURCES = new Set([
  'keyword',
  'narrative',
  'options',
]);

const PREFIX_KEYWORD_MATCHES = new Set([
  'periodont',
  'orthodont',
  'endodont',
  'prosthodont',
].map((term) => normalizeText(term)));

const HEADQA_TARGETED_PROMOTION_MATCHES = {
  Farmakologi: new Set(['pharmacology', 'receptor', 'agonist', 'antagonist'].map((term) => normalizeText(term))),
  'Obstetri & Ginekologi': new Set(['gynecology', 'obstetric', 'labor', 'amenorrhea'].map((term) => normalizeText(term))),
  'Ilmu Kesehatan Masyarakat': new Set(['public health', 'health promotion', 'community participation', 'prevention'].map((term) => normalizeText(term))),
  Neurologi: new Set(['neurological', 'seizure'].map((term) => normalizeText(term))),
  Bedah: new Set(['musculoskeletal', 'surgery', 'surgical', 'trauma', 'postoperative'].map((term) => normalizeText(term))),
  'Ilmu Kesehatan Anak': new Set(['pediatric', 'child'].map((term) => normalizeText(term))),
  Psikiatri: new Set(['psychiatry', 'psychology', 'depression', 'anxiety'].map((term) => normalizeText(term))),
  'Anestesi & Emergency Medicine': new Set(['anesthesia', 'emergency', 'shock', 'resuscitation'].map((term) => normalizeText(term))),
  Biokimia: new Set(['dna', 'rna', 'enzyme', 'amino acid', 'glycolysis', 'metabolism'].map((term) => normalizeText(term))),
};

const MEDQA_PEDIATRICS_PROMOTION_MATCHES = new Set(
  ['newborn', 'infant', 'neonate', 'pediatric', 'paediatric']
    .map((term) => normalizeText(term)),
);

const MEDQA_SURGERY_PROMOTION_MATCHES = new Set(
  ['surgery', 'surgical', 'postoperative', 'appendectomy', 'fracture', 'trauma', 'hernia', 'laparotomy']
    .map((term) => normalizeText(term)),
);

const MEDQA_TARGETED_PROMOTION_MATCHES = {
  Farmakologi: new Set(['pharmacology', 'receptor', 'agonist', 'antagonist'].map((term) => normalizeText(term))),
  'Obstetri & Ginekologi': new Set(['gynecology', 'obstetric', 'labor'].map((term) => normalizeText(term))),
  'Ilmu Kesehatan Masyarakat': new Set(['public health'].map((term) => normalizeText(term))),
  Neurologi: new Set(['neurological'].map((term) => normalizeText(term))),
  Bedah: new Set(['musculoskeletal', 'surgery', 'surgical', 'trauma', 'hernia', 'urology', 'postoperative'].map((term) => normalizeText(term))),
  'Ilmu Kesehatan Anak': new Set(['pediatric', 'child', 'infant', 'newborn', 'immunization'].map((term) => normalizeText(term))),
  Biokimia: new Set(['dna', 'rna', 'enzyme', 'amino acid', 'glycolysis'].map((term) => normalizeText(term))),
  'Anestesi & Emergency Medicine': new Set(['emergency', 'shock', 'resuscitation', 'anesthesia'].map((term) => normalizeText(term))),
};

const MEDMCQA_TARGETED_PROMOTION_MATCHES = {
  Farmakologi: new Set(['pharmacology', 'receptor', 'agonist', 'antagonist', 'kinetics', 'half life', 'metabolism'].map((term) => normalizeText(term))),
  'Ilmu Kesehatan Anak': new Set(['pediatric', 'child', 'infant', 'newborn', 'neonate'].map((term) => normalizeText(term))),
  'Anestesi & Emergency Medicine': new Set(['emergency', 'shock', 'resuscitation', 'airway', 'anesthesia', 'critical care'].map((term) => normalizeText(term))),
  Biokimia: new Set(['dna', 'rna', 'amino acid', 'enzyme', 'glycolysis', 'metabolism'].map((term) => normalizeText(term))),
  Bedah: new Set(['surgery', 'surgical', 'musculoskeletal', 'trauma', 'urology', 'orthopedic', 'fracture', 'hernia', 'postoperative'].map((term) => normalizeText(term))),
  'Ilmu Kesehatan Masyarakat': new Set(['public health', 'epidemiology', 'biostatistics', 'screening', 'prevention', 'vaccination', 'surveillance'].map((term) => normalizeText(term))),
  Forensik: new Set(['forensic', 'medico legal', 'abrasion', 'contusion', 'bruise', 'black eye'].map((term) => normalizeText(term))),
  'Obstetri & Ginekologi': new Set(['gynecology', 'obstetric', 'labor', 'pregnancy', 'amenorrhea'].map((term) => normalizeText(term))),
  'Kulit & Kelamin': new Set(['dermatology', 'venereology', 'std', 'sti', 'herpes', 'candida', 'scabies'].map((term) => normalizeText(term))),
  Mata: new Set(['cornea', 'corneal', 'descemet', 'kayser fleischer', 'retina', 'glaucoma', 'cataract'].map((term) => normalizeText(term))),
};

const MEDMCQA_BEDAH_CONFIRM_MATCHES = new Set(
  ['surgery', 'surgical', 'orthopedic', 'orthopaedics', 'fracture', 'trauma', 'musculoskeletal', 'urology', 'hernia', 'postoperative']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_PEDIATRICS_STRONG_PROMOTION_MATCHES = new Set(
  ['breast milk', 'colostrum', 'newborn', 'neonate', 'neonatal', 'infant']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_PEDIATRICS_MEDICINE_PROMOTION_MATCHES = new Set(
  ['child', 'pediatric']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_SURGERY_STRONG_PROMOTION_MATCHES = new Set(
  ['fracture', 'trauma', 'musculoskeletal', 'orthopedic', 'orthopaedics', 'surgery', 'surgical', 'urology', 'hernia', 'postoperative']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_PHARMACOLOGY_STRONG_PROMOTION_MATCHES = new Set(
  ['drug', 'agonist', 'antagonist']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_NEUROLOGY_STRONG_PROMOTION_MATCHES = new Set(
  ['stroke', 'seizure', 'epilepsy', 'migraine', 'cranial nerve']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_PSYCHIATRY_STRONG_PROMOTION_MATCHES = new Set(
  ['psychosis', 'depression', 'schizophrenia', 'bipolar']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_ENT_STRONG_PROMOTION_MATCHES = new Set(
  ['nasal', 'rhinitis', 'otitis', 'hearing', 'tympanic']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_OPHTHALMOLOGY_STRONG_PROMOTION_MATCHES = new Set(
  ['eye', 'vision', 'glaucoma', 'cornea', 'retina', 'cataract', 'pupil', 'pupillary']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_RADIOLOGY_STRONG_PROMOTION_MATCHES = new Set(
  ['x ray', 'ct scan', 'mri', 'ultrasound', 'imaging']
    .map((term) => normalizeText(term)),
);

const PHARMACOLOGY_DRUG_FALSE_POSITIVE_PATTERNS = new Set(
  ['drug resistant', 'drug resistance', 'multi drug resistant', 'multi drug resistance']
    .map((term) => normalizeText(term)),
);

const THT_SINUS_FALSE_POSITIVE_PATTERNS = new Set(
  ['cavernous sinus', 'carotid sinus', 'coronary sinus', 'endodermal sinus']
    .map((term) => normalizeText(term)),
);

const THT_EAR_FALSE_POSITIVE_PATTERNS = new Set(
  ['year old', 'y ear old']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_ENT_TEXTUAL_SUPPORT_MATCHES = new Set(
  ['nasal', 'rhinitis', 'sinusitis', 'otitis', 'hearing', 'throat', 'tonsil', 'larynx', 'tinnitus']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_MICROBIOLOGY_PHARMACOLOGY_SUPPRESSION_PATTERNS = new Set(
  ['infective dose', 'vaccine']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_OBGYN_STRONG_PROMOTION_MATCHES = new Set(
  ['placenta', 'ectopic pregnancy', 'labor', 'obstetric', 'gynecology', 'pregnancy', 'amenorrhea']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_INTERNAL_MEDICINE_STREP_HOST_PROMOTION_MATCHES = new Set(
  ['streptococcus pyogenes', 'host receptor', 'cd46', 'cd44']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_INTERNAL_MEDICINE_HEMATOLOGY_RESCUE_MATCHES = new Set(
  ['peripheral smear', 'x ray spine', 'x-ray spine', 'hand foot syndrome', 'hand-foot syndrome']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_MICROBIOLOGY_STRONG_PROMOTION_MATCHES = new Set(
  [
    'virus',
    'viruses',
    'viral',
    'vaccine',
    'vaccines',
    'bacteria',
    'bacterial',
    'bacterium',
    'mycobacterium',
    'parasite',
    'parasites',
    'parasitology',
    'protozoa',
    'protozoal',
    'helminth',
    'helminths',
    'fungi',
    'fungal',
    'mycology',
    'borrelia',
    'spirochete',
    'spirochaete',
    'hepatitis',
    'corona',
    'coronavirus',
    'relapsing fever',
    'intermediate host',
    'post splenectomy infection',
    'splenectomy infection',
    'paul bunnel',
    'paul-bunnell',
    'pharyngoconjunctival fever',
    'bartonella',
    'quintana',
    'hiv',
    'sandfly',
    'leptospirosis',
    'reservoir',
    'transmitted',
    'cultivation',
    'cell line',
    'pneumonia',
    'typhoid',
    'widal',
    'r factor',
    'dna virus',
    'rna virus',
    'infectious mononucleosis',
    'malaria',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_MICROBIOLOGY_EXACT_PROMOTION_MATCHES = new Set(
  [
    'brucella',
    'mycoplasma',
    'shigella',
    'buruli ulcer',
    'rat bite fever',
    'kolmer test',
    "traveller's diarrhea",
    "traveler's diarrhea",
    'liquid medium for tuberculosis',
    'mgit',
    'dark ground microscopy',
    'ebv',
    'epstein barr',
    'direct transfer of free dna',
    'rna virus',
    'rna viruses',
    'prion',
    'prions',
    'toxic shock syndrome',
    'cryptococcal meningitis',
    'anti dna as',
    'dental caries',
    'penetrate intact cornea',
    'dna covering material in a virus',
    't cells',
    'b cell',
    'lysozyme',
    'm protein',
    'bacitracin sensitivity',
    'paranasal sinus mycoses',
    'negri bodies',
    'coagulase',
    'phase contrast microscopy',
    'phase contrast microscopy is based on the principle of',
    'varicella zoster virus',
    'negri inclusion bodies',
    'sporothrix schenckii',
    'transformation',
    'transduction',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_MICROBIOLOGY_FALSE_POSITIVE_MATCHES = new Set(
  [
    'absorption',
    'vitamin b12',
    'iodinated compound',
    'thyroid',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_ANATOMY_STRONG_PROMOTION_MATCHES = new Set(
  [
    'artery',
    'vein',
    'nerve',
    'foramen',
    'tributary',
    'branch',
    'branches',
    'jugular',
    'carotid',
    'saphenous',
    'sciatic',
    'vertebral',
    'snuffbox',
    'venesection',
    'pterygopalatine',
    'brachial',
    'umbilical vein',
    'portal vein',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_ANATOMY_EXACT_PROMOTION_MATCHES = new Set(
  [
    'hassall',
    'double arch aorta',
    'derivative of midgut',
    'transitional epithelium',
    'ducts of bellini',
    'general visceral fibres',
    'parasympathetic supply to lacrimal',
    'trigone of urinary bladder',
    'coronary sinus',
    'pterygopalatine fossa',
    'foramen rotundum',
    'surgical neck humerus',
    'mandibular arch',
    'tympanic membrane',
    'gubernaculum',
    'external carotid artery',
    'maxillary branch',
    'anterior tympanic',
    'posterior tympanic',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_ORTHOPAEDICS_BEDAH_RESCUE_MATCHES = new Set(
  [
    'ahroscopy of knee',
    'arthroscopy of knee',
    'pivot shift test',
    'meniscal injury',
    'game keepers thumb',
    'gamekeepers thumb',
    'acl rupture',
    'ankle joint',
    'rotater interval',
    'rotator interval',
    'repair the meniscus',
    'posterior gliding of tibia',
    'anterior cruciate ligament',
  ].map((term) => normalizeText(term)),
);

const PUBLIC_HEALTH_STRONG_CONTEXT_MATCHES = new Set(
  ['epidemiology', 'prevalence', 'public health', 'biostatistics', 'surveillance', 'health promotion', 'outbreak', 'prevention']
    .map((term) => normalizeText(term)),
);

const DENTAL_PLAQUE_FALSE_POSITIVE_PATTERNS = new Set(
  ['atherosclerotic plaque', 'fibroblast plaque']
    .map((term) => normalizeText(term)),
);

const MEDMCQA_DERMATOLOGY_STRONG_PROMOTION_MATCHES = new Set(
  [
    'papule',
    'papules',
    'macule',
    'macules',
    'patch',
    'patches',
    'plaque',
    'plaques',
    'vesicle',
    'vesicles',
    'bullous',
    'bulla',
    'bullae',
    'pustule',
    'pustules',
    'gottron',
    'mycosis fungoides',
    'kaposi',
    'alopecia',
    'tzanck',
    'woods lamp',
    'pruritus',
    'hypopigmented',
    'acrodermatitis',
    'chancroid',
    'impetigo',
    'piedra',
    'ash leaf',
    'urticaria',
    'urticarial',
    'scabies',
    'fordyce',
    'lichenisation',
    'skin lesion',
    'primary skin lesion',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_TEXTUAL_SUPPORT_MATCHES = new Set(
  [
    'biopsy',
    'histopathology',
    'histopathological',
    'histology',
    'histological',
    'histologically',
    'gross evaluation',
    'gross specimen',
    'frozen section',
    'electron microscopy',
    'microscopically',
    'colonic polyps',
    'intestinal polyps',
    'hamartomatous',
    'peutz jeghers',
    'stk11',
    'lkb1',
    'hypophosphatasia',
    'phosphoethanolamine',
    'morphologic changes',
    'necrosis',
    'necrotic',
    'onion skin',
    'azzopardi effect',
    'desmoplastic',
    'desmoglein',
    'acantholysis',
    'calcification',
    'dna nick end labeling',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_EXACT_PROMOTION_MATCHES = new Set(
  [
    'oval cells',
    'loss of heterozygosity',
    'loss of hetrozygosity',
    'cervical neoplasia',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_MORPHOLOGY_PROMOTION_MATCHES = new Set(
  [
    'cell',
    'cells',
    'anemia',
    'carcinoma',
    'lymphoma',
    'leukemia',
    'leukaemia',
    'necrosis',
    'granuloma',
    'bodies',
    'fragility',
    'histiocytosis',
    'burkitt',
    'reed sternberg',
    'sternberg',
    'howell jolly',
    'dutcher',
    'bite cells',
    'heart failure cells',
    'cholangiocarcinoma',
    'fibrolamellar',
    'megaloblastic',
    'emphysema',
    'sarcoma',
    'adenoma',
    'xanthogranulomatous',
    'xanthogranulomato',
    'coagulative',
    'sickle cell',
    'cd marker',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_DENTAL_FALSE_POSITIVE_MATCHES = new Set(
  [
    'dental',
    'dentistry',
    'tooth',
    'teeth',
    'gingiva',
    'gingival',
    'enamel',
    'dentin',
    'caries',
    'saliva',
    'eruption',
    'oral cavity',
    'mandible',
    'maxilla',
    'maxillary',
    'odontogenic',
    'dental lamina',
    'tooth surface',
    'tooth germs',
    'incisor',
    'tmj',
    'pterygoid',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_DENTAL_EXACT_PROMOTION_MATCHES = new Set(
  [
    'dental lamina',
    'caries',
    'gingiva',
    'gingival',
    'tooth surface',
    'tooth surfaces',
    'tooth germs',
    'odontogenic',
    'tmj',
    'masticatory apparatus',
    'dental decay',
    'teeth that erupt',
    'eruption of teeth',
    'tooth shape',
    'pulpitis',
    'gemination',
    'mandibular first molar',
    'incisor',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_DENTAL_MODALITY_RESCUE_MATCHES = new Set(
  [
    'rvg',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_BIOCHEM_FALSE_POSITIVE_MATCHES = new Set(
  [
    'enzyme',
    'enzyme deficient',
    'deficiency of enzyme',
    'amino acid',
    'genomic imprinting',
    'karyotype',
    'karyotyping',
    'inheritance',
    'half life',
    'hormone',
    'glycoprotein',
    'protein',
    'hexosaminidase',
    'metabolism',
    'iron metabolism',
    'cyclo oxygenase',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_SURGERY_FALSE_POSITIVE_MATCHES = new Set(
  [
    'surgery',
    'surgical',
    'postoperative',
    'post operative',
    'laparotomy',
    'sterilization',
    'neurosurgery',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_OBGYN_FALSE_POSITIVE_MATCHES = new Set(
  [
    'amenorrhea',
    'ovary',
    'ovarian',
    'cervix',
    'cervical',
    'pap smear',
    'quadruple test',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_PUBLIC_HEALTH_FALSE_POSITIVE_MATCHES = new Set(
  [
    'screening',
    'prevention',
    'sexually active women',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_AEM_FALSE_POSITIVE_MATCHES = new Set(
  [
    'emergency',
    'shock',
    'hypovolemic',
    'vital signs',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_DERM_FALSE_POSITIVE_MATCHES = new Set(
  [
    'std',
    'sti',
    'scabies',
    'candida',
    'herpes',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_OPHTHALMOLOGY_FALSE_POSITIVE_MATCHES = new Set(
  [
    'cornea',
    'corneal',
    'descemet',
    'bowman',
    'kayser fleischer',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_PATHOLOGY_INTERNAL_MEDICINE_FALSE_POSITIVE_MATCHES = new Set(
  [
    'paul bunnell',
    'infectious mononucleosis',
    'psgn',
    'glomerulonephritis',
    'complement',
  ].map((term) => normalizeText(term)),
);

const MEDMCQA_SUBJECT_TAG_TRUSTED_PROMOTIONS = {
  Forensik: {
    subject: normalizeText('Forensic Medicine'),
    tag: normalizeText('forensic'),
    maxRunnerUp: 9,
    rule: 'medmcqa_forensic_subject_tag_consensus9',
  },
  Farmakologi: {
    subject: normalizeText('Pharmacology'),
    tag: normalizeText('pharmacology'),
    maxRunnerUp: 9,
    rule: 'medmcqa_pharmacology_subject_tag_consensus9',
  },
  Biokimia: {
    subject: normalizeText('Biochemistry'),
    tag: normalizeText('biochemistry'),
    maxRunnerUp: 11,
    rule: 'medmcqa_biochemistry_subject_tag_consensus11',
  },
  Radiologi: {
    subject: normalizeText('Radiology'),
    tag: normalizeText('radiology'),
    maxRunnerUp: 9,
    rule: 'medmcqa_radiology_subject_tag_consensus9',
  },
  'Anestesi & Emergency Medicine': {
    subject: normalizeText('Anaesthesia'),
    tag: normalizeText('anaesthesia'),
    maxRunnerUp: 7,
    rule: 'medmcqa_anaesthesia_subject_tag_consensus7',
  },
  Mata: {
    subject: normalizeText('Ophthalmology'),
    tag: normalizeText('ophthalmology'),
    maxRunnerUp: 7,
    rule: 'medmcqa_ophthalmology_subject_tag_consensus7',
  },
  'Ilmu Kesehatan Masyarakat': {
    subject: normalizeText('Social & Preventive Medicine'),
    tag: normalizeText('social & preventive medicine'),
    maxRunnerUp: 7,
    rule: 'medmcqa_public_health_subject_tag_consensus7',
  },
  'Kedokteran Gigi': {
    subject: normalizeText('Dental'),
    tag: normalizeText('dental'),
    maxRunnerUp: 12,
    rule: 'medmcqa_dental_subject_tag_consensus12',
  },
};

const MEDMCQA_SELF_CONFIRM_SUBJECT_TAG_PROMOTIONS = {
  Bedah: {
    subject: normalizeText('Surgery'),
    tag: normalizeText('surgery'),
    maxRunnerUp: 9,
    rule: 'medmcqa_surgery_subject_tag_confirm_consensus9',
  },
  'Ilmu Kesehatan Anak': {
    subject: normalizeText('Pediatrics'),
    tag: normalizeText('pediatrics'),
    maxRunnerUp: 10,
    rule: 'medmcqa_pediatrics_subject_tag_confirm_consensus10',
  },
  Psikiatri: {
    subject: normalizeText('Psychiatry'),
    tag: normalizeText('psychiatry'),
    maxRunnerUp: 9,
    rule: 'medmcqa_psychiatry_subject_tag_confirm_consensus9',
  },
};

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
  const basePattern = PREFIX_KEYWORD_MATCHES.has(normalizedKeyword)
    ? `(?:^| )${escapeRegExp(normalizedKeyword)}[\\p{L}\\p{N}]*(?:$| )`
    : `(?:^| )${escapeRegExp(normalizedKeyword)}(?:$| )`;
  const pattern = new RegExp(basePattern, 'u');
  return pattern.test(normalizedText);
}

function hasAnyKeywordMatch(normalizedText, normalizedKeywords) {
  if (!normalizedText) return false;
  return [...normalizedKeywords].some((keyword) => keywordMatches(normalizedText, keyword));
}

function shouldSuppressKeywordSignal(category, normalizedText, normalizedKeyword) {
  if (
    category === 'Farmakologi'
    && normalizedKeyword === 'drug'
    && hasAnyKeywordMatch(normalizedText, PHARMACOLOGY_DRUG_FALSE_POSITIVE_PATTERNS)
  ) {
    return true;
  }

  if (
    category === 'Kedokteran Gigi'
    && normalizedKeyword === 'plaque'
    && hasAnyKeywordMatch(normalizedText, DENTAL_PLAQUE_FALSE_POSITIVE_PATTERNS)
  ) {
    return true;
  }

  if (
    category === 'THT'
    && normalizedKeyword === 'sinus'
    && hasAnyKeywordMatch(normalizedText, THT_SINUS_FALSE_POSITIVE_PATTERNS)
  ) {
    return true;
  }

  return category === 'THT'
    && normalizedKeyword === 'ear'
    && hasAnyKeywordMatch(normalizedText, THT_EAR_FALSE_POSITIVE_PATTERNS);
}

function shouldSuppressTagSignal(category, normalizedTag, normalizedKeyword, source, normalizedContext = '') {
  return source === 'tags'
    && category === 'Ilmu Kesehatan Masyarakat'
    && normalizedTag === 'medicine'
    && normalizedKeyword === 'community medicine'
    && !hasAnyKeywordMatch(normalizedContext, PUBLIC_HEALTH_STRONG_CONTEXT_MATCHES);
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
    const match = keywords.find((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      if (shouldSuppressKeywordSignal(category, normalized, normalizedKeyword)) {
        return false;
      }
      return keywordMatches(normalized, normalizedKeyword);
    });
    if (match) {
      addSignal(scoreMap, signalMap, category, weight, source, match);
    }
  }
}

function collectTagSignals(tags, scoreMap, signalMap, weight = 3, source = 'tags', allowReverseMatch = true, normalizedContext = '') {
  if (!Array.isArray(tags)) return;
  const normalizedTags = tags
    .map((tag) => normalizeText(tag))
    .filter(Boolean);
  if (normalizedTags.length === 0) return;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const match = keywords.find((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      return normalizedTags.some((tag) => {
        if (shouldSuppressTagSignal(category, tag, normalizedKeyword, source, normalizedContext)) {
          return false;
        }
        return keywordMatches(tag, normalizedKeyword)
          || (allowReverseMatch && keywordMatches(normalizedKeyword, tag));
      });
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
  if (typeof caseData?.vignette === 'string') {
    return caseData.vignette;
  }

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

function hasPromotionSignalFromSources(signals, allowedMatches, allowedSources = SAFE_PROMOTION_SIGNAL_SOURCES) {
  if (!Array.isArray(signals) || signals.length === 0) return false;
  return signals.some((signal) => {
    const source = normalizeText(signal?.source);
    return allowedSources.has(source) && allowedMatches.has(normalizeText(signal?.match));
  });
}

function hasExactSignal(signals, source, match) {
  if (!Array.isArray(signals) || signals.length === 0) return false;
  const normalizedSource = normalizeText(source);
  const normalizedMatch = normalizeText(match);
  return signals.some((signal) =>
    normalizeText(signal?.source) === normalizedSource
    && normalizeText(signal?.match) === normalizedMatch);
}

function getCategoryPromotion(caseData, resolution) {
  const sourceKey = normalizeText(caseData?.source || caseData?.meta?.source || '');
  const signals = Array.isArray(resolution.winning_signals) ? resolution.winning_signals : [];
  const normalizedSubject = normalizeText(
    caseData?.subject_name
    || caseData?.subject
    || caseData?.meta?.subject
    || caseData?.meta?.subject_name
    || '',
  );
  const normalizedTags = Array.isArray(caseData?.meta?.tags)
    ? caseData.meta.tags.map((tag) => normalizeText(tag)).filter(Boolean)
    : [];
  const hasConsensus = signals.some((signal) => signal?.source === 'content-consensus');
  const hasOptionsSignal = signals.some((signal) => signal?.source === 'options');
  const normalizedContextCorpus = normalizeText(
    [
      caseData?.title,
      caseData?.prompt,
      caseData?.topic,
      caseData?.meta?.topic,
      getNarrative(caseData),
      getOptionCorpus(caseData),
    ]
      .filter(Boolean)
      .join(' '),
  );

  if (
    sourceKey === 'headqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.prefix === 'IPD'
    && resolution.resolved_category === 'Biokimia'
    && ['low', 'medium'].includes(resolution.confidence)
    && resolution.runner_up_score <= 2
    && hasConsensus
    && !hasOptionsSignal
    && hasPromotionSignal(signals, HEADQA_BIOCHEM_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'headqa_biochemistry_consensus2',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'headqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_score <= 1
    && ['low', 'medium'].includes(resolution.confidence)
    && !hasOptionsSignal
  ) {
    const allowedMatches = HEADQA_TARGETED_PROMOTION_MATCHES[resolution.resolved_category];
    if (allowedMatches && hasPromotionSignalFromSources(signals, allowedMatches)) {
      return {
        rule: 'headqa_targeted_runner1',
        confidence: 'high',
      };
    }
  }

  if (resolution.confidence !== 'low') return null;

  if (
    sourceKey === 'medqa'
    && resolution.raw_normalized_category === 'Ilmu Kesehatan Anak'
    && resolution.resolved_category === 'Ilmu Kesehatan Anak'
    && hasConsensus
    && !hasOptionsSignal
    && signals.some((signal) => signal?.source === 'tags' && normalizeText(signal?.match) === 'pediatric')
    && signals.some((signal) =>
      (signal?.source === 'keyword' || signal?.source === 'narrative')
      && MEDQA_PEDIATRICS_PROMOTION_MATCHES.has(normalizeText(signal?.match)))
  ) {
    return {
      rule: 'medqa_pediatrics_consensus',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medqa'
    && resolution.raw_normalized_category === 'Bedah'
    && resolution.resolved_category === 'Bedah'
    && resolution.prefix === 'BDH'
    && hasConsensus
    && !hasOptionsSignal
    && signals.some((signal) => signal?.source === 'tags' && normalizeText(signal?.match) === 'surgery')
    && signals.some((signal) =>
      (signal?.source === 'keyword' || signal?.source === 'narrative')
      && MEDQA_SURGERY_PROMOTION_MATCHES.has(normalizeText(signal?.match)))
  ) {
    return {
      rule: 'medqa_surgery_consensus',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medqa'
    && resolution.runner_up_score <= 2
    && !hasOptionsSignal
  ) {
    const allowedMatches = MEDQA_TARGETED_PROMOTION_MATCHES[resolution.resolved_category];
    if (allowedMatches && hasPromotionSignalFromSources(signals, allowedMatches)) {
      return {
        rule: 'medqa_targeted_runner2',
        confidence: 'high',
      };
    }
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Bedah'
    && resolution.resolved_category === 'Bedah'
    && hasConsensus
    && !hasOptionsSignal
    && hasPromotionSignal(signals, MEDMCQA_BEDAH_CONFIRM_MATCHES)
    && signals.some((signal) => signal?.source === 'subject')
    && signals.some((signal) => signal?.source === 'tags')
    && signals.some((signal) => signal?.source === 'keyword')
  ) {
    return {
      rule: 'medmcqa_bedah_confirm_consensus',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && BROAD_RAW_CATEGORIES.has(resolution.raw_normalized_category)
    && resolution.resolved_category === 'Ilmu Kesehatan Anak'
    && resolution.runner_up_score <= 10
    && hasConsensus
    && !hasOptionsSignal
    && hasPromotionSignalFromSources(signals, MEDMCQA_PEDIATRICS_STRONG_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_pediatrics_consensus10',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Kesehatan Anak'
    && resolution.runner_up_score <= 10
    && hasConsensus
    && normalizedSubject === normalizeText('Medicine')
    && hasExactSignal(signals, 'organ_system', 'pediatrics')
    && hasPromotionSignalFromSources(
      signals,
      MEDMCQA_PEDIATRICS_MEDICINE_PROMOTION_MATCHES,
      new Set(['topic_keywords', 'keyword', 'narrative', 'options'].map((term) => normalizeText(term))),
    )
  ) {
    return {
      rule: 'medmcqa_pediatrics_medicine_consensus10',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Bedah'
    && resolution.runner_up_score <= 10
    && hasConsensus
    && !hasOptionsSignal
    && hasPromotionSignalFromSources(signals, MEDMCQA_SURGERY_STRONG_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_surgery_consensus10',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Obstetri & Ginekologi'
    && resolution.runner_up_score <= 11
    && hasConsensus
    && !hasOptionsSignal
    && hasPromotionSignalFromSources(signals, MEDMCQA_OBGYN_STRONG_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_obgyn_consensus11',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Patologi Anatomi'
    && resolution.runner_up_score <= 9
    && hasAnyKeywordMatch(normalizedContextCorpus, new Set([normalizeText('biopsy')]))
    && hasAnyKeywordMatch(normalizedContextCorpus, new Set([normalizeText('onion skin')]))
  ) {
    return {
      rule: 'medmcqa_pathology_biopsy_onion_skin_consensus9',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Patologi Anatomi'
    && resolution.runner_up_score <= 6
    && normalizedSubject === normalizeText('Pathology')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('pathology')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_MORPHOLOGY_PROMOTION_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_DENTAL_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_BIOCHEM_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_SURGERY_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_OBGYN_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_PUBLIC_HEALTH_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_OPHTHALMOLOGY_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_INTERNAL_MEDICINE_FALSE_POSITIVE_MATCHES)
  ) {
    return {
      rule: 'medmcqa_pathology_morphology_subject_tag_runner6',
      confidence: 'high',
      resolved_category: 'Patologi Anatomi',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.resolved_category === 'Patologi Anatomi'
    && resolution.runner_up_score <= 5
    && normalizedSubject === normalizeText('Pathology')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('pathology')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_EXACT_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_pathology_exact_phrase_subject_tag_consensus5',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Patologi Anatomi'
    && resolution.runner_up_score <= 4
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_TEXTUAL_SUPPORT_MATCHES)
  ) {
    return {
      rule: 'medmcqa_pathology_text_runner4',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Patologi Anatomi'
    && resolution.runner_up_score <= 5
    && hasExactSignal(signals, 'subject', 'Pathology')
    && hasExactSignal(signals, 'tags', 'pathology')
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_TEXTUAL_SUPPORT_MATCHES)
  ) {
    return {
      rule: 'medmcqa_pathology_subject_tag_consensus5',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Patologi Anatomi'
    && resolution.runner_up_score <= 6
    && normalizedSubject === normalizeText('Pathology')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('pathology')))
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_DENTAL_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_BIOCHEM_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_SURGERY_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_OBGYN_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_PUBLIC_HEALTH_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_AEM_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_DERM_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_OPHTHALMOLOGY_FALSE_POSITIVE_MATCHES)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_INTERNAL_MEDICINE_FALSE_POSITIVE_MATCHES)
  ) {
    return {
      rule: 'medmcqa_pathology_subject_tag_rescue_runner6',
      confidence: 'high',
      resolved_category: 'Patologi Anatomi',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Patologi Anatomi'
    && resolution.runner_up_score <= 5
    && hasAnyKeywordMatch(normalizedContextCorpus, new Set([normalizeText('streptococcus pyogenes')]))
    && hasAnyKeywordMatch(normalizedContextCorpus, new Set([normalizeText('host receptor')]))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_INTERNAL_MEDICINE_STREP_HOST_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_medicine_streptococcus_host_receptor_consensus5',
      confidence: 'high',
      resolved_category: 'Ilmu Penyakit Dalam',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Patologi Anatomi'
    && resolution.runner_up_score <= 5
    && hasAnyKeywordMatch(normalizedContextCorpus, new Set([normalizeText('peripheral smear')]))
    && (
      hasAnyKeywordMatch(normalizedContextCorpus, new Set([normalizeText('x ray spine')]))
      || hasAnyKeywordMatch(normalizedContextCorpus, new Set([normalizeText('x-ray spine')]))
    )
    && hasAnyKeywordMatch(normalizedContextCorpus, new Set([normalizeText('hand foot syndrome'), normalizeText('hand-foot syndrome')]))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_INTERNAL_MEDICINE_HEMATOLOGY_RESCUE_MATCHES)
  ) {
    return {
      rule: 'medmcqa_medicine_peripheral_smear_xray_handfoot_consensus5',
      confidence: 'high',
      resolved_category: 'Ilmu Penyakit Dalam',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Mikrobiologi'
    && resolution.runner_up_score <= 6
    && normalizedSubject === normalizeText('Microbiology')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('microbiology')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_MICROBIOLOGY_EXACT_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_microbiology_exact_phrase_runner6',
      confidence: 'high',
      resolved_category: 'Mikrobiologi',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Mikrobiologi'
    && resolution.runner_up_score <= 5
    && normalizedSubject === normalizeText('Microbiology')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('microbiology')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_MICROBIOLOGY_EXACT_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_microbiology_exact_phrase_consensus5',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Anatomi'
    && resolution.runner_up_score <= 5
    && (
      normalizedSubject === normalizeText('Anatomy')
      || normalizedSubject === normalizeText('Unknown')
    )
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('anatomy')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_ANATOMY_EXACT_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_anatomy_exact_phrase_consensus5',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Mikrobiologi'
    && resolution.runner_up_score <= 6
    && normalizedSubject === normalizeText('Microbiology')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('microbiology')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_MICROBIOLOGY_STRONG_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_microbiology_subject_tag_runner6',
      confidence: 'high',
      resolved_category: 'Mikrobiologi',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Mikrobiologi'
    && resolution.runner_up_score <= 6
    && normalizedSubject === normalizeText('Microbiology')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('microbiology')))
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_MICROBIOLOGY_FALSE_POSITIVE_MATCHES)
  ) {
    return {
      rule: 'medmcqa_microbiology_subject_tag_rescue_runner6',
      confidence: 'high',
      resolved_category: 'Mikrobiologi',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Kulit & Kelamin'
    && resolution.runner_up_score <= 3
    && normalizedSubject === normalizeText('Skin')
    && normalizeText(caseData?.meta?.organ_system) === normalizeText('dermatology')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('skin')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_DERMATOLOGY_STRONG_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_dermatology_subject_tag_runner3',
      confidence: 'high',
      resolved_category: 'Kulit & Kelamin',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Kulit & Kelamin'
    && resolution.runner_up_score <= 3
    && normalizedSubject === normalizeText('Skin')
    && normalizeText(caseData?.meta?.organ_system) === normalizeText('dermatology')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('skin')))
  ) {
    return {
      rule: 'medmcqa_dermatology_subject_tag_rescue3',
      confidence: 'high',
      resolved_category: 'Kulit & Kelamin',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Anatomi'
    && resolution.runner_up_score <= 6
    && (
      normalizedSubject === normalizeText('Anatomy')
      || normalizedSubject === normalizeText('Unknown')
    )
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('anatomy')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_ANATOMY_EXACT_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_anatomy_exact_phrase_runner6',
      confidence: 'high',
      resolved_category: 'Anatomi',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Anatomi'
    && resolution.runner_up_score <= 6
    && normalizedSubject === normalizeText('Anatomy')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('anatomy')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_ANATOMY_STRONG_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_anatomy_subject_tag_runner6',
      confidence: 'high',
      resolved_category: 'Anatomi',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Bedah'
    && resolution.runner_up_score <= 3
    && normalizedSubject === normalizeText('Orthopaedics')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('orthopaedics')))
  ) {
    return {
      rule: 'medmcqa_orthopaedics_subject_tag_rescue3',
      confidence: 'high',
      resolved_category: 'Bedah',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Anatomi'
    && resolution.runner_up_score <= 4
    && normalizedSubject === normalizeText('Anatomy')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('anatomy')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_ANATOMY_STRONG_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_anatomy_subject_tag_consensus4',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Anatomi'
    && resolution.runner_up_category === 'Bedah'
    && resolution.runner_up_score <= 6
    && normalizedSubject === normalizeText('Orthopaedics')
    && normalizeText(caseData?.meta?.organ_system) === normalizeText('musculoskeletal')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('orthopaedics')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_ORTHOPAEDICS_BEDAH_RESCUE_MATCHES)
  ) {
    return {
      rule: 'medmcqa_orthopaedics_runner_bedah_consensus6',
      confidence: 'high',
      resolved_category: 'Bedah',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Kedokteran Gigi'
    && resolution.runner_up_score <= 6
    && (
      normalizedSubject === normalizeText('Pathology')
      || normalizedSubject === normalizeText('Anatomy')
    )
    && (
      normalizedTags.some((tag) => keywordMatches(tag, normalizeText('pathology')))
      || normalizedTags.some((tag) => keywordMatches(tag, normalizeText('anatomy')))
    )
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_DENTAL_EXACT_PROMOTION_MATCHES)
  ) {
    return {
      rule: 'medmcqa_dental_exact_phrase_consensus6',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Psikiatri'
    && resolution.resolved_category === 'Ilmu Kesehatan Anak'
    && resolution.runner_up_category === 'Psikiatri'
    && resolution.runner_up_score <= 12
    && normalizedSubject === normalizeText('Psychiatry')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('psychiatry')))
  ) {
    return {
      rule: 'medmcqa_psychiatry_child_drift_rescue12',
      confidence: 'high',
      resolved_category: 'Psikiatri',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Bedah'
    && resolution.resolved_category === 'Ilmu Kesehatan Anak'
    && resolution.runner_up_category === 'Bedah'
    && resolution.runner_up_score <= 13
    && normalizedSubject === normalizeText('Surgery')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('surgery')))
  ) {
    return {
      rule: 'medmcqa_surgery_child_drift_rescue13',
      confidence: 'high',
      resolved_category: 'Bedah',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Obstetri & Ginekologi'
    && resolution.resolved_category === 'Ilmu Kesehatan Anak'
    && resolution.runner_up_category === 'Obstetri & Ginekologi'
    && resolution.runner_up_score <= 10
    && normalizedSubject === normalizeText('Gynaecology & Obstetrics')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('gynaecology & obstetrics')))
  ) {
    return {
      rule: 'medmcqa_obg_child_drift_rescue10',
      confidence: 'high',
      resolved_category: 'Obstetri & Ginekologi',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Psikiatri'
    && resolution.resolved_category === 'Farmakologi'
    && resolution.runner_up_category === 'Psikiatri'
    && resolution.runner_up_score <= 10
    && normalizedSubject === normalizeText('Psychiatry')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('psychiatry')))
    && normalizeText(caseData?.meta?.organ_system) === normalizeText('pharmacology')
  ) {
    return {
      rule: 'medmcqa_psychiatry_pharmacology_drift_rescue10',
      confidence: 'high',
      resolved_category: 'Psikiatri',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Bedah'
    && resolution.resolved_category === 'Ilmu Penyakit Dalam'
    && resolution.runner_up_category === 'Bedah'
    && resolution.runner_up_score <= 10
    && normalizedSubject === normalizeText('Surgery')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('surgery')))
  ) {
    return {
      rule: 'medmcqa_surgery_subject_tag_rescue10',
      confidence: 'high',
      resolved_category: 'Bedah',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Bedah'
    && resolution.resolved_category === 'Farmakologi'
    && resolution.runner_up_category === 'Bedah'
    && resolution.runner_up_score <= 10
    && normalizedSubject === normalizeText('Surgery')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('surgery')))
    && normalizeText(caseData?.meta?.organ_system) === normalizeText('pharmacology')
  ) {
    return {
      rule: 'medmcqa_surgery_pharmacology_drift_rescue10',
      confidence: 'high',
      resolved_category: 'Bedah',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && ['Radiologi', 'Mata'].includes(resolution.raw_normalized_category)
    && resolution.resolved_category === 'Ilmu Kesehatan Anak'
    && resolution.runner_up_score <= 5
    && resolution.prefix === 'GEN'
    && normalizedSubject === normalizeText('Pediatrics')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('pediatrics')))
  ) {
    return {
      rule: 'medmcqa_pediatrics_modality_subject_tag_consensus5',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Radiologi'
    && resolution.resolved_category === 'Kedokteran Gigi'
    && resolution.runner_up_score <= 5
    && normalizedSubject === normalizeText('Dental')
    && normalizedTags.some((tag) => keywordMatches(tag, normalizeText('dental')))
    && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_DENTAL_MODALITY_RESCUE_MATCHES)
  ) {
    return {
      rule: 'medmcqa_dental_rvg_modality_consensus5',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === resolution.resolved_category
  ) {
    for (const [category, confirmation] of Object.entries(MEDMCQA_SELF_CONFIRM_SUBJECT_TAG_PROMOTIONS)) {
      if (
        resolution.resolved_category === category
        && resolution.runner_up_score <= confirmation.maxRunnerUp
        && normalizedSubject === confirmation.subject
        && normalizedTags.some((tag) => keywordMatches(tag, confirmation.tag))
      ) {
        return {
          rule: confirmation.rule,
          confidence: 'high',
        };
      }
    }
  }

  if (
    sourceKey === 'medmcqa'
    && BROAD_RAW_CATEGORIES.has(resolution.raw_normalized_category)
  ) {
    for (const [category, trustedPromotion] of Object.entries(MEDMCQA_SUBJECT_TAG_TRUSTED_PROMOTIONS)) {
      if (
        resolution.runner_up_score <= trustedPromotion.maxRunnerUp
        && normalizedSubject === trustedPromotion.subject
        && normalizedTags.some((tag) => keywordMatches(tag, trustedPromotion.tag))
      ) {
        return {
          rule: trustedPromotion.rule,
          confidence: 'high',
          resolved_category: category,
        };
      }
    }
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Farmakologi'
    && resolution.runner_up_score <= 10
    && hasConsensus
    && normalizedSubject === normalizeText('Medicine')
    && hasExactSignal(signals, 'organ_system', 'pharmacology')
    && hasPromotionSignalFromSources(
      signals,
      new Set([normalizeText('drug')]),
      new Set(['topic_keywords', 'keyword', 'narrative'].map((term) => normalizeText(term))),
    )
  ) {
    return {
      rule: 'medmcqa_pharmacology_medicine_consensus10',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Neurologi'
    && resolution.runner_up_score <= 10
    && hasConsensus
    && normalizedSubject === normalizeText('Medicine')
    && hasExactSignal(signals, 'organ_system', 'neurological')
    && hasPromotionSignalFromSources(
      signals,
      MEDMCQA_NEUROLOGY_STRONG_PROMOTION_MATCHES,
      new Set(['tags', 'topic_keywords', 'keyword', 'narrative', 'options'].map((term) => normalizeText(term))),
    )
  ) {
    return {
      rule: 'medmcqa_neurology_medicine_consensus10',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Psikiatri'
    && resolution.runner_up_score <= 10
    && hasConsensus
    && normalizedSubject === normalizeText('Medicine')
    && hasExactSignal(signals, 'organ_system', 'psychiatry')
    && hasPromotionSignalFromSources(
      signals,
      MEDMCQA_PSYCHIATRY_STRONG_PROMOTION_MATCHES,
      new Set(['topic_keywords', 'keyword', 'narrative', 'options'].map((term) => normalizeText(term))),
    )
  ) {
    return {
      rule: 'medmcqa_psychiatry_medicine_consensus10',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'THT'
    && resolution.runner_up_score <= 10
    && hasConsensus
    && normalizedSubject === normalizeText('Medicine')
    && hasExactSignal(signals, 'organ_system', 'ent')
    && hasPromotionSignalFromSources(
      signals,
      MEDMCQA_ENT_STRONG_PROMOTION_MATCHES,
      new Set(['topic_keywords', 'keyword', 'narrative', 'options'].map((term) => normalizeText(term))),
    )
  ) {
    return {
      rule: 'medmcqa_ent_medicine_consensus10',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Mata'
    && resolution.runner_up_score <= 10
    && hasConsensus
    && normalizedSubject === normalizeText('Medicine')
    && hasExactSignal(signals, 'organ_system', 'ophthalmology')
    && hasPromotionSignalFromSources(
      signals,
      MEDMCQA_OPHTHALMOLOGY_STRONG_PROMOTION_MATCHES,
      new Set(['topic_keywords', 'keyword', 'narrative', 'options'].map((term) => normalizeText(term))),
    )
  ) {
    return {
      rule: 'medmcqa_ophthalmology_medicine_consensus10',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Farmakologi'
    && resolution.runner_up_score <= 11
    && hasConsensus
    && hasExactSignal(signals, 'subject', 'Pharmacology')
    && hasExactSignal(signals, 'tags', 'pharmacology')
    && hasPromotionSignalFromSources(
      signals,
      MEDMCQA_PHARMACOLOGY_STRONG_PROMOTION_MATCHES,
      TEXT_ONLY_PROMOTION_SIGNAL_SOURCES,
    )
  ) {
    return {
      rule: 'medmcqa_pharmacology_subject_tag_consensus11',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Radiologi'
    && resolution.runner_up_score <= 10
    && hasConsensus
    && hasExactSignal(signals, 'subject', 'Radiology')
    && hasExactSignal(signals, 'tags', 'radiology')
    && hasPromotionSignalFromSources(
      signals,
      MEDMCQA_RADIOLOGY_STRONG_PROMOTION_MATCHES,
      TEXT_ONLY_PROMOTION_SIGNAL_SOURCES,
    )
  ) {
    return {
      rule: 'medmcqa_radiology_subject_tag_consensus10',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && resolution.raw_normalized_category === 'Ilmu Penyakit Dalam'
    && resolution.resolved_category === 'Ilmu Kesehatan Masyarakat'
    && resolution.runner_up_score <= 7
    && hasConsensus
    && !hasOptionsSignal
    && hasExactSignal(signals, 'subject', 'Social & Preventive Medicine')
    && hasPromotionSignalFromSources(
      signals,
      MEDMCQA_TARGETED_PROMOTION_MATCHES['Ilmu Kesehatan Masyarakat'],
      TEXT_ONLY_PROMOTION_SIGNAL_SOURCES,
    )
  ) {
    return {
      rule: 'medmcqa_public_health_subject_consensus7',
      confidence: 'high',
    };
  }

  if (
    sourceKey === 'medmcqa'
    && BROAD_RAW_CATEGORIES.has(resolution.raw_normalized_category)
    && resolution.runner_up_score <= 4
    && hasConsensus
    && !hasOptionsSignal
  ) {
    const allowedMatches = MEDMCQA_TARGETED_PROMOTION_MATCHES[resolution.resolved_category];
    if (allowedMatches && hasPromotionSignalFromSources(signals, allowedMatches)) {
      return {
        rule: 'medmcqa_targeted_consensus4',
        confidence: 'high',
      };
    }
  }

  if (sourceKey === 'polish ldek en') {
    if (resolution.resolved_category !== 'Kedokteran Gigi') return null;
    if (!hasPromotionSignal(signals, POLISH_LDEK_DENTAL_PROMOTION_MATCHES)) return null;

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

  if (sourceKey === 'pubmedqa' && resolution.runner_up_score <= 2) {
    const allowedMatches = PUBMEDQA_PROMOTION_MATCHES[resolution.resolved_category];
    if (allowedMatches && hasPromotionSignal(signals, allowedMatches)) {
      return {
        rule: 'pubmedqa_targeted_runner2',
        confidence: 'high',
      };
    }
  }

  if (sourceKey === 'tw medqa' && resolution.runner_up_score <= 2) {
    const allowedMatches = TW_MEDQA_PROMOTION_MATCHES[resolution.resolved_category];
    if (allowedMatches && hasPromotionSignal(signals, allowedMatches)) {
      return {
        rule: 'tw_medqa_targeted_runner2',
        confidence: 'high',
      };
    }
  }

  if (sourceKey === 'tw medqa' && resolution.runner_up_score <= 4) {
    const allowedMatches = TW_MEDQA_PROMOTION_MATCHES[resolution.resolved_category];
    if (allowedMatches && hasConsensus && hasPromotionSignal(signals, allowedMatches)) {
      return {
        rule: 'tw_medqa_targeted_consensus4',
        confidence: 'high',
      };
    }
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
  const sourceKey = normalizeText(source);
  const profile = getSourceProfile(source);
  const scoreMap = new Map();
  const signalMap = new Map();
  const titlePromptCorpus = [
    caseData?.title,
    caseData?.prompt,
    caseData?.topic,
    caseData?.meta?.topic,
  ]
    .filter(Boolean)
    .join(' ');
  const narrativeCorpus = getNarrative(caseData);
  const optionCorpus = getOptionCorpus(caseData);
  const normalizedContextCorpus = normalizeText(
    [
      titlePromptCorpus,
      narrativeCorpus,
      optionCorpus,
    ]
      .filter(Boolean)
      .join(' '),
  );

  const rawWeight = getRawWeight(source, rawNormalized, profile);
  if (rawNormalized && rawWeight > 0) {
    addSignal(scoreMap, signalMap, rawNormalized, rawWeight, 'raw', rawCategory);
  }

  const subject = caseData?.subject_name || caseData?.subject || caseData?.meta?.subject || caseData?.meta?.subject_name || null;
  const normalizedSubjectText = normalizeText(subject);
  const normalizedSubject = normalizeCategoryExact(subject);
  const normalizedMetaTags = Array.isArray(caseData?.meta?.tags)
    ? caseData.meta.tags.map((tag) => normalizeText(tag)).filter(Boolean)
    : [];
  const hasBroadMedmcqaPathologyMetadata = (
    sourceKey === 'medmcqa'
    && BROAD_RAW_CATEGORIES.has(rawNormalized)
    && (
      normalizedSubject === 'Patologi Anatomi'
      || normalizedMetaTags.some((tag) => keywordMatches(tag, normalizeText('pathology')))
    )
  );
  const suppressBroadMedmcqaPathologyMetadata = (
    hasBroadMedmcqaPathologyMetadata
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_TEXTUAL_SUPPORT_MATCHES)
    && (
      hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_DENTAL_FALSE_POSITIVE_MATCHES)
      || hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_BIOCHEM_FALSE_POSITIVE_MATCHES)
      || hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_SURGERY_FALSE_POSITIVE_MATCHES)
      || hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_OBGYN_FALSE_POSITIVE_MATCHES)
      || hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_PUBLIC_HEALTH_FALSE_POSITIVE_MATCHES)
      || hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_AEM_FALSE_POSITIVE_MATCHES)
      || hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_DERM_FALSE_POSITIVE_MATCHES)
      || hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_OPHTHALMOLOGY_FALSE_POSITIVE_MATCHES)
      || hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_PATHOLOGY_INTERNAL_MEDICINE_FALSE_POSITIVE_MATCHES)
    )
  );
  const suppressBroadMedmcqaAnatomyMetadata = (
    sourceKey === 'medmcqa'
    && BROAD_RAW_CATEGORIES.has(rawNormalized)
    && normalizedSubject === 'Anatomi'
  );
  if (
    normalizedSubject
    && !suppressBroadMedmcqaAnatomyMetadata
    && !(suppressBroadMedmcqaPathologyMetadata && normalizedSubject === 'Patologi Anatomi')
  ) {
    addSignal(scoreMap, signalMap, normalizedSubject, profile.subject, 'subject', subject);
  } else if (!normalizedSubject) {
    collectKeywordSignals(subject, 'subject', profile.subject, scoreMap, signalMap);
  }

  const hasMicrobiologyMetadata = normalizedSubject === 'Mikrobiologi'
    || normalizedMetaTags.some((tag) => keywordMatches(tag, normalizeText('microbiology')));
  const suppressBroadMedmcqaPharmacologyMetadata = (
    sourceKey === 'medmcqa'
    && BROAD_RAW_CATEGORIES.has(rawNormalized)
    && normalizeText(caseData?.meta?.organ_system) === 'pharmacology'
    && (
      hasAnyKeywordMatch(normalizedContextCorpus, PHARMACOLOGY_DRUG_FALSE_POSITIVE_PATTERNS)
      || (
        hasMicrobiologyMetadata
        && hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_MICROBIOLOGY_PHARMACOLOGY_SUPPRESSION_PATTERNS)
      )
    )
  );
  const suppressBroadMedmcqaEntMetadata = (
    sourceKey === 'medmcqa'
    && BROAD_RAW_CATEGORIES.has(rawNormalized)
    && normalizeText(caseData?.meta?.organ_system) === 'ent'
    && hasAnyKeywordMatch(normalizedContextCorpus, THT_EAR_FALSE_POSITIVE_PATTERNS)
    && !hasAnyKeywordMatch(normalizedContextCorpus, MEDMCQA_ENT_TEXTUAL_SUPPORT_MATCHES)
  );
  const filteredTags = Array.isArray(caseData?.meta?.tags)
    ? caseData.meta.tags.filter((tag) => {
      const normalizedTag = normalizeText(tag);
      if (suppressBroadMedmcqaAnatomyMetadata && normalizedTag === 'anatomy') {
        return false;
      }
      return !(
        suppressBroadMedmcqaPathologyMetadata
        && keywordMatches(normalizedTag, normalizeText('pathology'))
      );
    })
    : caseData?.meta?.tags;
  collectTagSignals(filteredTags, scoreMap, signalMap, profile.tags, 'tags', true, normalizedContextCorpus);
  const filteredTopicKeywords = Array.isArray(caseData?.meta?.topic_keywords)
    ? caseData.meta.topic_keywords.filter((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      if (
        sourceKey === 'medmcqa'
        && BROAD_RAW_CATEGORIES.has(rawNormalized)
        && normalizedSubjectText === normalizeText('Medicine')
        && normalizeText(caseData?.meta?.organ_system) === 'public health'
        && normalizedKeyword === 'screening'
        && !hasAnyKeywordMatch(normalizedContextCorpus, PUBLIC_HEALTH_STRONG_CONTEXT_MATCHES)
      ) {
        return false;
      }
      if (
        suppressBroadMedmcqaPharmacologyMetadata
        && normalizedKeyword === 'dose'
      ) {
        return false;
      }
      if (
        sourceKey === 'medmcqa'
        && BROAD_RAW_CATEGORIES.has(rawNormalized)
        && normalizedKeyword === 'drug'
        && hasAnyKeywordMatch(normalizedContextCorpus, PHARMACOLOGY_DRUG_FALSE_POSITIVE_PATTERNS)
      ) {
        return false;
      }
      if (
        normalizedKeyword === 'sinus'
        && hasAnyKeywordMatch(normalizedContextCorpus, THT_SINUS_FALSE_POSITIVE_PATTERNS)
      ) {
        return false;
      }
      if (
        normalizedKeyword === 'ear'
        && hasAnyKeywordMatch(normalizedContextCorpus, THT_EAR_FALSE_POSITIVE_PATTERNS)
      ) {
        return false;
      }
      return true;
    })
    : caseData?.meta?.topic_keywords;
  collectTagSignals(filteredTopicKeywords, scoreMap, signalMap, profile.topic, 'topic_keywords', false, normalizedContextCorpus);
  if (
    caseData?.meta?.organ_system
    && !suppressBroadMedmcqaPharmacologyMetadata
    && !suppressBroadMedmcqaEntMetadata
  ) {
    collectTagSignals([caseData.meta.organ_system], scoreMap, signalMap, profile.organ, 'organ_system', false, normalizedContextCorpus);
  }

  const prefix = extractCaseCodePrefix(caseData?.case_code);
  const prefixCategory = prefix ? CASE_CODE_PREFIX_MAP[prefix] : null;
  if (prefixCategory && prefixCategory !== rawNormalized && profile.prefix > 0) {
    addSignal(scoreMap, signalMap, prefixCategory, profile.prefix, 'prefix', prefix);
  }

  collectKeywordSignals(titlePromptCorpus, 'keyword', profile.keyword, scoreMap, signalMap);
  collectKeywordSignals(narrativeCorpus, 'narrative', profile.narrative, scoreMap, signalMap);
  collectKeywordSignals(optionCorpus, 'options', profile.options, scoreMap, signalMap);

  for (const [category, signals] of signalMap.entries()) {
    const contentSources = new Set(
      signals
        .map((signal) => signal.source)
        .filter((source) => CONTENT_CONSENSUS_SOURCES.has(source)),
    );
    const hasTextualConsensusSignal = [...contentSources].some((source) => TEXTUAL_CONSENSUS_SOURCES.has(source));
    if (contentSources.size >= 2 && hasTextualConsensusSignal) {
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

function getAppliedCategoryAdjudication(caseData, resolution) {
  const adjudication = caseData?.meta?.category_adjudication;
  if (!adjudication || typeof adjudication !== 'object') {
    return null;
  }

  if (normalizeText(adjudication.status) !== 'applied') {
    return null;
  }

  const decision = String(adjudication.decision || '').trim().toUpperCase();
  const recommendedCategory = normalizeCategoryExact(adjudication.recommended_category);
  const currentCategory = normalizeCategoryExact(
    adjudication.current_category
      || resolution.raw_normalized_category
      || resolution.raw_category
      || caseData?.category,
  );
  const targetCategory = normalizeCategoryExact(
    adjudication.target_category
      || resolution.resolved_category,
  );
  const runnerUpCategory = normalizeCategoryExact(
    adjudication.runner_up_category
      || resolution.runner_up_category,
  );

  if (!recommendedCategory) {
    return null;
  }

  if (decision === 'KEEP_CURRENT' && currentCategory && recommendedCategory === currentCategory) {
    return {
      resolved_category: recommendedCategory,
      confidence: 'high',
      adjudication_confidence: String(adjudication.confidence || '').trim().toUpperCase() || null,
      decision,
      rule: 'ai_category_adjudication_keep_current',
    };
  }

  if (decision === 'PROMOTE_RUNNER_UP' && runnerUpCategory && recommendedCategory === runnerUpCategory) {
    return {
      resolved_category: recommendedCategory,
      confidence: 'high',
      adjudication_confidence: String(adjudication.confidence || '').trim().toUpperCase() || null,
      decision,
      rule: 'ai_category_adjudication_promote_runner_up',
    };
  }

  if (decision === 'PROMOTE_RUNNER_UP' && targetCategory && recommendedCategory === targetCategory) {
    return {
      resolved_category: recommendedCategory,
      confidence: 'high',
      adjudication_confidence: String(adjudication.confidence || '').trim().toUpperCase() || null,
      decision,
      rule: 'ai_category_adjudication_promote_target',
    };
  }

  return null;
}

export function applyResolvedCategory(caseData) {
  const resolution = resolveCaseCategory(caseData);
  const adjudication = getAppliedCategoryAdjudication(caseData, resolution);
  const promotion = getCategoryPromotion(caseData, resolution);
  const effectiveConfidence = adjudication?.confidence || promotion?.confidence || resolution.confidence;
  const effectiveResolvedCategory = adjudication?.resolved_category || promotion?.resolved_category || resolution.resolved_category;
  const existingResolution = caseData?.meta?.category_resolution && typeof caseData.meta.category_resolution === 'object'
    ? caseData.meta.category_resolution
    : null;
  const preservedRawCategory = existingResolution?.raw_category ?? resolution.raw_category;
  const preservedRawNormalized = existingResolution?.raw_normalized_category ?? resolution.raw_normalized_category;
  const validRaw = preservedRawNormalized;
  let finalCategory = validRaw || UNCLASSIFIED_CATEGORY;

  if (effectiveConfidence === 'high') {
    finalCategory = effectiveResolvedCategory || finalCategory;
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
        resolved_category: effectiveResolvedCategory,
        confidence: effectiveConfidence,
        base_confidence: resolution.confidence,
        ...(adjudication?.adjudication_confidence
          ? { adjudication_confidence: adjudication.adjudication_confidence }
          : {}),
        ...(adjudication?.decision
          ? { adjudication_decision: adjudication.decision }
          : {}),
        category_conflict: resolution.category_conflict,
        winning_signals: resolution.winning_signals,
        runner_up_category: resolution.runner_up_category,
        runner_up_score: resolution.runner_up_score,
        prefix: resolution.prefix,
        promotion_rule: adjudication?.rule || promotion?.rule || null,
      },
    },
  };
}
