import { useEffect } from 'react';

export function useKeyboardShortcuts({
  onSelect,
  onSubmit,
  onNext,
  onBack,
  onBookmark,
  onFlag,
  onToggleExplanation,
  isReviewing = false,
  isAnswering = true,
  selectedAnswer = null,
}) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      const tagName = event.target?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return;
      }

      const key = event.key.toLowerCase();

      if (isAnswering && !isReviewing && 'abcde'.includes(key)) {
        event.preventDefault();
        onSelect?.(key.toUpperCase());
        return;
      }

      if (isAnswering && !isReviewing && '12345'.includes(key)) {
        const sctMap = { '1': '-2', '2': '-1', '3': '0', '4': '+1', '5': '+2' };
        event.preventDefault();
        onSelect?.(sctMap[key]);
        return;
      }

      if (key === 'enter') {
        event.preventDefault();
        if (isReviewing) {
          onNext?.();
        } else if (selectedAnswer !== null) {
          onSubmit?.();
        }
        return;
      }

      if (key === 'n' && isReviewing) {
        event.preventDefault();
        onNext?.();
        return;
      }

      if (key === 'e' && isReviewing) {
        event.preventDefault();
        onToggleExplanation?.();
        return;
      }

      if (key === 'b') {
        event.preventDefault();
        onBookmark?.();
        return;
      }

      if (key === 'f') {
        event.preventDefault();
        onFlag?.();
        return;
      }

      if (key === 'escape') {
        event.preventDefault();
        onBack?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isAnswering,
    isReviewing,
    onBack,
    onBookmark,
    onFlag,
    onNext,
    onSelect,
    onSubmit,
    onToggleExplanation,
    selectedAnswer,
  ]);
}
