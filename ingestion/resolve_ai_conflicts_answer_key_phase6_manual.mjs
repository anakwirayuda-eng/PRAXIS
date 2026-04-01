import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
mkdirSync(outputDir, { recursive: true });

function setSingleCorrect(caseData, optionId) {
  caseData.options = (caseData.options || []).map((option) => ({
    ...option,
    is_correct: String(option.id) === String(optionId),
  }));
}

function updateOptionText(caseData, optionId, newText) {
  caseData.options = (caseData.options || []).map((option) => (
    String(option.id) === String(optionId)
      ? { ...option, text: newText }
      : option
  ));
}

function setNarrative(caseData, text) {
  caseData.vignette = {
    ...(caseData.vignette || {}),
    narrative: text,
  };
}

function markResolved(caseData, resolution) {
  caseData.meta = caseData.meta || {};
  delete caseData.meta.status;
  caseData.meta.ai_conflict_resolved = true;
  caseData.meta.ai_conflict_resolution_lane = 'answer_key_phase6_manual';
  caseData.meta.ai_conflict_resolved_at = new Date().toISOString();
  caseData.meta.ai_conflict_resolution_basis = resolution;
  caseData.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE6_MANUAL_KEYFIX';
}

const TARGET_IDS = new Set([
  14201, 28578, 29716, 29939, 30850, 31657, 32270, 32490, 32786, 33256,
  33861, 35217, 37265, 38307, 38975, 42992, 44376, 44406, 45651, 46271,
]);

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();
const targets = allCases.filter((item) => {
  const meta = item.meta || {};
  return TARGET_IDS.has(item._id)
    && meta.source === 'medmcqa'
    && meta.status === 'QUARANTINED_AI_CONFLICT';
});

const resolved = [];

