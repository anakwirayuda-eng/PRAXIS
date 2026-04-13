import { beforeEach, describe, expect, it, vi } from 'vitest';

function buildFetchResponse(jsonData, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => jsonData,
  };
}

async function loadFreshCaseLoader(compiledCases, quarantineManifest = null) {
  vi.resetModules();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(buildFetchResponse({}, false, 404))
    .mockResolvedValueOnce(buildFetchResponse(compiledCases))
    .mockResolvedValueOnce(
      quarantineManifest === null
        ? buildFetchResponse({}, false, 404)
        : buildFetchResponse(quarantineManifest),
    );

  vi.stubGlobal('fetch', fetchMock);

  const { caseBank: handCrafted } = await import('../data/caseBank.js');
  const loader = await import('../data/caseLoader.js');
  const cases = await loader.ensureCaseBankLoaded();

  return {
    fetchMock,
    handCraftedCount: handCrafted.length,
    loader,
    cases,
  };
}

describe('caseLoader runtime contracts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('normalizes malformed compiled cases through the runtime hydrator', async () => {
    const malformedCompiled = [
      {
        title: '',
        category: 'unknown-category',
        question: 'What finding is most concerning?',
        vignette: 'String vignette survives normalization.',
        options: null,
        rationale: '',
        meta: null,
      },
    ];

    const { handCraftedCount, loader } = await loadFreshCaseLoader(malformedCompiled);
    const normalized = loader.getCaseById(handCraftedCount);

    expect(normalized).toMatchInlineSnapshot(`
      {
        "_id": 12,
        "_searchKey": "unknown-category review what finding is most concerning? unclassified",
        "category": "Unclassified",
        "confidence": 0,
        "hash_id": "case_12",
        "meta": {
          "category_resolution": {
            "category_conflict": false,
            "confidence": "low",
            "prefix": null,
            "raw_category": "unknown-category",
            "raw_normalized_category": null,
            "resolved_category": "Unclassified",
            "runner_up_category": null,
            "runner_up_score": 0,
            "winning_signals": [],
          },
          "category_review_needed": false,
          "difficulty": 1,
          "examType": "BOTH",
          "needs_review": false,
          "provenance": [],
          "reviewed": false,
          "source": "manual",
          "tags": [],
          "truncated": false,
        },
        "options": [],
        "prompt": "Review this case and choose the best answer.",
        "q_type": "MCQ",
        "question": "What finding is most concerning?",
        "rationale": {
          "correct": "Explanation unavailable.",
          "distractors": {},
          "pearl": "",
        },
        "title": "unknown-category Review",
        "vignette": {
          "demographics": {
            "age": null,
            "sex": null,
          },
          "labFindings": "",
          "narrative": "What finding is most concerning?",
          "vitalSigns": null,
        },
      }
    `);
  });

  it('indexes prompt, answer options, and case codes into the flat search key', async () => {
    const compiledCases = [
      {
        title: 'Indexed Runtime Case',
        question: '',
        prompt: 'Which organism is classically urease positive?',
        case_code: 'MED-SEARCH-0007',
        options: [
          { id: 'A', text: 'Helicobacter pylori', is_correct: true },
          { id: 'B', text: 'Escherichia coli', is_correct: false },
        ],
        meta: { source: 'medqa', tags: ['microbiology'] },
      },
    ];

    const { handCraftedCount, loader } = await loadFreshCaseLoader(compiledCases);
    const normalized = loader.getCaseById(handCraftedCount);

    expect(normalized._searchKey).toContain('which organism is classically urease positive?');
    expect(normalized._searchKey).toContain('helicobacter pylori');
    expect(normalized._searchKey).toContain('med-search-0007');
    expect(normalized._searchKey).toContain('microbiology');
  });

  it('remaps distractor explanations that were keyed to the correct answer id', async () => {
    const compiledCases = [
      {
        title: 'Distractor key conflict',
        prompt: 'Chymotrypsinogen is a:',
        question: 'Chymotrypsinogen is a:',
        options: [
          { id: 'A', text: 'Transaminase', is_correct: false },
          { id: 'B', text: 'Carboxypeptidase', is_correct: false },
          { id: 'C', text: 'Clot lysing protein', is_correct: false },
          { id: 'D', text: 'Zymogen', is_correct: true },
        ],
        rationale: {
          correct: 'Chymotrypsinogen is the inactive precursor of chymotrypsin.',
          distractors: {
            A: 'Transaminases transfer amino groups and are unrelated here.',
            B: 'Carboxypeptidase is an active enzyme, not an inactive precursor.',
            D: 'A clot-lysing protein would be fibrinolytic, not a digestive zymogen.',
          },
          pearl: 'The -ogen suffix often signals an inactive enzyme precursor.',
        },
        meta: { source: 'medmcqa' },
      },
    ];

    const { handCraftedCount, loader } = await loadFreshCaseLoader(compiledCases);
    const normalized = loader.getCaseById(handCraftedCount);

    expect(normalized.rationale.distractors).toEqual({
      A: 'Transaminases transfer amino groups and are unrelated here.',
      B: 'Carboxypeptidase is an active enzyme, not an inactive precursor.',
      C: 'A clot-lysing protein would be fibrinolytic, not a digestive zymogen.',
    });
  });

  it('repairs broken entity artifacts in display text during normalization', async () => {
    const compiledCases = [
      {
        title: 'Lombard&;s test is used in diagnosis of',
        prompt: 'Lines of Blaschko&;s are along &;five cleans&;',
        question: 'Dercum&;s disease doesn&;t involve &;skeletal basis&; only.',
        options: [
          { id: 'A', text: 'Babies&; teeth' },
        ],
        rationale: {
          correct: 'Bailey & Love&;s says the patient&;s result doesn&;t require surgery.',
          distractors: {
            A: 'This is the &;wrong option&; for today.',
          },
          pearl: 'Temperature may rise to 38&deg;C.',
        },
        meta: { source: 'medmcqa' },
      },
    ];

    const { handCraftedCount, loader } = await loadFreshCaseLoader(compiledCases);
    const normalized = loader.getCaseById(handCraftedCount);

    expect(normalized.title).toBe("Lombard's test is used in diagnosis of");
    expect(normalized.prompt).toBe('Lines of Blaschko\'s are along "five cleans"');
    expect(normalized.question).toBe('Dercum\'s disease doesn\'t involve "skeletal basis" only.');
    expect(normalized.options[0].text).toBe("Babies' teeth");
    expect(normalized.rationale.correct).toBe("Bailey & Love's says the patient's result doesn't require surgery.");
    expect(normalized.rationale.distractors.A).toBe('This is the "wrong option" for today.');
    expect(normalized.rationale.pearl).toBe('Temperature may rise to 38°C.');
  });

  it('keeps hand-crafted cases, excludes quarantined compiled cases, and publishes the expected total', async () => {
    const compiledCases = [
      {
        _id: 'compiled_keep_1',
        title: 'Keep me',
        question: 'Question one',
        prompt: 'Question one',
        case_code: 'TMP-AAA-MCQ-00001',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'medqa', examType: 'USMLE', difficulty: 2 },
      },
      {
        _id: 'compiled_quarantine',
        title: 'Skip me',
        question: 'Question two',
        prompt: 'Question two',
        case_code: 'TMP-AAA-MCQ-00002',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'medqa', examType: 'USMLE', difficulty: 2, quarantined: true },
      },
      {
        _id: 'compiled_keep_2',
        title: 'Keep me too',
        question: 'Question three',
        prompt: 'Question three',
        case_code: 'TMP-AAA-MCQ-00003',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'headqa', examType: 'MIR-Spain', difficulty: 3 },
      },
    ];

    const { cases, fetchMock, handCraftedCount, loader } = await loadFreshCaseLoader(compiledCases);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(loader.getCaseBankSnapshot()).toMatchObject({
      status: 'ready',
      compiledCount: compiledCases.length,
      handCraftedCount,
      totalCases: handCraftedCount + 2,
    });
    expect(cases).toHaveLength(handCraftedCount + 2);
    expect(cases.slice(0, handCraftedCount)).toHaveLength(handCraftedCount);
    expect(cases.some((caseData) => caseData.title === 'Skip me')).toBe(false);
    expect(cases.some((caseData) => caseData.title === 'Keep me')).toBe(true);
    expect(cases.some((caseData) => caseData.title === 'Keep me too')).toBe(true);
  });

  it('applies quarantine manifest removals after hydration', async () => {
    const { caseBank: handCrafted } = await import('../data/caseBank.js');
    const compiledCases = [
      {
        _id: 'compiled_keep',
        title: 'Manifest survivor',
        question: 'Question one',
        prompt: 'Question one',
        case_code: 'TMP-AAA-MCQ-00011',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'medqa', examType: 'USMLE', difficulty: 2 },
      },
      {
        _id: 'compiled_drop',
        title: 'Manifest removal',
        question: 'Question two',
        prompt: 'Question two',
        case_code: 'TMP-AAA-MCQ-00012',
        options: [{ id: 'A', text: 'Answer', is_correct: true }],
        meta: { source: 'medqa', examType: 'USMLE', difficulty: 2 },
      },
    ];

    const expectedRemovedId = handCrafted.length + 1;
    const { cases, handCraftedCount, loader } = await loadFreshCaseLoader(compiledCases, [{ id: expectedRemovedId }]);

    expect(cases.some((caseData) => caseData.title === 'Manifest removal')).toBe(false);
    expect(cases.some((caseData) => caseData.title === 'Manifest survivor')).toBe(true);
    expect(loader.getCaseBankSnapshot().totalCases).toBe(handCraftedCount + 1);
  });
});
