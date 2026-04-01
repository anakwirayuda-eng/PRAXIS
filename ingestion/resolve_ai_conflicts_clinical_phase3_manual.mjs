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
  caseData.meta.ai_conflict_resolution_lane = 'clinical_phase3_manual';
  caseData.meta.ai_conflict_resolved_at = new Date().toISOString();
  caseData.meta.ai_conflict_resolution_basis = resolution;
  caseData.meta.clinical_consensus = 'AI_CONFLICT_RESOLVED_PHASE3_MANUAL_CLINICAL';
}

const TARGET_IDS = new Set([28575, 32421, 33788, 37271, 37453, 41509, 45461]);

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
    case 28575: {
      item.title = 'Metabolic alkalosis due to vomiting';
      item.prompt = 'Which disease process best accounts for a metabolic alkalosis caused by loss of gastric acid?';
      setNarrative(item, item.prompt);
      item.rationale = {
        correct:
          'Vomiting causes loss of hydrochloric acid from the stomach, producing hypochloremic metabolic alkalosis and often associated volume depletion.',
        distractors: {},
        pearl: 'Ethylene glycol poisoning typically causes high-anion-gap metabolic acidosis, not metabolic alkalosis.',
      };
      setSingleCorrect(item, 'D');
      markResolved(item, 'Contextless item rewritten into explicit metabolic alkalosis/vomiting question; baseline key retained.');
      break;
    }
    case 32421: {
      item.rationale = {
        correct:
          'During surgery for a ranula, the lingual nerve is particularly at risk because it lies in close proximity to the sublingual gland and floor of mouth dissection plane.',
        distractors: {},
        pearl: 'The submandibular duct is also nearby, but the lingual nerve is the more classically cited structure at risk in ranula surgery.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'Clinical key corrected to lingual nerve based on floor-of-mouth surgical anatomy.');
      break;
    }
    case 33788: {
      item.title = 'Calculate therapeutic index from ED50 and TD50';
      item.prompt = 'A drug has an ED50 of 16 and a TD50 of 128. What is its therapeutic index?';
      setNarrative(item, item.prompt);
      item.rationale = {
        correct:
          'Therapeutic index = TD50 / ED50 = 128 / 16 = 8.',
        distractors: {},
        pearl: 'Use the ratio of toxic dose for 50% to effective dose for 50%, not the reverse.',
      };
      setSingleCorrect(item, 'C');
      markResolved(item, 'Graph-dependent pharmacology item rewritten into explicit ED50/TD50 calculation; key corrected to 8.');
      break;
    }
    case 37271: {
      item.prompt = 'Secondary glaucoma following corneal perforation is most likely due to:';
      setNarrative(item, item.prompt);
      item.rationale = {
        correct:
          'After corneal perforation, the iris may prolapse and adhere to the corneal wound, producing central anterior synechiae that can obstruct aqueous flow and lead to secondary glaucoma.',
        distractors: {},
        pearl: 'Peripheral anterior synechiae is a common angle-closure mechanism in other settings, but this stem specifically points to corneal perforation and wound-related central adhesions.',
      };
      setSingleCorrect(item, 'A');
      markResolved(item, 'Ophthalmology key corrected to central anterior synechiae for post-perforation secondary glaucoma.');
      break;
    }
    case 37453: {
      item.rationale = {
        correct:
          'Worldwide, the most common cause of rectovaginal fistula is obstetric trauma with pressure necrosis during prolonged obstructed labour.',
        distractors: {},
        pearl: 'Improper repair of a perineal tear can cause a fistula, but it is not the commonest global cause.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'Key corrected to pressure necrosis during labour for commonest rectovaginal fistula cause.');
      break;
    }
    case 41509: {
      item.rationale = {
        correct:
          'Among the listed antiretrovirals, didanosine is classically associated with severe mitochondrial toxicity leading to hepatic steatosis, steatohepatitis, and lactic acidosis.',
        distractors: {},
        pearl: 'Older nucleoside analogues such as didanosine and stavudine are the classic drugs linked to mitochondrial hepatotoxicity.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'Manual HIV hepatotoxicity adjudication favored didanosine over broad all-of-the-above choice.');
      break;
    }
    case 45461: {
      item.title = 'Sequence of vascular permeability changes in inflammation';
      item.prompt = 'Arrange the vascular permeability changes of acute inflammation in the correct order: b) immediate transient, c) immediate prolonged, d) somewhat delayed prolonged, a) delayed prolonged leukocyte-mediated injury.';
      setNarrative(item, item.prompt);
      updateOptionText(item, 'D', 'BCDA');
      item.rationale = {
        correct:
          'The usual order is immediate transient (histamine-mediated), immediate prolonged (direct endothelial injury), somewhat delayed prolonged (mild endothelial damage such as UV injury), and finally delayed prolonged leukocyte-mediated injury: BCDA.',
        distractors: {},
        pearl: 'When none of the original option strings matches the canonical sequence, the safest rescue is to repair the option text rather than preserve a wrong key.',
      };
      setSingleCorrect(item, 'D');
      markResolved(item, 'Inflammation sequence item repaired by replacing the malformed option text with the correct BCDA order.');
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

writeFileSync(join(outputDir, 'ai_conflict_resolved_clinical_phase3_manual.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ resolved_count: resolved.length }, null, 2));

repo.close();