for (const item of targets) {
  switch (item._id) {
    case 14201: {
      updateOptionText(item, 'D', 'A and D are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'A lingual plate is indicated when future addition of anterior teeth may be needed and when the lingual sulcus is too shallow or narrow for a lingual bar.',
        distractors: {},
        pearl: 'Composite-option style is common in older dental MCQs; this item is normalized into an explicit single-best-answer format.',
      };
      markResolved(item, 'Composite answer restored for lingual plate indications.');
      break;
    }
    case 28578: {
      updateOptionText(item, 'D', 'Two weeks before and one week after symptom onset');
      item.rationale = {
        correct:
          'Hepatitis A virus is shed in stool maximally during the late incubation period, beginning about two weeks before symptom onset and usually continuing for about one week after symptoms begin.',
        distractors: {},
        pearl: 'Fecal shedding falls rapidly after jaundice appears.',
      };
      markResolved(item, 'Option text corrected to the intended hepatitis A shedding window.');
      break;
    }
    case 29716: {
      updateOptionText(item, 'D', 'A and B are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Pregnancy requires roughly 300 additional kcal per day and increased iron intake, so both A and B are correct.',
        distractors: {},
        pearl: 'Old multiple-true MCQs are made cleaner by collapsing the intended combination into one option.',
      };
      markResolved(item, 'Composite answer restored for pregnancy dietary allowance item.');
      break;
    }
    case 29939: {
      item.prompt = 'The glucose-alanine cycle is important between:';
      setNarrative(item, item.prompt);
      updateOptionText(item, 'D', 'Liver and muscle');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'The glucose-alanine cycle operates primarily between muscle, which exports alanine, and liver, which converts alanine back to glucose.',
        distractors: {},
        pearl: 'This cycle helps shuttle nitrogen and carbon skeletons from muscle to liver.',
      };
      markResolved(item, 'Prompt and composite option rewritten for glucose-alanine cycle pair.');
      break;
    }
    case 30850: {
      updateOptionText(item, 'D', 'B and C are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Phenylketonuria and cretinism are classic preventable causes of intellectual disability through screening and early treatment.',
        distractors: {},
        pearl: 'Down syndrome and cerebral palsy are not typically classified as preventable in the same way.',
      };
      markResolved(item, 'Composite answer restored for preventable intellectual disability causes.');
      break;
    }
    case 31657: {
      updateOptionText(item, 'D', 'A, B and C are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Graft-versus-host disease classically affects skin, gastrointestinal tract, and liver.',
        distractors: {},
        pearl: 'Pulmonary involvement can occur in chronic complications but is not part of the classic core triad.',
      };
      markResolved(item, 'Composite answer restored for graft-versus-host disease target organs.');
      break;
    }
    case 32270: {
      updateOptionText(item, 'A', 'T10-L1');
      item.rationale = {
        correct:
          'Pain of the first stage of labor is visceral and is transmitted through sympathetic fibers entering the spinal cord at T10-L1.',
        distractors: {},
        pearl: 'Perineal pain later in labor is carried via pudendal pathways from S2-S4.',
      };
      markResolved(item, 'OCR-corrupted labor pain segment corrected to T10-L1.');
      break;
    }
    case 32490: {
      updateOptionText(item, 'D', 'A, B and C are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Excessive UV exposure increases the risk of basal cell carcinoma, squamous cell carcinoma, and melanoma.',
        distractors: {},
        pearl: 'Leukemia is not a classic direct consequence of sunlight exposure.',
      };
      markResolved(item, 'Composite ultraviolet carcinogenesis answer restored.');
      break;
    }
    case 32786: {
      updateOptionText(item, 'D', 'Alveolar duct and alveolar sac');
      item.rationale = {
        correct:
          'Bronchial arteries do not normally supply the alveolar ducts or alveolar sacs; gas-exchanging regions are supplied by the pulmonary circulation.',
        distractors: {},
        pearl: 'Bronchial arteries mainly nourish the conducting airways and supporting structures.',
      };
      markResolved(item, 'Composite exception option restored for bronchial artery supply.');
      break;
    }
    case 33256: {
      updateOptionText(item, 'D', 'None of the above');
      item.rationale = {
        correct:
          'Intersectoral coordination, community participation, appropriate technology, and decentralization are all consistent with primary health care principles; therefore none of the options is an exception.',
        distractors: {},
        pearl: 'When all listed principles are valid, the only safe single-best-answer form is “none of the above.”',
      };
      markResolved(item, 'Option normalized to explicit none-of-the-above.');
      break;
    }
    case 33861: {
      updateOptionText(item, 'D', 'A and B are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Surgery for a deviated nasal septum is indicated for symptomatic obstruction or septal spur with recurrent epistaxis, not for simple persistent rhinorrhea.',
        distractors: {},
        pearl: 'Composite-option repair preserves the educational intent of the item.',
      };
      markResolved(item, 'Composite surgical-indication answer restored for deviated septum.');
      break;
    }
    case 35217: {
      updateOptionText(item, 'D', 'C and D are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Cottle’s test is used when nasal valve narrowing may be due to a deviated septum or hypertrophied inferior turbinate.',
        distractors: {},
        pearl: 'It is not primarily a test for rhinosporidiosis or atrophic rhinitis.',
      };
      markResolved(item, 'Composite option restored for Cottle test indications.');
      break;
    }
    case 37265: {
      updateOptionText(item, 'D', 'B and D are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Nosocomial infection is generally defined as infection appearing after 48 hours of admission or within 30 days after discharge (or longer with implants).',
        distractors: {},
        pearl: 'A 40-day post-discharge infection exceeds the usual standard hospital-acquired timeframe for this style of question.',
      };
      markResolved(item, 'Composite answer restored for nosocomial infection definition.');
      break;
    }
    case 38307: {
      updateOptionText(item, 'D', 'A and D are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Black pleural effusion has been described with anaerobic empyema and Aspergillus infection.',
        distractors: {},
        pearl: 'Pseudochylothorax and amebic liver abscess do not classically produce black pleural fluid.',
      };
      markResolved(item, 'Composite answer restored for black pleural effusion causes.');
      break;
    }
    case 38975: {
      updateOptionText(item, 'D', 'A, C and D are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Radial nerve injury can affect sensation over the anatomical snuffbox, ulnar palsy can produce clawing, and median nerve injury can impair sensation in the index finger; wrist drop is not caused by median nerve injury.',
        distractors: {},
        pearl: 'Composite repair makes the old multiple-true anatomy item answerable again.',
      };
      markResolved(item, 'Composite answer restored for upper-limb nerve injury item.');
      break;
    }
    case 42992: {
      updateOptionText(item, 'D', 'A and B are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Lassa fever virus and yellow fever virus are both causes of viral hemorrhagic fever, whereas West Nile virus is not usually grouped here in classic exam keys.',
        distractors: {},
        pearl: 'Older microbiology MCQs often expect a classic list rather than modern broader syndromic framing.',
      };
      markResolved(item, 'Composite answer restored for viral hemorrhagic fever item.');
      break;
    }
    case 44376: {
      updateOptionText(item, 'D', 'A, C and D are correct');
      setSingleCorrect(item, 'D');
      item.rationale = {
        correct:
          'Phase I trials primarily evaluate safety, tolerability, dose range, and pharmacokinetics rather than definitive efficacy.',
        distractors: {},
        pearl: 'Efficacy becomes a more central question in Phase II and III trials.',
      };
      markResolved(item, 'Composite answer restored for phase I trial aims.');
      break;
    }
    case 44406: {
      updateOptionText(item, 'D', 'Goodpasture syndrome and Wegener granulomatosis');
      item.rationale = {
        correct:
          'Classic pulmonary-renal syndromes include anti-GBM disease (Goodpasture syndrome) and ANCA-associated vasculitis such as Wegener granulomatosis.',
        distractors: {},
        pearl: 'A clean single-best-answer option is preferable to leaving an overbroad “All” that includes false combinations.',
      };
      markResolved(item, 'Correct pulmonary-renal syndrome pair restored as the explicit option text.');
      break;
    }
    case 45651: {
      item.prompt = 'Which of the following is least specific for blast injury?';
      setNarrative(item, item.prompt);
      item.rationale = {
        correct:
          'Fracture can occur in many trauma mechanisms and is less specific than puncture lacerations caused by flying blast fragments.',
        distractors: {},
        pearl: 'Secondary blast injury produces penetrating and puncture-type wounds from projectiles.',
      };
      markResolved(item, 'Prompt clarified to match the retained single-best answer.');
      break;
    }
    case 46271: {
      item.rationale = {
        correct:
          'Feeding with a spoon is normally acquired well before age 3 years, so its absence at 3 years indicates developmental delay more clearly than the other listed milestones.',
        distractors: {},
        pearl: 'Drawing a square is usually expected later than age 3, so its absence at that age is not the best marker of delay.',
      };
      markResolved(item, 'Current key confirmed with clarified developmental milestone rationale.');
      break;
    }
    default:
      break;
  }

  const currentCorrect = (item.options || []).find((option) => option?.is_correct === true);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    prompt: item.prompt,
    current_correct_id: currentCorrect?.id ?? null,
    current_correct_text: currentCorrect?.text ?? null,
    resolution: item.meta?.ai_conflict_resolution_basis ?? null,
  });
}

if (targets.length > 0) {
  repo.updateCaseSnapshots(targets);
}

const report = {
  generated_at: new Date().toISOString(),
  resolved_count: resolved.length,
  resolved,
};

writeFileSync(join(outputDir, 'ai_conflict_resolved_answer_key_phase6_manual.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ resolved_count: resolved.length }, null, 2));

repo.close();
