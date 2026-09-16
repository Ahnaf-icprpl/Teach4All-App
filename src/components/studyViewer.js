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
  shuffleArray,
} from '../studyModules.js';
import { t } from '../uiTexts.js';
import { renderMarkdown } from '../markdown.js';
import { getAuthHeaders } from '../auth.js';
import { QuizClueStick, generateLocalClue } from './quizStick.js';

const { div, h2, h3, p, span, button } = van.tags;

export function QuizSolver(quizId, { initialClue = false } = {}) {
  const loading = van.state(true);
  const quiz = van.state(null);
  const currentIndex = van.state(0);
  const userAnswers = van.state({});
  const isCompleted = van.state(false);
  const showClueStick = van.state(Boolean(initialClue));
  const clueLoading = van.state(false);
  const clueText = van.state('');
  const cluesCache = {};
  const currentQNum = van.state(1);

  const fetchClueForQuestion = async (idx = currentIndex.val) => {
    currentQNum.val = idx + 1;
    const qList = Array.isArray(quiz.val?.questions) ? quiz.val.questions : [];
    const q = qList[idx];
    if (!q) return;

    if (q.clue && q.clue.trim()) {
      cluesCache[idx] = q.clue.trim();
      clueText.val = q.clue.trim();
      clueLoading.val = false;
      return;
    }
    if (cluesCache[idx]) {
      clueText.val = cluesCache[idx];
      clueLoading.val = false;
      return;
    }

    clueLoading.val = true;
    try {
      const res = await fetch('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          action: 'clue',
          questionId: q.id,
          questionText: q.questionText || q.question_text || '',
          options: (q.options || []).map(o => o.text || o),
          explanation: q.explanation || '',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.clue) {
          const c = data.clue.trim();
          q.clue = c;
          cluesCache[idx] = c;
          clueText.val = c;
          clueLoading.val = false;
          return;
        }
      }
    } catch {}

    const local = generateLocalClue(q);
    q.clue = local;
    cluesCache[idx] = local;
    clueText.val = local;
    clueLoading.val = false;
  };

  const toggleClueStick = () => {
    showClueStick.val = !showClueStick.val;
    if (showClueStick.val) {
      fetchClueForQuestion(currentIndex.val);
    }
  };

  fetchQuizDetails(quizId, { shuffle: true }).then(data => {
    quiz.val = data;
    loading.val = false;
    if (showClueStick.val) {
      fetchClueForQuestion(0);
    }
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
      );
    }

    const questions = Array.isArray(qData.questions) ? qData.questions : [];
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
                if (quiz.val && Array.isArray(quiz.val.questions)) {
                  quiz.val = {
                    ...quiz.val,
                    questions: quiz.val.questions.map(q => ({
                      ...q,
                      options: shuffleArray(q.options),
                    })),
                  };
                }
              },
            }, icon('compose'), span(() => t('dialogs_quiz_restart_btn'))),
            button({
              class: 'secondary-button',
              onclick: () => startTopicChat('quiz', qData.prompt),
            }, icon('chat'), span(() => t('dialogs_btn_chat'))),
          ),
        ),
      );
    }

    return div({ class: 'study-viewer-container' },
      div({ class: 'study-header-nav' },
        button({
          type: 'button',
          class: () => `study-tanya-ai-btn secondary-button ${showClueStick.val ? 'active' : ''}`,
          'aria-label': () => t('dialogs_btn_chat'),
          title: () => t('dialogs_btn_chat'),
          onclick: toggleClueStick,
        }, icon('spark', 'tanya-ai-spark-icon'), span(() => t('dialogs_btn_chat'))),
        div({ class: 'study-progress-badge' },
          () => `${t('dialogs_quiz_question_label')} ${currentIndex.val + 1} ${t('dialogs_quiz_of_label')} ${totalQuestions}`,
        ),
      ),
      QuizClueStick({
        isOpen: showClueStick,
        loading: clueLoading,
        clueText,
        questionNumber: currentQNum,
        onClose: () => { showClueStick.val = false; },
      }),
      div({ class: 'study-question-card' },
        h3({ class: 'study-question-title' }, currentQ.questionText || currentQ.question_text || ''),
        div({ class: 'study-options-list' },
          (currentQ.options || []).map((opt, optIndex) => {
            const hasAnswered = currentAnswer !== undefined && currentAnswer !== null;
            const isSelected = hasAnswered && currentAnswer === opt.id;
            const isCorrect = opt.id === currentQ.correctAnswer;
            let optClass = 'study-option-button';
            if (hasAnswered) {
              if (isCorrect) optClass += ' option-correct';
              else if (isSelected) optClass += ' option-incorrect';
            }
            return button({
              class: optClass,
              disabled: hasAnswered,
              onclick: () => {
                if (hasAnswered) return;
                userAnswers.val = { ...userAnswers.val, [currentIndex.val]: opt.id };
              },
            },
            span({ class: 'study-option-key' }, String(optIndex + 1)),
            span({ class: 'study-option-text' }, opt.text),
            );
          }),
        ),
        (currentAnswer !== undefined && currentAnswer !== null) ? div({
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
          onclick: () => {
            const nextIdx = Math.max(0, currentIndex.val - 1);
            currentIndex.val = nextIdx;
            currentQNum.val = nextIdx + 1;
            if (showClueStick.val) fetchClueForQuestion(nextIdx);
          },
        }, span(() => t('dialogs_quiz_prev_btn'))),
        currentIndex.val < totalQuestions - 1
          ? button({
            class: 'primary-button',
            onclick: () => {
              const nextIdx = Math.min(totalQuestions - 1, currentIndex.val + 1);
              currentIndex.val = nextIdx;
              currentQNum.val = nextIdx + 1;
              if (showClueStick.val) fetchClueForQuestion(nextIdx);
            },
          }, span(() => t('dialogs_quiz_next_btn')))
          : button({
            class: 'primary-button',
            onclick: finishQuiz,
          }, icon('check'), span(() => t('dialogs_quiz_finish_btn'))),
      ),
    );
  };
}

export function MaterialReader(materialId) {
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
          renderMarkdown(currentSec.content || ''),
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
