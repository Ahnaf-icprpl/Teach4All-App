import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  modal, chats, newChat, exportWorkspace,
  clearWorkspace, renameChat, deleteChat, startTopicChat,
} from '../state.js';
import { t } from '../uiTexts.js';

const { dialog, div, h2, h3, p, span, button, label, form, input } = van.tags;

const MOCK_QUIZZES = [
  {
    titleKey: 'dialogs_mock_quiz_1_title',
    categoryKey: 'dialogs_cat_biology',
    summaryKey: 'dialogs_mock_quiz_1_summary',
    promptKey: 'dialogs_mock_quiz_1_prompt',
    questionCount: 5,
    metaKey: 'dialogs_meta_multiple_choice',
    timeType: 'today',
    timeSuffix: '14:20',
    icon: 'leaf',
    color: 'green',
  },
  {
    titleKey: 'dialogs_mock_quiz_2_title',
    categoryKey: 'dialogs_cat_astronomy',
    summaryKey: 'dialogs_mock_quiz_2_summary',
    promptKey: 'dialogs_mock_quiz_2_prompt',
    questionCount: 5,
    metaKey: 'dialogs_meta_multiple_choice',
    timeType: 'today',
    timeSuffix: '11:05',
    icon: 'globe',
    color: 'blue',
  },
  {
    titleKey: 'dialogs_mock_quiz_3_title',
    categoryKey: 'dialogs_cat_math',
    summaryKey: 'dialogs_mock_quiz_3_summary',
    promptKey: 'dialogs_mock_quiz_3_prompt',
    questionCount: 5,
    metaKey: 'dialogs_meta_structured_logic',
    timeType: 'yesterday',
    icon: 'bulb',
    color: 'purple',
  },
  {
    titleKey: 'dialogs_mock_quiz_4_title',
    categoryKey: 'dialogs_cat_basic_science',
    summaryKey: 'dialogs_mock_quiz_4_summary',
    promptKey: 'dialogs_mock_quiz_4_prompt',
    questionCount: 5,
    metaKey: 'dialogs_meta_applied_science',
    timeType: 'yesterday',
    icon: 'spark',
    color: 'amber',
  },
  {
    titleKey: 'dialogs_mock_quiz_5_title',
    categoryKey: 'dialogs_cat_self_development',
    summaryKey: 'dialogs_mock_quiz_5_summary',
    promptKey: 'dialogs_mock_quiz_5_prompt',
    questionCount: 5,
    metaKey: 'dialogs_meta_self_reflection',
    timeType: 'days_ago',
    daysAgo: 2,
    icon: 'plan',
    color: 'blue',
  },
];

const MOCK_MATERIALS = [
  {
    titleKey: 'dialogs_mock_mat_1_title',
    categoryKey: 'dialogs_cat_biology',
    summaryKey: 'dialogs_mock_mat_1_summary',
    promptKey: 'dialogs_mock_mat_1_prompt',
    partCount: 3,
    readTimeMinutes: 4,
    timeType: 'today',
    timeSuffix: '13:45',
    icon: 'leaf',
    color: 'green',
  },
  {
    titleKey: 'dialogs_mock_mat_2_title',
    categoryKey: 'dialogs_cat_astronomy',
    summaryKey: 'dialogs_mock_mat_2_summary',
    promptKey: 'dialogs_mock_mat_2_prompt',
    partCount: 4,
    readTimeMinutes: 6,
    timeType: 'today',
    timeSuffix: '09:30',
    icon: 'globe',
    color: 'blue',
  },
  {
    titleKey: 'dialogs_mock_mat_3_title',
    categoryKey: 'dialogs_cat_math',
    summaryKey: 'dialogs_mock_mat_3_summary',
    promptKey: 'dialogs_mock_mat_3_prompt',
    partCount: 3,
    readTimeMinutes: 5,
    timeType: 'yesterday',
    icon: 'bulb',
    color: 'purple',
  },
  {
    titleKey: 'dialogs_mock_mat_4_title',
    categoryKey: 'dialogs_cat_self_development',
    summaryKey: 'dialogs_mock_mat_4_summary',
    promptKey: 'dialogs_mock_mat_4_prompt',
    partCount: 3,
    readTimeMinutes: 4,
    timeType: 'yesterday',
    icon: 'plan',
    color: 'amber',
  },
  {
    titleKey: 'dialogs_mock_mat_5_title',
    categoryKey: 'dialogs_cat_literacy_science',
    summaryKey: 'dialogs_mock_mat_5_summary',
    promptKey: 'dialogs_mock_mat_5_prompt',
    partCount: 3,
    readTimeMinutes: 5,
    timeType: 'days_ago',
    daysAgo: 3,
    icon: 'book',
    color: 'blue',
  },
];

function formatTime(item) {
  if (item.timeType === 'today') {
    return `${t('dialogs_time_today')} · ${item.timeSuffix}`;
  }
  if (item.timeType === 'yesterday') {
    return t('dialogs_time_yesterday');
  }
  return `${item.daysAgo} ${t('dialogs_time_days_ago_suffix')}`;
}

function formatMeta(isQuiz, item) {
  if (isQuiz) {
    return `${item.questionCount} ${t('dialogs_meta_questions_suffix')} · ${t(item.metaKey)}`;
  }
  return `${item.partCount} ${t('dialogs_meta_parts_suffix')} · ${item.readTimeMinutes} ${t('dialogs_meta_read_time_suffix')}`;
}

