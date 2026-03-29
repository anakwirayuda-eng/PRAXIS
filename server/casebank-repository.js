import { openCasebankDb } from './casebank-db.js';

function parseJsonColumn(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return JSON.parse(value);
}

function asIntFlag(value) {
  return value ? 1 : 0;
}

export function hydrateCase(caseRow, optionRows = []) {
  return {
    _id: caseRow.case_id,
    hash_id: caseRow.hash_id ?? null,
    q_type: caseRow.q_type ?? null,
    confidence: caseRow.confidence ?? null,
    category: caseRow.category ?? null,
    title: caseRow.title ?? null,
    vignette: parseJsonColumn(caseRow.vignette_json, {}),
    prompt: caseRow.prompt ?? '',
    options: optionRows.map((row) => ({
      id: row.option_id,
      text: row.option_text,
      is_correct: Boolean(row.is_correct),
    })),
    rationale: parseJsonColumn(caseRow.rationale_json, {}),
    meta: parseJsonColumn(caseRow.meta_json, {}),
    validation: parseJsonColumn(caseRow.validation_json, {}),
    case_code: caseRow.case_code ?? '',
  };
}

export function dehydrateCase(caseData) {
  const meta = caseData.meta || {};
  return {
    case_id: caseData._id,
    case_code: caseData.case_code ?? '',
    hash_id: caseData.hash_id ?? null,
    q_type: caseData.q_type ?? null,
    confidence: caseData.confidence ?? null,
    category: caseData.category ?? null,
    title: caseData.title ?? null,
    prompt: caseData.prompt ?? '',
    source: meta.source ?? '',
    subject: meta.subject ?? '',
    topic: meta.topic ?? '',
    exam_type: meta.examType ?? '',
    difficulty: meta.difficulty ?? null,
    original_difficulty: meta.original_difficulty ?? null,
    quality_score: meta.quality_score ?? null,
    negative_stem: asIntFlag(meta.negative_stem),
    option_count: meta.option_count ?? caseData.options?.length ?? 0,
    answer_anchor_text: meta.answer_anchor_text ?? '',
    meta_status: meta.status ?? '',
    clinical_consensus: meta.clinical_consensus ?? '',
    t9_verified: asIntFlag(meta._openclaw_t9_v2 || meta._openclaw_t9_verified),
    t10_verified: asIntFlag(meta._openclaw_t10_verified),
    vignette_json: JSON.stringify(caseData.vignette ?? {}),
    rationale_json: JSON.stringify(caseData.rationale ?? {}),
    meta_json: JSON.stringify(meta),
    validation_json: JSON.stringify(caseData.validation ?? {}),
  };
}

export function loadAllCases(db) {
  const caseRows = db.prepare(`
    SELECT
      case_id,
      case_code,
      hash_id,
      q_type,
      confidence,
      category,
      title,
      prompt,
      vignette_json,
      rationale_json,
      meta_json,
      validation_json
    FROM cases
    ORDER BY case_id
  `).all();

  const optionRows = db.prepare(`
    SELECT case_id, option_id, sort_order, option_text, is_correct
    FROM case_options
    ORDER BY case_id, sort_order
  `).all();

  const optionsByCaseId = new Map();
  for (const row of optionRows) {
    const list = optionsByCaseId.get(row.case_id) || [];
    list.push(row);
    optionsByCaseId.set(row.case_id, list);
  }

  return caseRows.map((row) => hydrateCase(row, optionsByCaseId.get(row.case_id) || []));
}

export function createCasebankRepository(db = openCasebankDb()) {
  const updateCaseStmt = db.prepare(`
    UPDATE cases
    SET
      case_code = @case_code,
      hash_id = @hash_id,
      q_type = @q_type,
      confidence = @confidence,
      category = @category,
      title = @title,
      prompt = @prompt,
      source = @source,
      subject = @subject,
      topic = @topic,
      exam_type = @exam_type,
      difficulty = @difficulty,
      original_difficulty = @original_difficulty,
      quality_score = @quality_score,
      negative_stem = @negative_stem,
      option_count = @option_count,
      answer_anchor_text = @answer_anchor_text,
      meta_status = @meta_status,
      clinical_consensus = @clinical_consensus,
      t9_verified = @t9_verified,
      t10_verified = @t10_verified,
      vignette_json = @vignette_json,
      rationale_json = @rationale_json,
      meta_json = @meta_json,
      validation_json = @validation_json
    WHERE case_id = @case_id
  `);

  const replaceOptionsStmt = db.prepare(`
    INSERT INTO case_options (case_id, option_id, sort_order, option_text, is_correct)
    VALUES (@case_id, @option_id, @sort_order, @option_text, @is_correct)
  `);

  const deleteOptionsStmt = db.prepare('DELETE FROM case_options WHERE case_id = ?');

  const applyCaseSnapshot = (caseData) => {
    const bindings = dehydrateCase(caseData);
    updateCaseStmt.run(bindings);
    deleteOptionsStmt.run(caseData._id);
    for (let index = 0; index < (caseData.options || []).length; index++) {
      const option = caseData.options[index];
      replaceOptionsStmt.run({
        case_id: caseData._id,
        option_id: String(option.id ?? index),
        sort_order: index,
        option_text: option.text ?? '',
        is_correct: asIntFlag(option.is_correct),
      });
    }
  };

  const updateCaseSnapshotTxn = db.transaction((caseData) => {
    applyCaseSnapshot(caseData);
  });

  const updateCaseSnapshotsTxn = db.transaction((cases) => {
    for (const caseData of cases) {
      applyCaseSnapshot(caseData);
    }
  });

  return {
    db,
    close() {
      db.close();
    },
    getAllCases() {
      return loadAllCases(db);
    },
    updateCaseSnapshot(caseData) {
      updateCaseSnapshotTxn(caseData);
    },
    updateCaseSnapshots(cases) {
      updateCaseSnapshotsTxn(cases);
    },
  };
}
