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
  caseData.meta.ai_conflict_resolution_lane = 'mechanical_phase6_manual';
  caseData.meta.ai_conflict_resolved_at = new Date().toISOString();
  caseData.meta.ai_conflict_resolution_basis = resolution;
  caseData.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE6_MANUAL_MECHANICAL';
}

const TARGET_IDS = new Set([7628, 13965, 14189, 30757, 39273, 40713, 43005, 43226]);

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
    case 7628: {
      item.title = 'Classical cause of pulsatile exophthalmos';
      item.prompt = 'The classical cause of pulsatile exophthalmos is:';
      setNarrative(item, item.prompt);
      item.rationale = {
        correct:
          'Carotid-cavernous fistula is the classic cause of pulsatile exophthalmos because arterialized flow into the cavernous sinus causes proptosis, bruit, and venous congestion.',
        distractors: {},
        pearl: 'Orbital vascular malformations can also cause pulsatile proptosis, but carotid-cavernous fistula is the classical exam answer.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'Prompt narrowed to classical single-best-answer form; key changed to carotid-cavernous fistula.');
      break;
    }
    case 13965: {
      item.title = 'Meaning of poikilokaryosis';
      item.prompt = 'The term poikilokaryosis refers to:';
      setNarrative(item, item.prompt);
      updateOptionText(item, 'B', 'Variation in nuclear size and shape');
      item.rationale = {
        correct:
          'Poikilokaryosis refers to variation in nuclear size and shape, a form of nuclear pleomorphism seen in dysplasia and malignancy.',
        distractors: {},
        pearl: 'Do not confuse poikilokaryosis with altered nuclear-cytoplasmic ratio or abnormal mitosis.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'Option text repaired to match the intended pathology definition.');
      break;
    }
    case 14189: {
      item.title = 'Common adverse effect of chlorhexidine mouth rinse';
      item.prompt = 'A common adverse effect of chlorhexidine mouth rinsing is:';
      setNarrative(item, item.prompt);
      item.rationale = {
        correct:
          'Chlorhexidine mouth rinses commonly cause taste disturbance and can also stain teeth with prolonged use.',
        distractors: {},
        pearl: 'Chlorhexidine is broad-spectrum and is not restricted to gram-negative organisms.',
      };
      setSingleCorrect(item, 'C');
      markResolved(item, 'Prompt rewritten from ambiguous multi-true format to single-best adverse-effect question.');
      break;
    }
    case 30757: {
      item.title = 'Feature not characteristic of generalized anxiety disorder';
      item.prompt = 'Which of the following is NOT characteristic of generalized anxiety disorder?';
      setNarrative(item, item.prompt);
      item.rationale = {
        correct:
          'Generalized anxiety disorder is characterized by free-floating anxiety, excessive worry, and inability to relax. Anxiety restricted to specific situations suggests phobic or situational anxiety rather than GAD.',
        distractors: {},
        pearl: 'The core idea in GAD is pervasive, non-situation-specific anxiety.',
      };
      setSingleCorrect(item, 'D');
      markResolved(item, 'Prompt polarity repaired so the existing single key becomes clinically coherent.');
      break;
    }
    case 39273: {
      item.title = 'Core manifestations of conduct disorder';
      item.prompt = 'Core manifestations of conduct disorder in a child include:';
      setNarrative(item, item.prompt);
      updateOptionText(item, 'D', 'A and B only');
      item.rationale = {
        correct:
          'Conduct disorder is characterized by persistent violation of the rights of others and disregard for authority or rules. Poor academic performance alone is not a defining feature.',
        distractors: {},
        pearl: 'The diagnosis rests on repetitive behavioral violations, not merely school underperformance.',
      };
      setSingleCorrect(item, 'D');
      markResolved(item, 'Composite option rewritten to preserve the intended single-best-answer structure.');
      break;
    }
    case 40713: {
      item.title = 'Components of an acellular pertussis vaccine';
      item.prompt = 'An acellular pertussis vaccine contains which of the following combinations?';
      setNarrative(item, item.prompt);
      updateOptionText(item, 'D', 'Pertussis toxoid, filamentous hemagglutinin, pertactin, and fimbriae');
      item.rationale = {
        correct:
          'Acellular pertussis vaccines contain purified pertussis antigens such as pertussis toxoid, filamentous hemagglutinin, pertactin, and fimbrial proteins.',
        distractors: {},
        pearl: 'Tracheal cytotoxin and endotoxin are not included in acellular pertussis vaccines.',
      };
      setSingleCorrect(item, 'D');
      markResolved(item, 'OCR-corrupted option repaired to the intended acellular pertussis antigen set.');
      break;
    }
    case 43005: {
      item.title = 'Lacunar skull and Arnold-Chiari malformation';
      item.prompt = 'Lacunar skull is a radiological feature classically associated with:';
      setNarrative(item, item.prompt);
      updateOptionText(item, 'D', 'Arnold-Chiari malformation');
      item.rationale = {
        correct:
          'Lacunar skull (luckenschadel) is classically associated with neural tube defects and Chiari malformations, especially the Chiari II spectrum.',
        distractors: {},
        pearl: 'Luckenschadel is a congenital calvarial finding rather than a feature of Paget disease or eosinophilic granuloma.',
      };
      setSingleCorrect(item, 'D');
      markResolved(item, 'Stem and rationale aligned with standard lacunar skull association; baseline key retained.');
      break;
    }
    case 43226: {
      item.title = 'Glasgow Coma Scale range in mild head injury';
      item.prompt = 'Mild head injury corresponds to which Glasgow Coma Scale range?';
      setNarrative(item, item.prompt);
      updateOptionText(item, 'D', 'D.13-15');
      item.rationale = {
        correct:
          'Mild traumatic brain injury is defined by a Glasgow Coma Scale score of 13 to 15.',
        distractors: {},
        pearl: 'Moderate head injury is typically GCS 9-12, and severe injury is 8 or less.',
      };
      setSingleCorrect(item, 'D');
      markResolved(item, 'Option text repaired to the standard GCS range for mild head injury.');
      break;
    }
    default:
      break;
  }

  const currentCorrect = (item.options || []).find((option) => option?.is_correct === true);
  resolved.push({
    case_id: item._id,
    case_code: item.case_code,
    title: item.title,
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

writeFileSync(join(outputDir, 'ai_conflict_resolved_mechanical_phase6_manual.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ resolved_count: resolved.length }, null, 2));

repo.close();
