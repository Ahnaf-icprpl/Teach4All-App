import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  modal, chats, newChat, exportWorkspace,
  clearWorkspace, renameChat, deleteChat, startTopicChat,
} from '../state.js';
import { t } from '../uiTexts.js';

const { dialog, div, h2, h3, p, span, button, label, form, input } = van.tags;

const QUIZ_TOPICS = [
  {
    title: 'Sains & Pengetahuan Umum',
    detail: 'Uji pemahaman konsep sains dasar dan fakta menarik (5 soal)',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Sains dan Pengetahuan Umum',
    icon: 'spark',
    color: 'amber',
  },
  {
    title: 'Fotosintesis & Tumbuhan',
    detail: 'Kuis seputar daun, klorofil, dan pemanfaatan sinar matahari (5 soal)',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Fotosintesis dan Tumbuhan',
    icon: 'leaf',
    color: 'green',
  },
  {
    title: 'Tata Surya & Astronomi',
    detail: 'Kuis seputar planet, orbit, dan benda langit di tata surya (5 soal)',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Tata Surya dan Astronomi',
    icon: 'globe',
    color: 'blue',
  },
  {
    title: 'Matematika & Pemecahan Masalah',
    detail: 'Kuis logika berhitung dan penalaran matematika terstruktur (5 soal)',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Matematika dan Pemecahan Masalah',
    icon: 'bulb',
    color: 'purple',
  },
];

const MATERIAL_TOPICS = [
  {
    title: 'Fotosintesis & Tumbuhan',
    detail: 'Pelajari konsep dapur bertenaga surya dan peran penting oksigen',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Fotosintesis',
    icon: 'leaf',
    color: 'green',
  },
  {
    title: 'Tata Surya & Astronomi',
    detail: 'Ringkasan susunan tata surya, revolusi planet, dan gravitasi',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Tata Surya',
    icon: 'globe',
    color: 'blue',
  },
  {
    title: 'Metode & Rencana Belajar',
    detail: 'Pilar belajar efektif, konsistensi harian, dan evaluasi mandiri',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Rencana dan Metode Belajar',
    icon: 'plan',
    color: 'purple',
  },
  {
    title: 'Pemecahan Masalah Matematika',
    detail: 'Langkah terarah membedah soal rumit menjadi bagian-bagian sederhana',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Pemecahan Masalah Matematika',
    icon: 'bulb',
    color: 'amber',
  },
];

function TopicList(type) {
  const isQuiz = type === 'quiz';
  const topics = isQuiz ? QUIZ_TOPICS : MATERIAL_TOPICS;
  const customInput = input({
    type: 'text',
    class: 'topic-custom-input',
    placeholder: () => isQuiz ? t('dialogs_topic_custom_quiz') : t('dialogs_topic_custom_material'),
    'aria-label': () => isQuiz ? t('dialogs_topic_custom_quiz') : t('dialogs_topic_custom_material'),
  });

  const onCustomSubmit = event => {
    event.preventDefault();
    const val = customInput.value.trim();
    if (val) startTopicChat(type, val);
  };

  return div({ class: 'topic-dialog-content' },
    p({ class: 'topic-dialog-desc' },
      () => isQuiz ? t('dialogs_quiz_desc') : t('dialogs_material_desc')),
    div({ class: 'topic-list', role: 'list' },
      topics.map(item => button({
        type: 'button',
        class: 'topic-item',
        onclick: () => startTopicChat(type, item.prompt),
      },
        span({ class: `topic-icon ${item.color}` }, icon(item.icon)),
        div({ class: 'topic-meta' },
          span({ class: 'topic-title' }, item.title),
          span({ class: 'topic-detail' }, item.detail),
        ),
        icon('arrowRight', 'topic-arrow'),
      )),
    ),
    form({ class: 'topic-custom-form', onsubmit: onCustomSubmit },
      customInput,
      button({ type: 'submit', class: 'primary-button topic-submit-btn' },
        icon('plus'), span(() => t('dialogs_topic_open_button'))),
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
    const element = dialog({
      class: 'app-dialog', 'aria-labelledby': 'dialog-title',
      oncancel: event => { event.preventDefault(); modal.val = null; },
      onclick: event => {
        if (event.target !== element) return;
        const box = element.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.val = null;
      },
    },
    div({ class: 'dialog-heading' }, h2({ id: 'dialog-title' }, () => getTitles()[current.type]),
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
