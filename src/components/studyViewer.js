import van from 'vanjs-core';
import { icon } from '../icons.js';
import { startTopicChat, toast } from '../state.js';
import {
  fetchQuizDetails,
  markQuizSolved,
  normalizeQuizQuestion,
  shuffleArray,
  loadLocalQuizProgress,
  saveLocalQuizProgress,
  clearLocalQuizProgress,
  syncQuizProgressToServer,
} from '../studyModules.js';
import { t } from '../uiTexts.js';
import { getAuthHeaders } from '../auth.js';
import { QuizClueStick, generateLocalClue } from './quizStick.js';
export { MaterialReader } from './materialReader.js';

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

  const localProg = loadLocalQuizProgress(quizId);
  if (localProg?.userAnswers && typeof localProg.userAnswers === 'object') {
    userAnswers.val = { ...localProg.userAnswers };
  }

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

    if (!q.id) {
      const local = generateLocalClue(q);
      q.clue = local;
      cluesCache[idx] = local;
      clueText.val = local;
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
    if (!data) return;

    const questions = Array.isArray(data.questions) ? data.questions : [];
    const totalQ = questions.length;
    const serverAnswers = (data.user_answers && typeof data.user_answers === 'object') ? data.user_answers : {};
    const mergedAnswers = { ...serverAnswers, ...userAnswers.val };
    userAnswers.val = mergedAnswers;

    let firstUnfinishedIdx = -1;
    for (let i = 0; i < totalQ; i++) {
      if (mergedAnswers[i] === undefined || mergedAnswers[i] === null) {
        firstUnfinishedIdx = i;
        break;
      }
    }

    if (totalQ > 0 && firstUnfinishedIdx === -1) {
      isCompleted.val = true;
      currentIndex.val = 0;
      currentQNum.val = 1;
    } else {
      isCompleted.val = false;
      const targetIdx = firstUnfinishedIdx !== -1 ? firstUnfinishedIdx : 0;
      currentIndex.val = targetIdx;
      currentQNum.val = targetIdx + 1;
      if (showClueStick.val) {
        fetchClueForQuestion(targetIdx);
      }
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
      showClueStick.val = false;
      isCompleted.val = true;
      saveLocalQuizProgress(quizId, {
        lastQuestionIndex: currentIndex.val,
        userAnswers: userAnswers.val,
        isSolved: true,
      });
      syncQuizProgressToServer(quizId, {
        lastQuestionIndex: currentIndex.val,
        userAnswers: userAnswers.val,
        isSolved: true,
      });
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
                currentQNum.val = 1;
                showClueStick.val = false;
                isCompleted.val = false;
                clearLocalQuizProgress(quizId);
                syncQuizProgressToServer(quizId, {
                  lastQuestionIndex: 0,
                  userAnswers: {},
                  isSolved: false,
                });
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
                const newAnswers = { ...userAnswers.val, [currentIndex.val]: opt.id };
                // 1st priority: instant client side validation
                userAnswers.val = newAnswers;

                saveLocalQuizProgress(quizId, {
                  lastQuestionIndex: currentIndex.val,
                  userAnswers: newAnswers,
                });

                syncQuizProgressToServer(quizId, {
                  lastQuestionIndex: currentIndex.val,
                  userAnswers: newAnswers,
                });
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
            showClueStick.val = false;
            saveLocalQuizProgress(quizId, {
              lastQuestionIndex: nextIdx,
              userAnswers: userAnswers.val,
            });
            syncQuizProgressToServer(quizId, {
              lastQuestionIndex: nextIdx,
              userAnswers: userAnswers.val,
            });
          },
        }, span(() => t('dialogs_quiz_prev_btn'))),
        currentIndex.val < totalQuestions - 1
          ? button({
            class: 'primary-button',
            onclick: () => {
              const nextIdx = Math.min(totalQuestions - 1, currentIndex.val + 1);
              currentIndex.val = nextIdx;
              currentQNum.val = nextIdx + 1;
              showClueStick.val = false;
              saveLocalQuizProgress(quizId, {
                lastQuestionIndex: nextIdx,
                userAnswers: userAnswers.val,
              });
              syncQuizProgressToServer(quizId, {
                lastQuestionIndex: nextIdx,
                userAnswers: userAnswers.val,
              });
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
