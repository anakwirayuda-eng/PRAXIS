/**
 * MedCase Pro — Zustand Store
 * DFA-based Case Player Engine + User Progress
 */
import { create } from 'zustand';
import { updateReview } from './fsrs';

const getStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const readJSON = (key, fallback, validator) => {
  const storage = getStorage();
  if (!storage) return fallback;

  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;

    const parsed = JSON.parse(raw);
    return validator(parsed) ? parsed : fallback;
  } catch (error) {
    console.warn(`[Store] Failed to read "${key}" from localStorage.`, error);
    return fallback;
  }
};

const readNumber = (key, fallback = 0) => {
  const storage = getStorage();
  if (!storage) return fallback;

  const parsed = Number.parseInt(storage.getItem(key) ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readBoolean = (key, fallback = false) => {
  const storage = getStorage();
  if (!storage) return fallback;

  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
};

const writeStorage = (key, value) => {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(key, String(value));
  } catch (error) {
    console.warn(`[Store] Failed to persist "${key}" to localStorage.`, error);
  }
};

const writeJSON = (key, value) => {
  writeStorage(key, JSON.stringify(value));
};

const isArray = (value) => Array.isArray(value);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const getInitialSidebarState = () => {
  try {
    return typeof window === 'undefined' ? true : window.innerWidth > 768;
  } catch {
    return true;
  }
};

export const useStore = create((set, get) => ({
  // Session State
  machineState: 'IDLE',
  mode: 'MCQ',
  currentCase: null,
  currentQuestionIdx: 0,
  selectedAnswer: null,
  answers: [],
  examCases: [],
  examTimeLeft: null,

  // User Progress
  completedCases: readJSON('mc_completed', [], isArray),
  scores: readJSON('mc_scores', {}, isObject),
  bookmarks: readJSON('mc_bookmarks', [], isArray),
  flaggedQuestions: readJSON('mc_flagged', [], isArray),
  streak: readNumber('mc_streak'),
  lastStudyDate: getStorage()?.getItem('mc_lastDate') || null,
  totalAnswered: readNumber('mc_totalAnswered'),
  totalCorrect: readNumber('mc_totalCorrect'),
  categoryScores: readJSON('mc_catScores', {}, isObject),

  // Settings
  timerEnabled: readBoolean('mc_timerEnabled', true),
  sidebarOpen: getInitialSidebarState(),

  // DFA Dispatch
  dispatch: (action, payload = {}) => set((state) => {
    if (action === 'RESET') {
      return {
        machineState: 'IDLE',
        mode: 'MCQ',
        currentCase: null,
        currentQuestionIdx: 0,
        selectedAnswer: null,
        answers: [],
        examCases: [],
        examTimeLeft: null,
      };
    }

    switch (state.machineState) {
      case 'IDLE':
        if (action === 'START_CASE') {
          if (!payload.caseData) return state;

          return {
            machineState: 'ANSWERING',
            currentCase: payload.caseData,
            selectedAnswer: null,
            answers: [],
            mode: payload.caseData.q_type,
          };
        }
        break;

      case 'ANSWERING':
        if (action === 'SELECT') return { selectedAnswer: payload.answerId };

        if (action === 'SUBMIT' && (state.selectedAnswer !== null || payload.forceReview === true || state.mode === 'CLINICAL_DISCUSSION')) {
          const currentCase = state.currentCase;
          if (!currentCase) {
            return {
              machineState: 'IDLE',
              currentCase: null,
              selectedAnswer: null,
            };
          }

          const isClinicalDiscussion = currentCase.q_type === 'CLINICAL_DISCUSSION' || payload.forceReview === true;

          if (isClinicalDiscussion) {
            const answer = {
              caseId: currentCase._id,
              answer: null,
              correct: null,
              timestamp: Date.now(),
            };

            const newCompleted = state.completedCases.includes(currentCase._id)
              ? state.completedCases
              : [...state.completedCases, currentCase._id];

            const today = new Date().toISOString().split('T')[0];
            let newStreak = state.streak;
            if (state.lastStudyDate !== today) {
              const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
              newStreak = state.lastStudyDate === yesterday ? state.streak + 1 : 1;
            }

            writeJSON('mc_completed', newCompleted);
            writeStorage('mc_streak', newStreak);
            writeStorage('mc_lastDate', today);

            return {
              machineState: 'REVIEWING',
              answers: [...state.answers, answer],
              completedCases: newCompleted,
              streak: newStreak,
              lastStudyDate: today,
            };
          }

          if (!Array.isArray(currentCase.options)) {
            return {
              machineState: 'IDLE',
              currentCase: null,
              selectedAnswer: null,
            };
          }

          const selected = state.selectedAnswer;
          const correctOption = currentCase.options.find((option) => option.is_correct);
          const isCorrect = selected === correctOption?.id;
          const categoryKey = currentCase.category || 'uncategorized';

          const answer = {
            caseId: currentCase._id,
            answer: selected,
            correct: isCorrect,
            timestamp: Date.now(),
          };

          const newTotalAnswered = state.totalAnswered + 1;
          const newTotalCorrect = state.totalCorrect + (isCorrect ? 1 : 0);
          const newCatScores = { ...state.categoryScores };
          if (!newCatScores[categoryKey]) {
            newCatScores[categoryKey] = { total: 0, correct: 0 };
          }
          newCatScores[categoryKey].total += 1;
          newCatScores[categoryKey].correct += isCorrect ? 1 : 0;

          const newCompleted = state.completedCases.includes(currentCase._id)
            ? state.completedCases
            : [...state.completedCases, currentCase._id];

          const today = new Date().toISOString().split('T')[0];
          let newStreak = state.streak;
          if (state.lastStudyDate !== today) {
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            newStreak = state.lastStudyDate === yesterday ? state.streak + 1 : 1;
          }

          writeJSON('mc_completed', newCompleted);
          writeStorage('mc_totalAnswered', newTotalAnswered);
          writeStorage('mc_totalCorrect', newTotalCorrect);
          writeJSON('mc_catScores', newCatScores);
          writeStorage('mc_streak', newStreak);
          writeStorage('mc_lastDate', today);

          if (!payload.skipFsrsUpdate) {
            try {
              updateReview(currentCase._id, isCorrect ? 3 : 1);
            } catch (error) {
              console.warn('[Store] Failed to auto-grade FSRS review.', error);
            }
          }

          return {
            machineState: 'REVIEWING',
            answers: [...state.answers, answer],
            totalAnswered: newTotalAnswered,
            totalCorrect: newTotalCorrect,
            categoryScores: newCatScores,
            completedCases: newCompleted,
            streak: newStreak,
            lastStudyDate: today,
          };
        }
        break;

      case 'LOCKED':
        if (action === 'REVEAL') return { machineState: 'REVIEWING' };
        break;

      case 'REVIEWING':
        if (action === 'NEXT_CASE') {
          return {
            machineState: 'IDLE',
            currentCase: null,
            selectedAnswer: null,
            mode: 'MCQ',
          };
        }
        break;

      default:
        break;
    }

    return state;
  }),

  // Actions
  startCase: (caseData) => get().dispatch('START_CASE', { caseData }),
  selectAnswer: (answerId) => get().dispatch('SELECT', { answerId }),
  submitAnswer: (options = {}) => get().dispatch('SUBMIT', options),
  nextCase: () => get().dispatch('NEXT_CASE'),
  resetSession: () => get().dispatch('RESET'),
  beginAnswering: () => get().dispatch('BEGIN_ANSWERING'),

  toggleBookmark: (caseId) => set((state) => {
    if (caseId === null || caseId === undefined) return state;

    const bookmarks = state.bookmarks.includes(caseId)
      ? state.bookmarks.filter((id) => id !== caseId)
      : [...state.bookmarks, caseId];

    writeJSON('mc_bookmarks', bookmarks);
    return { bookmarks };
  }),

  flagQuestion: (caseId, reason) => set((state) => {
    if (caseId === null || caseId === undefined) return state;

    const flagged = [...state.flaggedQuestions, { caseId, reason, timestamp: Date.now() }];
    writeJSON('mc_flagged', flagged);
    return { flaggedQuestions: flagged };
  }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen: Boolean(sidebarOpen) }),
  toggleTimer: () => set((state) => {
    const nextValue = !state.timerEnabled;
    writeStorage('mc_timerEnabled', nextValue);
    return { timerEnabled: nextValue };
  }),

  getAccuracy: () => {
    const { totalAnswered, totalCorrect } = get();
    return totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
  },

  getCategoryAccuracy: (category) => {
    const scores = get().categoryScores[category];
    if (!scores || scores.total === 0) return 0;
    return Math.round((scores.correct / scores.total) * 100);
  },
}));
