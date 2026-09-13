import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  modal, chats, newChat, exportWorkspace,
  clearWorkspace, renameChat, deleteChat, startTopicChat,
} from '../state.js';
import { quizzes, materials } from '../studyModules.js';
import { t } from '../uiTexts.js';

const { dialog, div, h2, h3, p, span, button, label, form, input } = van.tags;

function formatTime(item) {
  if (item.timeType === 'today') {
    return `${t('dialogs_time_today')} · ${item.timeSuffix || '12:00'}`;
  }
  if (item.timeType === 'yesterday') {
    return t('dialogs_time_yesterday');
  }
  if (item.daysAgo) {
    return `${item.daysAgo} ${t('dialogs_time_days_ago_suffix')}`;
  }
  return t('dialogs_time_today');
}

function formatMeta(isQuiz, item) {
  if (isQuiz) {
    const qCount = item.question_count ?? item.questionCount ?? 5;
    return `${qCount} ${t('dialogs_meta_questions_suffix')} · ${t('dialogs_meta_multiple_choice')}`;
  }
  const pCount = item.section_count ?? item.part_count ?? item.partCount ?? 3;
  const rTime = item.estimated_read_time ?? item.readTimeMinutes ?? 4;
  return `${pCount} ${t('dialogs_meta_parts_suffix')} · ${rTime} ${t('dialogs_meta_read_time_suffix')}`;
}

function TopicList(type) {
  const isQuiz = type === 'quiz';
  const getItems = () => isQuiz ? quizzes.val : materials.val;

  return div({ class: 'topic-dialog-content' },
    p({ class: 'topic-dialog-desc' },
      () => isQuiz ? t('dialogs_quiz_desc') : t('dialogs_material_desc')),
    () => div({ class: 'topic-card-grid', role: 'list' },
      getItems().map(item => div({ class: 'topic-card', role: 'listitem' },
        div({ class: 'topic-card-body' },
          div({ class: 'topic-card-header' },
            span({ class: `topic-icon ${item.color || 'blue'}` }, icon(item.icon || 'bulb')),
            div({ class: 'topic-card-headline' },
              div({ class: 'topic-card-badges' },
                span({ class: `topic-category-pill ${item.color || 'blue'}` }, item.category || (item.categoryKey ? t(item.categoryKey) : '')),
                span({ class: 'topic-card-time' }, () => formatTime(item)),
              ),
              h3({ class: 'topic-card-title' }, item.title || (item.titleKey ? t(item.titleKey) : '')),
            ),
          ),
          p({ class: 'topic-card-summary' }, item.summary || (item.summaryKey ? t(item.summaryKey) : '')),
        ),
        div({ class: 'topic-card-footer' },
          span({ class: 'topic-card-meta' }, () => formatMeta(isQuiz, item)),
          button({
            type: 'button',
            class: 'secondary-button topic-open-btn',
            onclick: () => startTopicChat(type, item.prompt || (item.promptKey ? t(item.promptKey) : '')),
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
          ? span({ class: 'dialog-count-badge' }, () => `${(current.type === 'quiz' ? quizzes.val : materials.val).length} ${t('dialogs_modules_count_suffix')}`)
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
