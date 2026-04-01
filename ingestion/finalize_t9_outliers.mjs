import { createCasebankRepository } from '../server/casebank-repository.js';
import { openCasebankDb } from '../server/casebank-db.js';

const db = openCasebankDb();
const repo = createCasebankRepository(db);
const allCases = repo.getAllCases();

const TARGET_IDS = new Set([36637, 41076, 44959, 45263, 45468, 45838, 46110, 46686]);
const targets = allCases.filter((item) => TARGET_IDS.has(item._id));

function markResolved(caseData, resolution) {
  caseData.meta = caseData.meta || {};
  delete caseData.meta.status;
  caseData.meta._openclaw_t9_v2 = true;
  caseData.meta.clinical_consensus = 'AI_AGREES_WITH_BASELINE';
  caseData.meta.manual_t9_outlier_fix = true;
  caseData.meta.manual_t9_outlier_resolution = resolution;
  caseData.meta.manual_t9_outlier_fixed_at = new Date().toISOString();
}

function setSingleCorrect(caseData, optionId) {
  caseData.options = (caseData.options || []).map((option) => ({
    ...option,
    is_correct: String(option.id) === String(optionId),
  }));
}

for (const item of targets) {
  switch (item._id) {
    case 36637: {
      item.title = 'Volume of distribution of a drug';
      item.prompt =
        'A patient is given 4.0 g of drug X and its plasma concentration is 50 mg/L. What is the volume of distribution of drug X?';
      item.vignette = {
        ...(item.vignette || {}),
        narrative:
          'A patient is given 4.0 g of drug X and its plasma concentration is 50 mg/L. What is the volume of distribution of drug X?',
      };
      item.rationale = {
        correct:
          'Volume of distribution = dose / plasma concentration = 4000 mg / 50 mg/L = 80 L. Therefore the correct answer is 80 L.',
        distractors: {},
        pearl: 'Keep units consistent before calculating volume of distribution.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'Unit typo fixed from mg/ml to mg/L; baseline key retained.');
      break;
    }
    case 41076: {
      item.title = 'Pleural reflection at the left midaxillary line';
      item.prompt = 'The pleural reflection at the left midaxillary line lies at which intercostal space?';
      item.vignette = {
        ...(item.vignette || {}),
        narrative: 'The pleural reflection at the left midaxillary line lies at which intercostal space?',
      };
      item.rationale = {
        correct:
          'At the midaxillary line, the parietal pleura extends to the 10th rib/intercostal space, which is about two ribs below the inferior border of the lung.',
        distractors: {},
        pearl: 'A common anatomy rule of thumb is 6-8-10 for the lower lung border and 8-10-12 for pleural reflection across key lines.',
      };
      setSingleCorrect(item, 'D');
      markResolved(item, 'Format-only failure normalized; stem and rationale cleaned.');
      break;
    }
    case 44959: {
      item.title = 'Approximate number of infants registered at a sub-centre';
      item.prompt =
        'A health sub-centre covers a population of 5000. Approximately how many infants should be registered with the health worker there?';
      item.vignette = {
        ...(item.vignette || {}),
        narrative:
          'A health sub-centre covers a population of 5000. Approximately how many infants should be registered with the health worker there?',
      };
      item.rationale = {
        correct:
          'For a sub-centre population of about 5000, the expected number of live births is roughly 100 per year, so the number of infants to be registered is approximately 100.',
        distractors: {},
        pearl: 'In community medicine questions, “approximately” often expects the nearest operational value rather than an exact census.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'Stem rewritten to operational sub-centre estimate; answer standardized to 100.');
      break;
    }
    case 45263: {
      item.title = 'Ceftriaxone dose in syringe divisions';
      item.prompt =
        'A patient requires 180 mg ceftriaxone. The vial contains 500 mg in 5 mL. You are using a 2 mL syringe marked with 10 divisions per mL. How many divisions should be filled?';
      item.vignette = {
        ...(item.vignette || {}),
        narrative:
          'A patient requires 180 mg ceftriaxone. The vial contains 500 mg in 5 mL. You are using a 2 mL syringe marked with 10 divisions per mL. How many divisions should be filled?',
      };
      item.rationale = {
        correct:
          '500 mg in 5 mL means 100 mg/mL. A dose of 180 mg therefore requires 1.8 mL. With 10 divisions per mL, 1.8 mL corresponds to 18 divisions.',
        distractors: {},
        pearl: 'Convert the dose to milliliters first, then convert milliliters to syringe divisions.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'OCR/noise cleaned; answer preserved as 18 divisions.');
      break;
    }
    case 45468: {
      item.title = 'Glasgow Coma Scale in an intubated patient';
      item.prompt =
        'An intubated patient opens his eyes to verbal command and moves all four limbs spontaneously. If the verbal component is documented as 1 because of intubation, what is the total GCS score?';
      item.vignette = {
        ...(item.vignette || {}),
        narrative:
          'An intubated patient opens his eyes to verbal command and moves all four limbs spontaneously. If the verbal component is documented as 1 because of intubation, what is the total GCS score?',
      };
      item.rationale = {
        correct:
          'Eye opening to verbal command scores 3, motor response of spontaneous purposeful movement/obeying command scores 6, and the verbal component in an intubated patient is documented as 1. Total GCS = 3 + 1 + 6 = 10.',
        distractors: {},
        pearl: 'If a summed score is required in an intubated patient, the traditional notation is 10T.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'Stem rewritten to explicit traditional summed GCS convention; key changed to 10.');
      break;
    }
    case 45838: {
      item.title = 'IPC section for illegal abortion with woman consent';
      item.prompt = "Which IPC section deals with illegal abortion performed with the woman's consent?";
      item.vignette = {
        ...(item.vignette || {}),
        narrative: "Which IPC section deals with illegal abortion performed with the woman's consent?",
      };
      item.rationale = {
        correct:
          'IPC Section 312 deals with causing miscarriage with the woman’s consent, except where done in good faith to save her life.',
        distractors: {},
        pearl: 'Section 313 concerns miscarriage without the woman’s consent.',
      };
      setSingleCorrect(item, 'B');
      markResolved(item, 'Typo cleanup only; legal answer remains IPC 312.');
      break;
    }
    case 46110: {
      item.title = 'Capillary oncotic pressure from Starling forces';
      item.prompt =
        'Capillary hydrostatic pressure is 25 mm Hg, interstitial hydrostatic pressure is 2 mm Hg, and interstitial oncotic pressure is 7 mm Hg. What capillary oncotic pressure would produce a net filtration pressure of 3 mm Hg?';
      item.vignette = {
        ...(item.vignette || {}),
        narrative:
          'Capillary hydrostatic pressure is 25 mm Hg, interstitial hydrostatic pressure is 2 mm Hg, and interstitial oncotic pressure is 7 mm Hg. What capillary oncotic pressure would produce a net filtration pressure of 3 mm Hg?',
      };
      item.rationale = {
        correct:
          'Using Starling forces: NFP = Pc + πi - Pi - πc. Substituting values gives 3 = 25 + 7 - 2 - πc, so πc = 27 mm Hg.',
        distractors: {},
        pearl: 'Rearrange the Starling equation carefully and keep hydrostatic and oncotic terms distinct.',
      };
      setSingleCorrect(item, 'D');
      markResolved(item, 'Prompt rewritten for clarity; answer preserved as 27 mm Hg.');
      break;
    }
    case 46686: {
      item.title = 'Time to form the same amount of product under zero-order kinetics';
      item.prompt =
        'When substrate concentration is far above the Km of an enzyme, 12 microgram/mL of product is formed in 9 minutes. If the enzyme concentration is reduced to one-third while substrate remains saturating, how long will it take to form the same amount of product?';
      item.vignette = {
        ...(item.vignette || {}),
        narrative:
          'When substrate concentration is far above the Km of an enzyme, 12 microgram/mL of product is formed in 9 minutes. If the enzyme concentration is reduced to one-third while substrate remains saturating, how long will it take to form the same amount of product?',
      };
      item.rationale = {
        correct:
          'Under zero-order kinetics with saturating substrate, reaction rate is proportional to enzyme concentration. Reducing the enzyme concentration to one-third reduces the rate to one-third, so the time needed to make the same amount of product becomes three times longer: 27 minutes.',
        distractors: {},
        pearl: 'In zero-order conditions, changing enzyme concentration changes rate directly, while excess substrate does not limit the reaction.',
      };
      setSingleCorrect(item, 'C');
      markResolved(item, 'Heavy OCR/truncation cleaned into a coherent zero-order kinetics item; key preserved.');
      break;
    }
    default:
      break;
  }
}

repo.updateCaseSnapshots(targets);
console.log(`Updated ${targets.length} outlier cases.`);
repo.close();