function TopicList(type) {
  const isQuiz = type === 'quiz';
  const items = isQuiz ? MOCK_QUIZZES : MOCK_MATERIALS;

  return div({ class: 'topic-dialog-content' },
    p({ class: 'topic-dialog-desc' },
      () => isQuiz ? t('dialogs_quiz_desc') : t('dialogs_material_desc')),
    div({ class: 'topic-card-grid', role: 'list' },
      items.map(item => div({ class: 'topic-card', role: 'listitem' },
        div({ class: 'topic-card-body' },
          div({ class: 'topic-card-header' },
            span({ class: `topic-icon ${item.color}` }, icon(item.icon)),
            div({ class: 'topic-card-headline' },
              div({ class: 'topic-card-badges' },
                span({ class: `topic-category-pill ${item.color}` }, () => t(item.categoryKey)),
                span({ class: 'topic-card-time' }, () => formatTime(item)),
              ),
              h3({ class: 'topic-card-title' }, () => t(item.titleKey)),
            ),
          ),
          p({ class: 'topic-card-summary' }, () => t(item.summaryKey)),
        ),
        div({ class: 'topic-card-footer' },
          span({ class: 'topic-card-meta' }, () => formatMeta(isQuiz, item)),
          button({
            type: 'button',
            class: 'secondary-button topic-open-btn',
            onclick: () => startTopicChat(type, t(item.promptKey)),
          }, span(() => isQuiz ? t('dialogs_quiz_start_button') : t('dialogs_material_open_button')), icon('arrowRight')),
        ),
      )),
    ),
  );
}

function Tools() {
  const closeAnd = action => () => { modal.val = null; action(); };
  return div({ class: 'tools-content' },
    button({ class: 'tool-row', onclick: closeAnd(newChat) }, icon('plus'), span(() => t('dialogs_tools_new_chat'))),
    button({ class: 'tool-row', onclick: closeAnd(exportWorkspace) }, icon('download'), span(() => t('dialogs_tools_export'))),
  );
}

function Conversation(id) {
  const chat = chats.val.find(item => item.id === id);
  if (!chat) return p(() => t('dialogs_conversation_unavailable'));
  const titleInput = input({ id: 'conversation-title', value: chat.title, maxlength: 100, required: true, autocomplete: 'off' });
  return form({ onsubmit: event => { event.preventDefault(); renameChat(id, titleInput.value); } },
    label({ for: 'conversation-title', class: 'field-label' }, () => t('dialogs_conversation_title_label')), titleInput,
    div({ class: 'dialog-actions' },
      button({ type: 'button', class: 'secondary-button danger-text', onclick: () => { modal.val = { type: 'delete', id }; } }, icon('trash'), () => t('dialogs_delete_button')),
      button({ type: 'submit', class: 'primary-button' }, () => t('dialogs_save_name_button')),
    ),
  );
}

function Confirm(type, id) {
  return div(
    p(type === 'clear'
      ? () => t('dialogs_clear_warning')
      : () => t('dialogs_delete_warning')),
    div({ class: 'dialog-actions' },
      button({ class: 'secondary-button', onclick: () => { modal.val = null; } }, () => t('dialogs_cancel_button')),
      button({ class: 'danger-button', onclick: () => type === 'clear' ? clearWorkspace() : deleteChat(id) },
        type === 'clear' ? () => t('dialogs_clear_confirm_button') : () => t('dialogs_delete_confirm_button')),
    ),
  );
}

export function Dialogs() {
  const getTitles = () => ({
    tools: t('dialogs_title_tools'),
    conversation: t('dialogs_title_conversation'),
    clear: t('dialogs_title_clear'),
    delete: t('dialogs_title_delete'),
    quiz: t('dialogs_title_quiz'),
    material: t('dialogs_title_material'),
  });

  return () => {
    const current = modal.val;
    if (!current) return div({ hidden: true });
    const previousFocus = document.activeElement;
    const content = current.type === 'tools' ? Tools()
      : current.type === 'conversation' ? Conversation(current.id)
      : (current.type === 'quiz' || current.type === 'material') ? TopicList(current.type)
      : Confirm(current.type, current.id);
    const isTopicDialog = current.type === 'quiz' || current.type === 'material';
    const element = dialog({
      class: `app-dialog ${isTopicDialog ? 'dialog-wide' : ''}`, 'aria-labelledby': 'dialog-title',
      oncancel: event => { event.preventDefault(); modal.val = null; },
      onclick: event => {
        if (event.target !== element) return;
        const box = element.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.val = null;
      },
    },
    div({ class: 'dialog-heading' },
      div({ class: 'dialog-heading-text' },
        h2({ id: 'dialog-title' }, () => getTitles()[current.type]),
        isTopicDialog
          ? span({ class: 'dialog-count-badge' }, () => `${(current.type === 'quiz' ? MOCK_QUIZZES : MOCK_MATERIALS).length} ${t('dialogs_modules_count_suffix')}`)
          : null,
      ),
      button({ class: 'icon-button', 'aria-label': () => t('dialogs_close_aria'), onclick: () => { modal.val = null; } }, icon('close'))),
    content,
    );
    requestAnimationFrame(() => { if (element.isConnected) element.showModal(); });
    // Native dialog handles focus trapping; restore the opener when Van removes it.
    const observer = new MutationObserver(() => {
      if (element.isConnected) return;
      observer.disconnect();
      if (!modal.val && previousFocus?.isConnected) previousFocus.focus();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return element;
  };
}
