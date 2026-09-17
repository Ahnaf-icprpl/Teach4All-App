import van from 'vanjs-core';
import { icon } from '../icons.js';
import { t } from '../uiTexts.js';

const { div, span, button, p } = van.tags;

/**
 * Generates an offline-safe conceptual clue without spoiling the answer.
 */
export function generateLocalClue(q = {}) {
  const explanation = q.explanation || q.explanation_text || '';
  if (explanation && typeof explanation === 'string') {
    const cleaned = explanation
      .replace(/(?:jawaban(?:nya)?\s+(?:yang\s+)?(?:benar|tepat)\s+(?:adalah|yaitu)?\s*[^.,;]+[.,;]?\s*)/gi, '')
      .replace(/pilihan\s+[a-d1-4]\s+(?:benar|tepat)\s+karena\s+/gi, '')
      .trim();
    const firstSentence = cleaned.split(/[.!?]\s+/)[0];
    if (firstSentence && firstSentence.length > 15) {
      return `${t('dialogs_quiz_clue_concept_prefix')}${firstSentence.trim()}${t('dialogs_quiz_clue_concept_suffix')}`;
    }
  }

  return t('dialogs_quiz_clue_generic');
}

/**
 * Renders the interactive AI Clue Stick attached to the Quiz modal popup.
 */
export function QuizClueStick({ isOpen, loading, clueText, onClose, questionNumber }) {
  return () => {
    if (!isOpen.val) return div({ class: 'quiz-clue-stick-hidden', 'aria-hidden': 'true' });

    return div({
      class: 'quiz-clue-stick',
      role: 'region',
      'aria-label': () => t('dialogs_quiz_clue_title'),
    },
      div({ class: 'quiz-stick-header' },
        div({ class: 'quiz-stick-badge' },
          icon('spark', 'quiz-stick-spark-icon'),
          span({ class: 'quiz-stick-title' }, () => t('dialogs_quiz_clue_title')),
          span({ class: 'quiz-stick-qnum' }, () => `${t('dialogs_quiz_question_label')} ${questionNumber.val}`),
        ),
        button({
          type: 'button',
          class: 'quiz-stick-close-btn',
          'aria-label': () => t('dialogs_quiz_clue_close'),
          title: () => t('dialogs_quiz_clue_close'),
          onclick: onClose,
        }, icon('close')),
      ),
      div({ class: 'quiz-stick-body' },
        loading.val
          ? div({ class: 'quiz-stick-loading' },
              div({ class: 'quiz-stick-spinner' }, icon('spark')),
              p(() => t('dialogs_quiz_clue_loading')),
            )
          : div({ class: 'quiz-stick-content' },
              p({ class: 'quiz-stick-text' }, () => clueText.val),
            ),
      ),
    );
  };
}
