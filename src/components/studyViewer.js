import van from 'vanjs-core';
import { icon } from '../icons.js';
import { startTopicChat, toast } from '../state.js';
import {
  fetchQuizDetails,
  fetchMaterialDetails,
  markQuizSolved,
  markMaterialSolved,
  normalizeQuizQuestion,
  normalizeMaterialSection,
} from '../studyModules.js';
import { t } from '../uiTexts.js';

const { div, h2, h3, p, span, button } = van.tags;

export function QuizSolver(quizId, onBack) {
  const loading = van.state(true);
  const quiz = van.state(null);
  const currentIndex = van.state(0);
  const userAnswers = van.state({});
  const isCompleted = van.state(false);

  fetchQuizDetails(quizId).then(data => {
    quiz.val = data;
    loading.val = false;
  }).catch(() => {
    loading.val = false;
  });

  return () => {
    if (loading.val) {
      return div({ class: 'study-viewer-loading' }, p(() => t('dialogs_quiz_loading')));
    }
    const qData = quiz.val;
    if (!qData) {
      return div({ class: 'study-viewer-empty' },
        p(() => t('dialogs_quiz_not_found')),
        button({ class: 'secondary-button', onclick: onBack }, icon('arrowRight'), span(() => t('dialogs_back_to_list'))),
      );
    }

    const questions = (qData.questions || []).map(normalizeQuizQuestion).filter(Boolean);
    const totalQuestions = questions.length;
    const currentQ = questions[currentIndex.val] || {};
    const answeredCount = Object.keys(userAnswers.val).length;
    const currentAnswer = userAnswers.val[currentIndex.val];

    const calculateScore = () => {
      let total = 0;
      questions.forEach((q, idx) => {
        if (userAnswers.val[idx] === q.correctAnswer) {
          total += (q.points || 10);
        }
      });
      return total;
    };

    const maxScore = questions.reduce((sum, q) => sum + (q.points || 10), 0);

    const finishQuiz = () => {
      isCompleted.val = true;
      markQuizSolved(quizId, true).then(() => {
        toast(t('dialogs_toast_quiz_solved'));
      });
    };

    if (isCompleted.val) {
      const finalScore = calculateScore();
      const pct = Math.round((finalScore / (maxScore || 1)) * 100);
      return div({ class: 'study-viewer-container' },
        div({ class: 'study-completed-card' },
          div({ class: 'study-completed-icon-wrapper' }, icon('check', 'study-completed-icon')),
          h2({ class: 'study-completed-title' }, () => t('dialogs_quiz_completed_title')),
          p({ class: 'study-completed-desc' }, qData.title),
          div({ class: 'study-score-box' },
            span({ class: 'study-score-label' }, () => t('dialogs_quiz_score_label')),
            div({ class: 'study-score-value' }, `${finalScore} / ${maxScore} (${pct}%)`),
          ),
          div({ class: 'study-completed-actions' },
            button({
              class: 'primary-button',
              onclick: () => {
                userAnswers.val = {};
                currentIndex.val = 0;
                isCompleted.val = false;
              },
            }, icon('compose'), span(() => t('dialogs_quiz_restart_btn'))),
            button({
              class: 'secondary-button',
              onclick: () => startTopicChat('quiz', qData.prompt),
            }, icon('chat'), span(() => t('dialogs_btn_chat'))),
            button({
              class: 'secondary-button',
              onclick: onBack,
            }, span(() => t('dialogs_back_to_list'))),
          ),
        ),
      );
    }

    return div({ class: 'study-viewer-container' },
      div({ class: 'study-header-nav' },
        button({ class: 'secondary-button study-back-btn', onclick: onBack },
          icon('chevron', 'study-back-icon'),
          span(() => t('dialogs_back_to_list')),
        ),
        div({ class: 'study-progress-badge' },
          () => `${t('dialogs_quiz_question_label')} ${currentIndex.val + 1} ${t('dialogs_quiz_of_label')} ${totalQuestions}`,
        ),
      ),
      div({ class: 'study-question-card' },
        h3({ class: 'study-question-title' }, currentQ.questionText || currentQ.question_text || ''),
        div({ class: 'study-options-list' },
          (currentQ.options || []).map(opt => {
            const isSelected = currentAnswer === opt.key;
            const isCorrect = opt.key === currentQ.correctAnswer;
            let optClass = 'study-option-button';
            if (currentAnswer) {
              if (isCorrect) optClass += ' option-correct';
              else if (isSelected) optClass += ' option-incorrect';
            }
            return button({
              class: optClass,
              disabled: Boolean(currentAnswer),
              onclick: () => {
                if (currentAnswer) return;
                userAnswers.val = { ...userAnswers.val, [currentIndex.val]: opt.key };
              },
            },
            span({ class: 'study-option-key' }, opt.key),
            span({ class: 'study-option-text' }, opt.text),
            );
          }),
        ),
        currentAnswer ? div({
          class: `study-feedback-box ${currentAnswer === currentQ.correctAnswer ? 'feedback-success' : 'feedback-error'}`,
        },
        div({ class: 'study-feedback-heading' },
          icon(currentAnswer === currentQ.correctAnswer ? 'check' : 'info'),
          span(() => currentAnswer === currentQ.correctAnswer ? t('dialogs_quiz_correct_feedback') : t('dialogs_quiz_incorrect_feedback')),
        ),
        currentQ.explanation ? div({ class: 'study-explanation-text' },
          span({ class: 'study-explanation-title' }, () => t('dialogs_quiz_explanation_label')),
          p(currentQ.explanation),
        ) : null,
        ) : null,
      ),
      div({ class: 'study-footer-nav' },
        button({
          class: 'secondary-button',
          disabled: currentIndex.val === 0,
          onclick: () => { currentIndex.val = Math.max(0, currentIndex.val - 1); },
        }, span(() => t('dialogs_quiz_prev_btn'))),
        currentIndex.val < totalQuestions - 1
          ? button({
            class: 'primary-button',
            onclick: () => { currentIndex.val = Math.min(totalQuestions - 1, currentIndex.val + 1); },
          }, span(() => t('dialogs_quiz_next_btn')))
          : button({
            class: 'primary-button',
            onclick: finishQuiz,
          }, icon('check'), span(() => t('dialogs_quiz_finish_btn'))),
      ),
    );
  };
}

