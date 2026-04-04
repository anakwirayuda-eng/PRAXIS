/**
 * MedCase Pro — Case Browser Page (Performance Optimized)
 * 
 * Genius Hacks applied:
 *  1. DOM Diet — CSS transitions instead of Framer Motion, Unicode stars instead of SVG
 *  2. Invisible Infinite Scroll — IntersectionObserver auto-loads pages
 *  3. O(1) Search — useDeferredValue + pre-computed _searchKey
 *  4. content-visibility: auto — native browser virtualization via CSS
 *  5. Daily Seed Shuffle — different order every day to prevent repetition
 *  6. Unseen First — prioritize cases user hasn't completed
 */
import { useMemo, useState, useEffect, useRef, useDeferredValue } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CATEGORIES, useCaseBank } from '../data/caseLoader';
import { isCaseNeedsReview, isCaseQuarantined, isCaseTruncated } from '../data/caseQuality';
import { getCaseRouteId } from '../data/caseIdentity';
import { useStore } from '../data/store';
import Search from 'lucide-react/dist/esm/icons/search';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Bookmark from 'lucide-react/dist/esm/icons/bookmark';
import Zap from 'lucide-react/dist/esm/icons/zap';
import Shuffle from 'lucide-react/dist/esm/icons/shuffle';
import Camera from 'lucide-react/dist/esm/icons/camera';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal';

// Genius Hack 5: Seeded PRNG — same shuffle for the whole day (pagination-stable)
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function getDailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const PAGE_SIZE = 50;
const srOnlyStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function updateQueryParams(searchParams, updates) {
  const next = new URLSearchParams(searchParams);
  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || value === 'all' || value === false) {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  });
  return next;
}

function getBrowserResetKey(searchParams) {
  const next = new URLSearchParams(searchParams);
  next.delete('q');
  return next.toString();
}

