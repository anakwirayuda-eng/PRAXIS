/**
 * MedCase Pro — Monte Carlo Pass Predictor (Web Worker)
 * Simulates 10,000 virtual exams using FSRS retrievability data
 * 
 * Input: { brainBuffer, examConfig }
 * Output: { passProbability, distribution, percentile }
 */

const PARAMS_PER_CASE = 5;
const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

self.onmessage = function(e) {
  const { brainBuffer, examConfig } = e.data;
  const brain = new Float32Array(brainBuffer);
  
  const {
    totalQuestions = 150,    // UKMPPD: 150, USMLE: 320
    passMark = 0.66,          // 66% for UKMPPD
    iterations = 10000,
    casePool = [],            // Array of case IDs to draw from
    guessRate = 0.20,         // 1/5 chance for 5-option MCQ blind guess
  } = examConfig;

  const now = Date.now() / 1000;
  const examQuestionCount = casePool.length > 0
    ? Math.min(totalQuestions, casePool.length)
    : totalQuestions;
  const scoreDistribution = new Array(examQuestionCount + 1).fill(0);
  let passCount = 0;
  const passMarkScore = Math.ceil(examQuestionCount * passMark);

  for (let sim = 0; sim < iterations; sim++) {
    let score = 0;

    // Shuffle and pick questions for this simulated exam
    const examQuestions = shuffleAndPick(casePool, examQuestionCount);

    for (let q = 0; q < examQuestions.length; q++) {
      const caseId = examQuestions[q];
      const ptr = caseId * PARAMS_PER_CASE;
      
      const stability = brain[ptr + 1];
      const lastReview = brain[ptr + 4];

      let recallProbability;

      if (lastReview === 0 || stability === 0) {
        // Never studied: rely on guessing probability
        recallProbability = guessRate;
      } else {
        // Calculate current retrievability via FSRS forgetting curve
        const elapsedDays = (now - lastReview) / 86400;
        recallProbability = Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
        recallProbability = Math.max(guessRate, Math.min(1, recallProbability));
      }

      // Monte Carlo roll: does the student remember?
      if (Math.random() <= recallProbability) {
        score++;
      }
    }

    scoreDistribution[score]++;
    if (score >= passMarkScore) passCount++;

    // Progress reporting every 1000 iterations
    if (sim % 1000 === 0 && sim > 0) {
      self.postMessage({
        type: 'progress',
        progress: Math.round((sim / iterations) * 100),
        currentEstimate: Math.round((passCount / sim) * 1000) / 10,
      });
    }
  }

  // Calculate statistics
  const passProbability = Math.round((passCount / iterations) * 1000) / 10;
  
  // Find percentiles
  let cumulative = 0;
  let p5 = 0, p25 = 0, p50 = 0, p75 = 0, p95 = 0;
  for (let i = 0; i <= examQuestionCount; i++) {
    cumulative += scoreDistribution[i];
    const pct = cumulative / iterations;
    if (p5 === 0 && pct >= 0.05) p5 = i;
    if (p25 === 0 && pct >= 0.25) p25 = i;
    if (p50 === 0 && pct >= 0.50) p50 = i;
    if (p75 === 0 && pct >= 0.75) p75 = i;
    if (p95 === 0 && pct >= 0.95) p95 = i;
  }

  // Expected score
  let totalScore = 0;
  for (let i = 0; i <= examQuestionCount; i++) {
    totalScore += i * scoreDistribution[i];
  }
  const expectedScore = Math.round((totalScore / iterations) * 10) / 10;
  const expectedPct = Math.round((expectedScore / Math.max(examQuestionCount, 1)) * 1000) / 10;

  self.postMessage({
    type: 'result',
    passProbability,
    expectedScore,
    expectedPct,
    percentiles: { p5, p25, p50, p75, p95 },
    distribution: scoreDistribution,
    passMarkScore,
    iterations,
    totalQuestions: examQuestionCount,
    requestedQuestions: totalQuestions,
  });
};

function shuffleAndPick(pool, count) {
  if (pool.length === 0) {
    // If no pool provided, generate sequential IDs
    return Array.from({ length: count }, (_, i) => i);
  }
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