export function MaterialReader(materialId, onBack) {
  const loading = van.state(true);
  const material = van.state(null);
  const currentSectionIndex = van.state(0);

  fetchMaterialDetails(materialId).then(data => {
    material.val = data;
    loading.val = false;
  }).catch(() => {
    loading.val = false;
  });

  return () => {
    if (loading.val) {
      return div({ class: 'study-viewer-loading' }, p(() => t('dialogs_material_loading')));
    }
    const mData = material.val;
    if (!mData) {
      return div({ class: 'study-viewer-empty' },
        p(() => t('dialogs_material_not_found')),
        button({ class: 'secondary-button', onclick: onBack }, span(() => t('dialogs_back_to_list'))),
      );
    }

    const sections = (mData.sections || []).map(normalizeMaterialSection).filter(Boolean);
    const totalSections = sections.length;
    const currentSec = sections[currentSectionIndex.val] || {};

    const markFinished = () => {
      markMaterialSolved(materialId, true).then(() => {
        toast(t('dialogs_toast_material_solved'));
      });
    };

    return div({ class: 'study-viewer-container' },
      div({ class: 'study-header-nav' },
        button({ class: 'secondary-button study-back-btn', onclick: onBack },
          icon('chevron', 'study-back-icon'),
          span(() => t('dialogs_back_to_list')),
        ),
        div({ class: 'study-progress-badge' },
          () => `${t('dialogs_material_section_label')} ${currentSectionIndex.val + 1} ${t('dialogs_quiz_of_label')} ${totalSections}`,
        ),
      ),
      div({ class: 'study-material-card' },
        div({ class: 'study-material-header' },
          h2({ class: 'study-material-title' }, currentSec.title || mData.title),
          span({ class: 'study-material-read-time' },
            `${currentSec.readTimeMinutes || currentSec.read_time_minutes || 2} ${t('dialogs_meta_read_time_suffix')}`,
          ),
        ),
        div({ class: 'study-material-body' },
          (currentSec.content || '').split('\n\n').map(paragraph => p({ class: 'study-material-para' }, paragraph)),
        ),
      ),
      div({ class: 'study-footer-nav' },
        button({
          class: 'secondary-button',
          disabled: currentSectionIndex.val === 0,
          onclick: () => { currentSectionIndex.val = Math.max(0, currentSectionIndex.val - 1); },
        }, span(() => t('dialogs_material_prev_btn'))),
        div({ class: 'study-footer-actions' },
          button({
            class: 'secondary-button',
            onclick: markFinished,
          }, icon('check'), span(() => t('dialogs_material_finish_btn'))),
          currentSectionIndex.val < totalSections - 1
            ? button({
              class: 'primary-button',
              onclick: () => { currentSectionIndex.val = Math.min(totalSections - 1, currentSectionIndex.val + 1); },
            }, span(() => t('dialogs_material_next_btn')))
            : button({
              class: 'secondary-button',
              onclick: () => startTopicChat('material', mData.prompt),
            }, icon('chat'), span(() => t('dialogs_btn_chat'))),
        ),
      ),
    );
  };
}
