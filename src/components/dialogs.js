import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  modal, chats, newChat, exportWorkspace,
  clearWorkspace, renameChat, deleteChat, startTopicChat, toast,
} from '../state.js';
import {
  quizzes, materials, markQuizSolved, markMaterialSolved,
  fetchQuizzes, fetchMaterials,
} from '../studyModules.js';
import { QuizSolver, MaterialReader } from './studyViewer.js';
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
  const filter = van.state('all');
  const searchQuery = van.state('');
  const searchResults = van.state(null);
  let debounceTimer = null;

  const toggleSolved = async (item) => {
    const isCurrentlySolved = Boolean(item.is_solved || item.isSolved);
    const nextSolved = !isCurrentlySolved;
    if (isQuiz) {
      await markQuizSolved(item.id, nextSolved);
      if (searchResults.val) {
        searchResults.val = searchResults.val.map(q => (q.id === item.id ? { ...q, is_solved: nextSolved, isSolved: nextSolved } : q));
      }
      toast(nextSolved ? t('dialogs_toast_quiz_solved') : t('dialogs_toast_quiz_unsolved'));
    } else {
      await markMaterialSolved(item.id, nextSolved);
      if (searchResults.val) {
        searchResults.val = searchResults.val.map(m => (m.id === item.id ? { ...m, is_solved: nextSolved, isSolved: nextSolved, is_completed: nextSolved, isCompleted: nextSolved } : m));
      }
      toast(nextSolved ? t('dialogs_toast_material_solved') : t('dialogs_toast_material_unsolved'));
    }
  };

  const getBaseList = () => {
    const base = isQuiz ? quizzes.val : materials.val;
    if (searchResults.val !== null) {
      return searchResults.val;
    }
    const q = searchQuery.val.trim().toLowerCase();
    if (!q) return base;
    return base.filter(item =>
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.summary && item.summary.toLowerCase().includes(q)) ||
      (item.category && item.category.toLowerCase().includes(q))
    );
  };

  const getFilteredItems = () => {
    const list = getBaseList();
    if (filter.val === 'solved') {
      return list.filter(item => Boolean(item.is_solved || item.isSolved));
    }
    if (filter.val === 'unsolved') {
      return list.filter(item => !item.is_solved && !item.isSolved);
    }
    return list;
  };

  const onSearchInput = (e) => {
    const value = e.target.value;
    searchQuery.val = value;
    clearTimeout(debounceTimer);
    const trimmed = value.trim();
    if (!trimmed) {
      searchResults.val = null;
      return;
    }
    debounceTimer = setTimeout(async () => {
      const results = isQuiz
        ? await fetchQuizzes({ search: trimmed })
        : await fetchMaterials({ search: trimmed });
      if (searchQuery.val.trim() === trimmed) {
        searchResults.val = results;
      }
    }, 250);
  };

  const clearSearch = (inputEl) => {
    clearTimeout(debounceTimer);
    searchQuery.val = '';
    searchResults.val = null;
    if (inputEl) {
      inputEl.value = '';
      inputEl.focus();
    }
  };

  const searchInputEl = input({
    type: 'search',
    class: 'topic-search-input',
    placeholder: () => isQuiz ? t('dialogs_search_quiz_placeholder') : t('dialogs_search_material_placeholder'),
    'aria-label': () => t('dialogs_search_aria'),
    oninput: onSearchInput,
    onsearch: (e) => { if (!e.target.value) clearSearch(e.target); },
  });

  return div({ class: 'topic-dialog-content' },
    p({ class: 'topic-dialog-desc' },
      () => isQuiz ? t('dialogs_quiz_desc') : t('dialogs_material_desc')),
    div({ class: 'topic-search-field' },
      icon('search', 'topic-search-icon'),
      searchInputEl,
      () => searchQuery.val ? button({
        type: 'button',
        class: 'topic-search-clear',
        'aria-label': () => t('dialogs_close_aria'),
        onclick: () => clearSearch(searchInputEl),
      }, icon('close')) : null,
    ),
    div({ class: 'study-filter-tabs', role: 'tablist' },
      button({
        type: 'button',
        role: 'tab',
        class: () => `study-filter-tab ${filter.val === 'all' ? 'active' : ''}`,
        'aria-selected': () => filter.val === 'all',
        onclick: () => { filter.val = 'all'; },
      },
      span(() => t('dialogs_filter_all')),
      span({ class: 'study-filter-badge' }, () => getBaseList().length),
      ),
      button({
        type: 'button',
        role: 'tab',
        class: () => `study-filter-tab ${filter.val === 'unsolved' ? 'active' : ''}`,
        'aria-selected': () => filter.val === 'unsolved',
        onclick: () => { filter.val = 'unsolved'; },
      },
      span(() => t('dialogs_filter_unsolved')),
      span({ class: 'study-filter-badge' }, () => getBaseList().filter(item => !(item.is_solved || item.isSolved)).length),
      ),
      button({
        type: 'button',
        role: 'tab',
        class: () => `study-filter-tab ${filter.val === 'solved' ? 'active' : ''}`,
        'aria-selected': () => filter.val === 'solved',
        onclick: () => { filter.val = 'solved'; },
      },
      span(() => t('dialogs_filter_solved')),
      span({ class: 'study-filter-badge' }, () => getBaseList().filter(item => Boolean(item.is_solved || item.isSolved)).length),
      ),
    ),
    () => {
      const items = getFilteredItems();
      if (!items.length) {
        return div({ class: 'topic-empty-state' },
          p(() => t('dialogs_empty_filter')),
        );
      }
      return div({ class: 'topic-card-grid', role: 'list' },
        items.map(item => {
          const solved = Boolean(item.is_solved || item.isSolved);
          return div({ class: `topic-card ${solved ? 'is-solved' : ''}`, role: 'listitem' },
            div({ class: 'topic-card-body' },
              div({ class: 'topic-card-header' },
                span({ class: `topic-icon ${item.color || 'blue'}` }, icon(item.icon || 'bulb')),
                div({ class: 'topic-card-headline' },
                  div({ class: 'topic-card-badges' },
                    span({ class: `topic-category-pill ${item.color || 'blue'}` }, item.category || ''),
                    button({
                      type: 'button',
                      class: `topic-solved-toggle ${solved ? 'is-solved' : ''}`,
                      'aria-label': () => solved ? t('dialogs_btn_mark_unsolved') : t('dialogs_btn_mark_solved'),
                      title: () => solved ? t('dialogs_btn_mark_unsolved') : t('dialogs_btn_mark_solved'),
                      onclick: (e) => { e.stopPropagation(); toggleSolved(item); },
                    },
                    solved ? icon('check', 'topic-solved-icon') : null,
                    span(() => solved ? t('dialogs_status_solved') : t('dialogs_btn_mark_solved')),
                    ),
                    span({ class: 'topic-card-time' }, () => formatTime(item)),
                  ),
                  h3({ class: 'topic-card-title' }, item.title || ''),
                ),
              ),
              p({ class: 'topic-card-summary' }, item.summary || ''),
            ),
            div({ class: 'topic-card-footer' },
              span({ class: 'topic-card-meta' }, () => formatMeta(isQuiz, item)),
              div({ class: 'topic-card-actions' },
                button({
                  type: 'button',
                  class: 'secondary-button topic-chat-btn',
                  'aria-label': () => t('dialogs_btn_chat'),
                  title: () => t('dialogs_btn_chat'),
                  onclick: () => startTopicChat(type, item.prompt || ''),
                }, icon('chat'), span(() => t('dialogs_btn_chat'))),
                button({
                  type: 'button',
                  class: 'primary-button topic-open-btn',
                  onclick: () => {
                    modal.val = { type: isQuiz ? 'quiz-solver' : 'material-reader', id: item.id };
                  },
                },
                span(() => isQuiz ? t('dialogs_btn_solve') : t('dialogs_btn_read')),
                icon('arrowRight'),
                ),
              ),
            ),
          );
        }),
      );
    },
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
    'quiz-solver': t('dialogs_title_quiz'),
    'material-reader': t('dialogs_title_material'),
  });

  return () => {
    const current = modal.val;
    if (!current) return div({ hidden: true });
    const previousFocus = document.activeElement;
    const content = current.type === 'tools' ? Tools()
      : current.type === 'conversation' ? Conversation(current.id)
      : (current.type === 'quiz' || current.type === 'material') ? TopicList(current.type)
      : current.type === 'quiz-solver' ? QuizSolver(current.id)
      : current.type === 'material-reader' ? MaterialReader(current.id)
      : Confirm(current.type, current.id);
    const isTopicDialog = current.type === 'quiz' || current.type === 'material' || current.type === 'quiz-solver' || current.type === 'material-reader';
    const isTopicList = current.type === 'quiz' || current.type === 'material';
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
        isTopicList
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
