import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCasebankRepository } from '../server/casebank-repository.js';
import { normalizeDisplayText } from '../src/lib/displayTextNormalization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FILE = join(__dirname, '..', 'public', 'data', 'compiled_cases.json');
const REPORT_FILE = join(__dirname, 'output', 'source_text_micro_tranche_report.json');

function writeJsonAtomically(filePath, value, pretty = true) {
  const tempFile = `${filePath}.tmp`;
  const payload = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
  writeFileSync(tempFile, payload, 'utf8');
  try {
    renameSync(tempFile, filePath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['EPERM', 'EBUSY'].includes(error.code)) {
      throw error;
    }
    writeFileSync(filePath, payload, 'utf8');
    rmSync(tempFile, { force: true });
  }
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getStringField(caseRecord, path) {
  const segments = path.split('.');
  let current = caseRecord;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return '';
    }
    current = current[segment];
  }
  return typeof current === 'string' ? current : '';
}

function setStringField(caseRecord, path, value) {
  const segments = path.split('.');
  let current = caseRecord;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function applyReplace(path, from, to) {
  return (caseRecord, report) => {
    const current = getStringField(caseRecord, path);
    if (!current || !current.includes(from)) {
      return false;
    }

    const next = normalizeDisplayText(current.replace(from, to));
    if (next === current) {
      return false;
    }

    setStringField(caseRecord, path, next);
    report.push({
      field: path,
      before: normalizeWhitespace(current).slice(0, 180),
      after: normalizeWhitespace(next).slice(0, 180),
    });
    return true;
  };
}

function applySet(path, value) {
  return (caseRecord, report) => {
    const current = getStringField(caseRecord, path);
    const next = normalizeDisplayText(value);
    if (current === next) {
      return false;
    }

    setStringField(caseRecord, path, next);
    report.push({
      field: path,
      before: normalizeWhitespace(current).slice(0, 180),
      after: normalizeWhitespace(next).slice(0, 180),
    });
    return true;
  };
}

function applyCorrectOption(optionId) {
  return (caseRecord, report) => {
    if (!Array.isArray(caseRecord?.options) || caseRecord.options.length === 0) {
      return false;
    }

    const before = caseRecord.options.find((option) => option?.is_correct)?.id ?? '';
    let changed = false;
    for (const option of caseRecord.options) {
      const shouldBeCorrect = String(option?.id ?? '') === String(optionId);
      if (Boolean(option?.is_correct) !== shouldBeCorrect) {
        option.is_correct = shouldBeCorrect;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    report.push({
      field: 'options.is_correct',
      before,
      after: String(optionId),
    });
    return true;
  };
}

const FIXERS = new Map([
  [1453, [
    applyReplace('rationale.correct', 'age &; become increasingly separated', 'age and become increasingly separated'),
  ]],
  [2603, [
    applyReplace('rationale.correct', 'edition &; Pgno', 'edition, Pgno'),
  ]],
  [7732, [
    applyReplace('rationale.correct', 'fever &;are called as pyrogenic cytokines', 'fever are called pyrogenic cytokines'),
  ]],
  [7814, [
    applyReplace('rationale.correct', 'forms the &;skeletal &;basis', 'forms the skeletal basis'),
  ]],
  [10540, [
    applyReplace('rationale.correct', "called the &;breakpoint chlorine'Chlorine added", 'called the breakpoint chlorine. Chlorine added'),
  ]],
  [31119, [
    applyReplace('rationale.correct', '"""&;"&;n * Airway collars,', '\n* Airway collars,'),
  ]],
  [31227, [
    applyReplace('prompt', 'am &; amniotic fluid', 'amount of amniotic fluid'),
    applyReplace('vignette.narrative', 'am &; amniotic fluid', 'amount of amniotic fluid'),
  ]],
  [32229, [
    applyReplace('rationale.correct', 'following reduction &;schema time >8 hours has amputation rates', 'following reduction; ischemia time >8 hours has high amputation rates'),
  ]],
  [38074, [
    applyReplace('rationale.correct', 'following reduction &;schema time >8 hours has amputation rates', 'following reduction; ischemia time >8 hours has high amputation rates'),
  ]],
  [42600, [
    applySet('title', "Which of the following is a histological feature of Whipple's disease?"),
    applySet('prompt', "Which of the following is a histological feature of Whipple's disease?"),
    applySet('question', "Which of the following is a histological feature of Whipple's disease?"),
    applySet('vignette.narrative', "Which of the following is a histological feature of Whipple's disease?"),
  ]],
  [42914, [
    applyReplace('rationale.correct', 'tendon of flexor digitorum &;onus longus', 'tendon of flexor digitorum longus'),
  ]],
  [11899, [
    applySet('rationale.correct', 'Sodium is the main contributor among the listed options. Renal medullary hyperosmolarity is generated primarily by active NaCl reabsorption in the thick ascending limb of the loop of Henle and maintained by the countercurrent multiplier system. Potassium and chloride contribute, but sodium is the dominant factor among these choices.'),
  ]],
  [12228, [
    applySet('rationale.correct', 'Digastric is not an elevator of the mandible. Instead, it helps depress the mandible and elevate the hyoid bone, whereas temporalis, masseter, and medial pterygoid are all muscles of mandibular elevation.'),
  ]],
  [4168, [
    applySet('rationale.correct', 'Glycogen synthase C is not a recognized enzyme in glycogen metabolism. Glycogen metabolism involves glycogen phosphorylase and the two interconvertible forms of glycogen synthase, classically referred to as glycogen synthase I and glycogen synthase D.'),
  ]],
  [8541, [
    applySet('rationale.correct', 'Protein Efficiency Ratio (PER) is defined as gain in body weight divided by the amount of protein consumed. It is used to assess how effectively a dietary protein supports growth.'),
  ]],
  [12313, [
    applySet('title', 'A pelvic radiograph shows appearance of the iliac crest and ischial tuberosity ossification centers, fusion of the femoral head and both trochanters with the shaft, and no fusion yet of the iliac crest center. What is the minimum age represented?'),
    applySet('prompt', 'A pelvic radiograph shows appearance of the iliac crest and ischial tuberosity ossification centers, fusion of the femoral head and both trochanters with the shaft, and no fusion yet of the iliac crest center. What is the minimum age represented?'),
    applySet('question', 'A pelvic radiograph shows appearance of the iliac crest and ischial tuberosity ossification centers, fusion of the femoral head and both trochanters with the shaft, and no fusion yet of the iliac crest center. What is the minimum age represented?'),
    applySet('vignette.narrative', 'A pelvic radiograph shows appearance of the iliac crest and ischial tuberosity ossification centers, fusion of the femoral head and both trochanters with the shaft, and no fusion yet of the iliac crest center. What is the minimum age represented?'),
    applySet('rationale.correct', 'The minimum age is 18 years. In this skeletal maturity pattern, the iliac crest and ischial tuberosity ossification centers have appeared, the femoral head and both trochanters have fused with the shaft, and the iliac crest center has not yet fused. This combination is consistent with approximately 18 years of age.'),
  ]],
  [18281, [
    applySet('vignette.narrative', 'A 32-year-old woman presents with a sudden thunderclap headache, nausea, vomiting, neck stiffness, and mild papilledema. Her blood pressure is 165/95 mm Hg. A noncontrast CT scan of the head shows acute subarachnoid hemorrhage. Which of the following is the next best step in management of this patient?'),
    applySet('rationale.correct', 'Labetalol is the best next step among the listed options because blood pressure should be controlled in acute subarachnoid hemorrhage to reduce the risk of rebleeding while definitive aneurysm management is arranged. Lumbar puncture is unnecessary after a positive CT scan, dexamethasone is not indicated, and mannitol is reserved for severe intracranial hypertension or impending herniation.'),
  ]],
  [25365, [
    applySet('vignette.narrative', 'A 69-year-old woman presents with cough, fatigue, weight loss, and occasional blood-tinged sputum. She does not smoke. Chest x-ray shows a peripheral coin-shaped lesion in the right middle lobe, and biopsy confirms a peripheral lung malignancy. Which type of cancer is most likely associated with this presentation?'),
  ]],
  [29753, [
    applySet('rationale.correct', 'Pellagra is caused by niacin (vitamin B3) deficiency. The classic features are dermatitis, diarrhea, and dementia. Vitamin C deficiency causes scurvy, vitamin D deficiency causes rickets or osteomalacia, and biotin deficiency typically causes dermatitis and alopecia rather than pellagra.'),
  ]],
  [27737, [
    applyCorrectOption('D'),
    applySet('rationale.correct', 'Aberrant origin of the left coronary artery from the pulmonary artery is the best diagnosis. Infants typically present after the fall in pulmonary vascular resistance with myocardial ischemia, cardiomegaly, tachycardia, gallop rhythm, ventricular dilatation, and low-voltage complexes on ECG. Congestive heart failure is a consequence of this lesion, not the specific diagnosis asked by the stem.'),
  ]],
  [33722, [
    applySet('rationale.correct', 'Pyridoxal phosphate, the active form of vitamin B6, is required for conversion of tryptophan to niacin. Deficiency can therefore cause a pellagra-like dermatitis and may also produce convulsions, sideroblastic anemia, parkinsonian features, and kidney stones from increased oxalate production.'),
  ]],
  [31646, [
    applySet('rationale.correct', 'Nitrous oxide is the most potent analgesic agent among these choices. It has significant analgesic properties, whereas nitric oxide, carbon dioxide, and oxygen are not used as primary analgesics.'),
  ]],
  [32769, [
    applySet('rationale.correct', 'Buboes are characteristic of the second stage of lymphogranuloma venereum. After the initial small genital lesion, infection spreads to regional lymph nodes, producing painful inguinal lymphadenopathy that may suppurate.'),
  ]],
  [34916, [
    applySet('rationale.correct', 'Isotopes are atoms of the same element that have the same atomic number but different mass numbers because they contain different numbers of neutrons.'),
  ]],
  [35260, [
    applySet('rationale.correct', 'Erythrocyte transketolase activity depends on thiamine pyrophosphate, the active form of vitamin B1. Reduced transketolase activity is therefore a marker of thiamine deficiency.'),
  ]],
  [38773, [
    applySet('rationale.correct', 'Nesiritide does not decrease angiotensin II activity. It is a recombinant B-type natriuretic peptide that promotes natriuresis and vasodilation, whereas enalapril, valsartan, and omapatrilat reduce the effects of angiotensin II through the renin-angiotensin system.'),
  ]],
  [42161, [
    applySet('rationale.correct', 'Biceps femoris is the only listed muscle with dual innervation from the sciatic nerve: the long head is supplied by the tibial division and the short head by the common peroneal division. The other options are supplied primarily by the obturator or femoral nerves.'),
  ]],
  [42467, [
    applySet('rationale.correct', 'Mannitol is the most effective diuretic in acute congestive, or angle-closure, glaucoma. As an osmotic diuretic it rapidly lowers intraocular pressure while definitive treatment such as laser or surgical iridotomy is arranged.'),
  ]],
  [43412, [
    applySet('rationale.correct', 'Neurofibrosarcoma, or malignant peripheral nerve sheath tumor, usually spreads hematogenously rather than through lymphatics. By contrast, synovial sarcoma, rhabdomyosarcoma, and epithelioid sarcoma are more likely to involve lymphatic spread.'),
  ]],
  [44707, [
    applySet('rationale.correct', 'This presentation is classic for pneumothorax: sudden dyspnea in a tall young man with absent bronchovascular markings and collapse of the affected lung toward the hilum on chest radiography. A hydropneumothorax would show an air-fluid level, and massive pleural effusion would cause an opaque hemithorax rather than hyperlucency.'),
  ]],
  [48443, [
    applySet('title', 'A pelvic radiograph shows bilateral sacroiliitis consistent with ankylosing spondylitis. Which of the following treatments would NOT be useful?'),
    applySet('prompt', 'A pelvic radiograph shows bilateral sacroiliitis consistent with ankylosing spondylitis. Which of the following treatments would NOT be useful?'),
    applySet('vignette.narrative', 'A pelvic radiograph shows bilateral sacroiliitis consistent with ankylosing spondylitis. Which of the following treatments would NOT be useful?'),
    applySet('rationale.correct', 'Systemic corticosteroids are generally not useful for chronic axial ankylosing spondylitis. NSAIDs such as indomethacin and etoricoxib are standard symptomatic therapy, physiotherapy helps preserve mobility, and TNF inhibitors such as adalimumab are effective for refractory disease.'),
  ]],
  [49487, [
    applySet('title', 'An ECG shows diffuse concave ST-segment elevation consistent with acute pericarditis. Which of the following is the treatment of choice?'),
    applySet('prompt', 'An ECG shows diffuse concave ST-segment elevation consistent with acute pericarditis. Which of the following is the treatment of choice?'),
    applySet('vignette.narrative', 'An ECG shows diffuse concave ST-segment elevation consistent with acute pericarditis. Which of the following is the treatment of choice?'),
    applySet('rationale.correct', 'Prolonged treatment with anti-inflammatory drugs is first-line therapy for acute pericarditis. Urgent catheterization, primary angioplasty, and fibrinolysis are used for acute coronary syndromes, whereas low-dose prednisone is not preferred as initial therapy unless standard treatment cannot be used.'),
  ]],
  [49505, [
    applySet('title', 'A patient has an inoculation eschar on the lower leg with a surrounding exanthem, suggesting a tick-borne rickettsial infection. Which treatment is most appropriate?'),
    applySet('prompt', 'A patient has an inoculation eschar on the lower leg with a surrounding exanthem, suggesting a tick-borne rickettsial infection. Which treatment is most appropriate?'),
    applySet('vignette.narrative', 'A patient has an inoculation eschar on the lower leg with a surrounding exanthem, suggesting a tick-borne rickettsial infection. Which treatment is most appropriate?'),
    applySet('rationale.correct', 'Doxycycline is the treatment of choice for rickettsial infections presenting with an inoculation eschar and rash. Ceftriaxone and amoxicillin-clavulanate are not first-line therapy, paracetamol only treats symptoms, and chloramphenicol is generally reserved for special situations.'),
  ]],
]);

function mutateCase(caseRecord, report) {
  const fixers = FIXERS.get(caseRecord?._id);
  if (!fixers) {
    return false;
  }

  let changed = false;
  for (const fixer of fixers) {
    changed = fixer(caseRecord, report) || changed;
  }
  return changed;
}

function main() {
  const publicCases = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const publicMap = new Map(publicCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const repository = createCasebankRepository();
  const dbCases = repository.getAllCases();
  const dbMap = new Map(dbCases.map((caseRecord) => [String(caseRecord._id), caseRecord]));

  const modifiedDbCases = [];
  const report = {
    generated_at: new Date().toISOString(),
    modified_cases: [],
    unchanged_cases: [],
  };

  try {
    for (const caseId of FIXERS.keys()) {
      const publicCase = publicMap.get(String(caseId));
      const dbCase = dbMap.get(String(caseId));
      const caseReport = {
        _id: caseId,
        case_code: publicCase?.case_code || dbCase?.case_code || '',
        changes: [],
      };

      let changed = false;
      if (publicCase) {
        changed = mutateCase(publicCase, caseReport.changes) || changed;
      }
      if (dbCase) {
        const dbChanges = [];
        const dbChanged = mutateCase(dbCase, dbChanges);
        if (dbChanged) {
          changed = true;
          modifiedDbCases.push(dbCase);
        }
      }

      if (changed) {
        report.modified_cases.push(caseReport);
      } else {
        report.unchanged_cases.push(caseId);
      }
    }

    if (modifiedDbCases.length > 0) {
      repository.updateCaseSnapshots(modifiedDbCases);
    }
    writeJsonAtomically(DATA_FILE, publicCases, true);
    writeJsonAtomically(REPORT_FILE, report, true);

    console.log('Source text micro tranche applied');
    console.log(`  Modified cases: ${report.modified_cases.length}`);
    console.log(`  Report:         ${REPORT_FILE}`);
  } finally {
    repository.close();
  }
}

main();