function getCaseCategoryToken(category) {
  const normalized = String(category || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return normalized || 'unknown';
}

function getCaseExamLabel(meta) {
  const examType = meta?.examType;
  return examType && examType !== 'BOTH' ? examType : null;
}

function getNarrativePreview(narrative) {
  const text = String(narrative || '').trim();
  if (!text) return 'Clinical vignette preview unavailable.';
  return text.length > 120 ? `${text.substring(0, 120)}...` : text;
}

export function buildCasePlaylist(cases, currentIndex, maxSize = 2000) {
  const safeCases = Array.isArray(cases) ? cases : [];
  const cappedSize = Math.max(1, maxSize);
  if (safeCases.length === 0) return [];

  const maxStart = Math.max(0, safeCases.length - cappedSize);
  const startIndex = currentIndex >= 0
    ? Math.max(0, Math.min(currentIndex, maxStart))
    : 0;

  return safeCases
    .slice(startIndex, startIndex + cappedSize)
    .map(getCaseRouteId);
}

// Genius Hack 1: Unicode stars instead of 42K SVG DOM nodes
function DifficultyStars({ level }) {
  return (
    <span style={{ color: 'var(--accent-warning)', letterSpacing: '2px', fontSize: '0.85rem' }}>
      {'★'.repeat(level)}{'☆'.repeat(3 - level)}
    </span>
  );
}

export default function CaseBrowser() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { completedCases, bookmarks } = useStore();
  const { cases: caseBank, totalCases, status, isLoading } = useCaseBank();

  const searchQuery = searchParams.get('q') || '';
  const [search, setSearch] = useState(searchQuery);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const initialPage = typeof location.state?.restorePage === 'number' && location.state.restorePage > 1
    ? location.state.restorePage
    : 1;
  const [page, setPage] = useState(initialPage);
  const observerTarget = useRef(null);
  const searchInputRef = useRef(null);

  // Genius Hack 3: Deferred search + Debounced URL Sync
  const deferredSearch = useDeferredValue(search.toLowerCase());

  // Only absorb external URL query string changes (e.g. going back/forward)
  useEffect(() => {
    if (searchQuery !== search) {
      setSearch(searchQuery);
    }
  }, [searchQuery]);

  // Debounce typed local search state into the URL so fast keystrokes aren't skipped
  useEffect(() => {
    const handler = setTimeout(() => {
      const activeQuery = searchParams.get('q') || '';
      if (activeQuery !== search) {
        setSearchParams(updateQueryParams(searchParams, { q: search }), { replace: true });
      }
    }, 400);
    return () => clearTimeout(handler);
  }, [search, searchParams, setSearchParams]);

  const selectedCategory = searchParams.get('category') || 'all';
  const selectedDifficulty = searchParams.get('difficulty') || 'all';
  const selectedType = searchParams.get('type') || 'all';
  const selectedExam = searchParams.get('exam') || 'all';
  const showBookmarksOnly = searchParams.get('bookmarks') === '1'
    || searchParams.get('bookmarks') === 'true'
    || searchParams.get('filter') === 'bookmarked';
  const selectedMode = searchParams.get('mode') || 'all';

  const hideCompleted = searchParams.get('hideCompleted') === '1';
  const showImagesOnly = searchParams.get('images') === '1';
  const unseenFirst = searchParams.get('unseen') !== '0'; // default ON
  const hideTruncated = searchParams.get('hideTruncated') !== '0'; // default ON
  const reviewModeRaw = searchParams.get('showOnlyReviewed') === '1'
    ? 'reviewed'
    : searchParams.get('hideUnreviewed') === '0'
      ? 'all'
      : 'hide';
  const reviewedCaseCount = useMemo(
    () => caseBank.filter((caseData) => caseData.meta?.reviewed === true).length,
    [caseBank],
  );
  const reviewMode = reviewModeRaw === 'reviewed' && reviewedCaseCount === 0
    ? 'hide'
    : reviewModeRaw;
  const hideUnreviewed = reviewMode === 'hide';
  const showOnlyReviewed = reviewMode === 'reviewed';
  const canFilterReviewed = reviewedCaseCount > 0;

  // Genius Hack 3: O(1) feeling search using pre-computed _searchKey
  const filteredCases = useMemo(() => {
    const filtered = caseBank.filter((caseData) => {
      const meta = caseData.meta ?? {};
      const isTruncated = isCaseTruncated(caseData);
      const needsReview = isCaseNeedsReview(caseData);
      if (showBookmarksOnly && !bookmarks.includes(caseData._id)) return false;
      if (hideCompleted && completedCases.includes(caseData._id)) return false;
      if (showImagesOnly && (!caseData.images || caseData.images.length === 0)) return false;
      if (isCaseQuarantined(caseData)) return false; // Always hide quarantined
      if (hideTruncated && isTruncated) return false;
      if (hideUnreviewed && needsReview) return false;                 // 'hide': exclude flagged
      if (showOnlyReviewed && !meta.reviewed) return false;            // 'reviewed': require positive flag
      if (selectedCategory !== 'all' && caseData.category !== selectedCategory) return false;
      if (selectedDifficulty !== 'all' && meta.difficulty !== Number.parseInt(selectedDifficulty, 10)) return false;
      if (selectedType !== 'all' && caseData.q_type !== selectedType) return false;
      if (selectedExam !== 'all' && meta.examType !== selectedExam && meta.examType !== 'BOTH') return false;
      if (selectedMode === 'rapid_recall' && meta.questionMode !== 'rapid_recall') return false;

      if (deferredSearch) {
        return (caseData._searchKey || '').includes(deferredSearch);
      }
      return true;
    });

    // Keep loading results stable while compiled chunks are still streaming in.
    // Otherwise the seeded shuffle keeps re-running against a growing dataset
    // and cards can visually "morph" into different cases between glance and click.
    if (status !== 'ready') {
      return filtered;
    }

    // Genius Hack 6: Unseen-first ordering + daily seed shuffle
    const completedSet = new Set(completedCases);
    if (unseenFirst && !deferredSearch) {
      const unseen = filtered.filter(c => !completedSet.has(c._id));
      const seen = filtered.filter(c => completedSet.has(c._id));
      return [...seededShuffle(unseen, getDailySeed()), ...seededShuffle(seen, getDailySeed() + 1)];
    }
    return deferredSearch ? filtered : seededShuffle(filtered, getDailySeed());
  }, [bookmarks, caseBank, completedCases, deferredSearch, hideCompleted, hideTruncated, reviewMode, selectedCategory, selectedDifficulty, selectedExam, selectedMode, selectedType, showBookmarksOnly, showImagesOnly, status, unseenFirst]);

  // Genius Hack 2: IntersectionObserver infinite scroll
  // Reset page only when the browsing query actually changes.
  // Streaming more cases into the library should not collapse a deep scroll session.
  const browserResetKey = useMemo(() => getBrowserResetKey(searchParams), [searchParams]);
  const prevBrowserResetKeyRef = useRef(browserResetKey);
  const prevSearchQueryRef = useRef(searchQuery);
  useEffect(() => {
    if (prevBrowserResetKeyRef.current !== browserResetKey) {
      setPage(1);
      prevBrowserResetKeyRef.current = browserResetKey;
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [browserResetKey]);

  useEffect(() => {
    if (prevSearchQueryRef.current !== searchQuery) {
      setPage(1);
      prevSearchQueryRef.current = searchQuery;
    }
  }, [searchQuery]);

  const paginatedCases = useMemo(
    () => filteredCases.slice(0, page * PAGE_SIZE),
    [filteredCases, page]
  );

  useEffect(() => {
    const el = observerTarget.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setPage(p => p + 1);
      },
      { rootMargin: '600px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filteredCases.length]); // Re-attach when filter results change

  const hasMore = paginatedCases.length < filteredCases.length;

  const setFilter = (key, value) => {
    setSearchParams(updateQueryParams(searchParams, { [key]: value }));
  };

  const setSearchQuery = (value) => {
    setSearch(value); // URL will sync autonomously via the debounce effect
  };

  const setReviewMode = (nextMode) => {
    const nextParams = updateQueryParams(searchParams, {
      hideUnreviewed: nextMode === 'all' || nextMode === 'reviewed' ? '0' : null,
      showOnlyReviewed: nextMode === 'reviewed' ? '1' : null,
    });
    setSearchParams(nextParams);
  };

  const clearQuickFilters = () => {
    setSearchParams(updateQueryParams(searchParams, {
      bookmarks: null,
      filter: null,
      mode: null,
      images: null,
      hideCompleted: null,
      hideTruncated: null,
      hideUnreviewed: null,
      showOnlyReviewed: null,
    }));
  };

  useEffect(() => {
    const restoreScrollY = location.state?.restoreScrollY;
    if (typeof restoreScrollY !== 'number') return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoreScrollY, left: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.key, location.state]);

  useEffect(() => {
    const focusSearchField = () => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
      if (typeof input.scrollIntoView === 'function') {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };

    const handleHeaderSearchFocus = () => {
      window.requestAnimationFrame(focusSearchField);
    };

    window.addEventListener('praxis:focus-case-search', handleHeaderSearchFocus);

    if (!location.state?.focusSearch) {
      return () => window.removeEventListener('praxis:focus-case-search', handleHeaderSearchFocus);
    }

    const frame = window.requestAnimationFrame(() => {
      focusSearchField();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('praxis:focus-case-search', handleHeaderSearchFocus);
    };
  }, [location.key, location.state]);

  const hasAppliedFilters = showBookmarksOnly
    || hideCompleted
    || showImagesOnly
    || !hideTruncated
    || reviewMode !== 'hide'
    || selectedCategory !== 'all'
    || selectedDifficulty !== 'all'
    || selectedType !== 'all'
    || selectedExam !== 'all'
    || selectedMode !== 'all';
  const activeFilterCount = [
    showBookmarksOnly,
    hideCompleted,
    showImagesOnly,
    !hideTruncated,
    reviewMode !== 'hide',
    selectedCategory !== 'all',
    selectedDifficulty !== 'all',
    selectedType !== 'all',
    selectedExam !== 'all',
    selectedMode !== 'all',
  ].filter(Boolean).length;

  useEffect(() => {
    const updateMobileState = () => setIsMobile(window.innerWidth <= 640);
    updateMobileState();
    window.addEventListener('resize', updateMobileState);
    return () => window.removeEventListener('resize', updateMobileState);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    setFiltersExpanded(hasAppliedFilters);
  }, [hasAppliedFilters, isMobile]);

  const openCase = (caseData, caseNumber) => {
    const suffix = Number.isInteger(caseNumber) ? `?n=${caseNumber}` : '';
    const routeId = getCaseRouteId(caseData);
    const currentIndex = Number.isInteger(caseNumber)
      ? caseNumber - 1
      : filteredCases.findIndex((entry) => entry._id === caseData._id);
    // Cap at 2000 to prevent oversized history state on large libraries,
    // but always include the current case so Next Case stays in-context.
    const playlist = buildCasePlaylist(filteredCases, currentIndex);
    navigate(`/case/${encodeURIComponent(routeId)}${suffix}`, {
      state: { 
        caseNumber: Number.isInteger(caseNumber) ? caseNumber : undefined,
        playlist,
        // Preserve current filter URL so back button can restore context
        browserSearch: location.search,
        browserScrollY: window.scrollY,
        browserPage: page,
      },
    });
  };

  const goRandomCase = () => {
    const completedSet = new Set(completedCases);
    const visiblePool = filteredCases;
    if (visiblePool.length === 0) return;
    const unseenPool = visiblePool.filter((caseData) => !completedSet.has(caseData._id));
    const pool = unseenPool.length > 0 ? unseenPool : visiblePool;
    const pick = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    if (!pick) return;
    const sequenceNumber = filteredCases.findIndex((caseData) => caseData._id === pick._id);
    openCase(pick, sequenceNumber >= 0 ? sequenceNumber + 1 : undefined);
  };

  return (
    <div>
      <div style={{ marginBottom: 'var(--sp-6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <div>
          <h1 className="page-title">Case Browser</h1>
          <p className="page-subtitle">{totalCases.toLocaleString()} clinical cases • Shuffled daily • Unseen first</p>
        </div>
        <button
          className="btn btn-primary browser-random-btn"
          aria-label="Start random case"
          onClick={goRandomCase}
          disabled={filteredCases.length === 0}
          title={filteredCases.length === 0 ? 'Tidak ada case yang cocok dengan filter saat ini.' : undefined}
          style={{
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            ...(filteredCases.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
          }}
        >
          <Shuffle aria-hidden="true" size={16} /> Random Case <span aria-hidden="true">🎲</span>
        </button>
      </div>

      <div className="glass-card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-6)' }}>
        <div className="filter-bar-row" style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: isMobile ? '100%' : 200, position: 'relative' }}>
            <label htmlFor="case-search" style={srOnlyStyle}>Search cases</label>
            <Search aria-hidden="true" size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              ref={searchInputRef}
              id="case-search"
              className="input"
              placeholder="Search cases, tags, diseases..."
              value={search}
              onChange={(event) => setSearchQuery(event.target.value)}
              style={{ paddingLeft: 36 }}
            />
          </div>

          {isMobile && (
            <button
              type="button"
              className="btn btn-ghost"
              aria-expanded={filtersExpanded}
              onClick={() => setFiltersExpanded((current) => !current)}
              style={{
                width: '100%',
                justifyContent: 'center',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-2)',
              }}
            >
              <SlidersHorizontal size={14} />
              {filtersExpanded ? 'Hide Filters' : 'Filters'}
              {activeFilterCount > 0 && (
                <span className="badge badge-info" style={{ marginLeft: 'var(--sp-1)' }}>
                  {activeFilterCount} active
                </span>
              )}
            </button>
          )}

          {(!isMobile || filtersExpanded) && (
            <>
              <label htmlFor="case-category-filter" style={srOnlyStyle}>Filter by category</label>
              <select
                id="case-category-filter"
                className="input"
                style={isMobile ? { width: '100%', minWidth: 0 } : { width: 'auto', minWidth: 160 }}
                value={selectedCategory}
                onChange={(event) => setFilter('category', event.target.value)}
              >
                <option value="all">All Categories</option>
                {Object.entries(CATEGORIES).map(([key, cat]) => (
                  <option key={key} value={key}>{cat.label}</option>
                ))}
              </select>

              <label htmlFor="case-difficulty-filter" style={srOnlyStyle}>Filter by difficulty</label>
              <select
                id="case-difficulty-filter"
                className="input"
                style={isMobile ? { width: '100%', minWidth: 0 } : { width: 'auto', minWidth: 120 }}
                value={selectedDifficulty}
                onChange={(event) => setFilter('difficulty', event.target.value)}
              >
                <option value="all">All Levels</option>
                <option value="1">★ Easy</option>
                <option value="2">★★ Medium</option>
                <option value="3">★★★ Hard</option>
              </select>

              <label htmlFor="case-type-filter" style={srOnlyStyle}>Filter by question type</label>
              <select
                id="case-type-filter"
                className="input"
                style={isMobile ? { width: '100%', minWidth: 0 } : { width: 'auto', minWidth: 100 }}
                value={selectedType}
                onChange={(event) => setFilter('type', event.target.value)}
              >
                <option value="all">All Types</option>
                <option value="MCQ">MCQ</option>
                <option value="SCT">SCT</option>
                <option value="CLINICAL_DISCUSSION">Clinical</option>
              </select>

              <label htmlFor="case-exam-filter" style={srOnlyStyle}>Filter by exam type</label>
              <select
                id="case-exam-filter"
                className="input"
                style={isMobile ? { width: '100%', minWidth: 0 } : { width: 'auto', minWidth: 120 }}
                value={selectedExam}
                onChange={(event) => setFilter('exam', event.target.value)}
              >
                <option value="all">All Exams</option>
                <option value="UKMPPD">🇮🇩 UKMPPD</option>
                <option value="USMLE">🇺🇸 USMLE</option>
                <option value="MIR-Spain">🇪🇸 MIR-Spain</option>
                <option value="IgakuQA">🇯🇵 IgakuQA</option>
                <option value="International">🌍 International</option>
                <option value="Academic">📚 Academic</option>
                <option value="Research">🔬 Research</option>
                <option value="Clinical">🏥 Clinical</option>
              </select>

              <div className="filter-chips-row" style={{ display: 'flex', gap: 'var(--sp-2)', overflowX: 'auto', paddingBottom: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                <button
                  type="button"
                  aria-pressed={selectedMode === 'rapid_recall'}
                  className={`btn ${selectedMode === 'rapid_recall' ? '' : 'btn-ghost'}`}
                  onClick={() => setFilter('mode', selectedMode === 'rapid_recall' ? 'all' : 'rapid_recall')}
                  style={selectedMode === 'rapid_recall'
                    ? { background: 'rgba(13,148,136,0.15)', color: '#2dd4bf', border: '1px solid rgba(13,148,136,0.3)' }
                    : {}}
                >
                  <Zap size={14} /> Rapid Recall
                </button>

                <button
                  type="button"
                  aria-pressed={showImagesOnly}
                  className={`btn ${showImagesOnly ? '' : 'btn-ghost'}`}
                  onClick={() => setFilter('images', showImagesOnly ? '' : '1')}
                  style={showImagesOnly
                    ? { background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }
                    : {}}
                >
                  <Camera size={14} /> Has Image 📷
                </button>

                <button
                  type="button"
                  aria-pressed={hideCompleted}
                  className={`btn ${hideCompleted ? '' : 'btn-ghost'}`}
                  onClick={() => setFilter('hideCompleted', hideCompleted ? '' : '1')}
                  style={hideCompleted
                    ? { background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }
                    : {}}
                >
                  <CheckCircle size={14} /> Hide Completed
                </button>

                <button
                  type="button"
                  aria-pressed={hideTruncated}
                  className={`btn ${hideTruncated ? '' : 'btn-ghost'}`}
                  onClick={() => setFilter('hideTruncated', hideTruncated ? '0' : '')}
                  style={hideTruncated
                    ? { background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }
                    : {}}
                >
                  <AlertTriangle size={14} /> Hide Truncated
                </button>

                <button
                  type="button"
                  aria-pressed={hideUnreviewed}
                  className={`btn ${hideUnreviewed ? '' : 'btn-ghost'}`}
                  onClick={() => setReviewMode(reviewMode === 'hide' ? 'all' : 'hide')}
                  style={hideUnreviewed
                    ? { background: 'rgba(14,165,233,0.15)', color: '#38bdf8', border: '1px solid rgba(14,165,233,0.3)' }
                    : {}}
                >
                  <CheckCircle size={14} /> Hide Needs Review
                </button>

                {canFilterReviewed && (
                  <button
                    type="button"
                    aria-pressed={showOnlyReviewed}
                    className={`btn ${showOnlyReviewed ? '' : 'btn-ghost'}`}
                    onClick={() => setReviewMode(reviewMode === 'reviewed' ? 'hide' : 'reviewed')}
                    style={showOnlyReviewed
                      ? { background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }
                      : {}}
                  >
                    <CheckCircle size={14} /> Show Only Reviewed
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {hasAppliedFilters && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
            {showBookmarksOnly && (
              <span className="badge badge-warning">
                <Bookmark size={12} /> Bookmarked only
              </span>
            )}
            {selectedMode === 'rapid_recall' && (
              <span className="rapid-recall-badge">
                <Zap size={12} /> Rapid Recall
              </span>
            )}
            {!hideTruncated && (
              <span className="badge badge-warning">
                <AlertTriangle size={12} /> Including truncated
              </span>
            )}
            {reviewMode === 'all' && (
              <span className="badge badge-info">
                <CheckCircle size={12} /> Including needs review
              </span>
            )}
            {canFilterReviewed && reviewMode === 'reviewed' && (
              <span className="badge badge-success">
                <CheckCircle size={12} /> Reviewed only
              </span>
            )}
            <button className="btn btn-ghost" type="button" onClick={clearQuickFilters}>
              Clear Quick Toggles
            </button>
          </div>
        )}

        <div style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          Showing {paginatedCases.length} of {filteredCases.length} cases
          {filteredCases.length < totalCases && ` (filtered from ${totalCases})`}
        </div>
        {status !== 'ready' && (
          <div style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            {isLoading
              ? 'Loading the full case library in the background. Case order is temporarily locked until loading finishes.'
              : 'Compiled case library is unavailable. Showing the starter library only.'}
          </div>
        )}
      </div>

      {/* Genius Hack 1+4: CSS-only cards with content-visibility */}
      <div className="grid grid-2 stagger">
        {paginatedCases.map((caseData, index) => {
          const cat = CATEGORIES[caseData.category] ?? { label: caseData.category ?? 'Unknown', color: 'var(--text-muted)' };
          const categoryToken = getCaseCategoryToken(caseData.category);
          const examLabel = getCaseExamLabel(caseData.meta);
          const isCompleted = completedCases.includes(caseData._id);
          const isBookmarked = bookmarks.includes(caseData._id);
          const narrative = caseData.vignette?.narrative ?? '';
          const demographics = caseData.vignette?.demographics ?? {};
          const tags = Array.isArray(caseData.meta?.tags) ? caseData.meta.tags : [];
          const sequenceNumber = index + 1;

          return (
            <button
              type="button"
              key={caseData._id}
              data-testid="case-card"
              className="case-card glass-card glass-card-interactive"
                      onClick={() => openCase(caseData, sequenceNumber)}
              aria-label={`Open case ${sequenceNumber}: ${caseData.title}`}
              style={{ padding: 'var(--sp-5)', cursor: 'pointer', width: '100%', textAlign: 'left', background: 'transparent', border: 'var(--border-glass)' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)', flex: 1, minWidth: 0 }}>
                  <span
                    aria-label={`Case number ${sequenceNumber}`}
                    style={{
                      width: 50,
                      maxWidth: 50,
                      flexShrink: 0,
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      letterSpacing: '0.04em',
                      lineHeight: 1.6,
                    }}
                  >
                    #{sequenceNumber}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', minWidth: 0 }}>
                    <span className={`badge badge-${categoryToken}`} style={{ background: `${cat.color}15`, color: cat.color }}>
                      {cat.label}
                    </span>
                    {caseData.meta?.category_review_needed && (
                      <span className="badge badge-warning" title="This case specialty label is under review.">
                        Category under review
                      </span>
                    )}
                    <span className={`badge ${caseData.q_type === 'SCT' ? 'badge-warning' : caseData.q_type === 'CLINICAL_DISCUSSION' ? 'badge-success' : 'badge-info'}`}>
                      {caseData.q_type === 'CLINICAL_DISCUSSION' ? 'Clinical' : caseData.q_type}
                    </span>
                    {examLabel && (
                      <span className="badge badge-primary">{examLabel}</span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  {isBookmarked && <Bookmark size={16} style={{ color: 'var(--accent-warning)' }} fill="var(--accent-warning)" />}
                  {isCompleted && <CheckCircle size={16} style={{ color: 'var(--accent-success)' }} />}
                </div>
              </div>

              <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, marginBottom: 'var(--sp-2)' }}>{caseData.title}</h3>

              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-3)', lineHeight: 1.5 }}>
                {demographics.age && demographics.sex ? `${demographics.age}y/${demographics.sex} - ` : ''}
                {getNarrativePreview(narrative)}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <DifficultyStars level={caseData.meta.difficulty} />
                <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  {tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-full)',
                        background: 'rgba(148,163,184,0.08)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Genius Hack 2: Invisible IntersectionObserver trigger */}
      {hasMore && (
        <div ref={observerTarget} style={{ height: 20, display: 'flex', justifyContent: 'center', padding: 'var(--sp-6)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            Loading more cases...
          </span>
        </div>
      )}

      {filteredCases.length === 0 && (
        <div className="glass-card" style={{ padding: 'var(--sp-12)', textAlign: 'center' }}>
          <BookOpen size={48} style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-4)' }} />
          <h3 style={{ marginBottom: 'var(--sp-2)' }}>No cases found</h3>
          <p style={{ color: 'var(--text-muted)' }}>Try adjusting your filters or search terms.</p>
        </div>
      )}
    </div>
  );
}
