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
    title: 'Kuis Fotosintesis & Reaksi Terang',
    category: 'Biologi',
    summary: 'Evaluasi 5 soal tentang kloroplas, penyerapan foton matahari, siklus Calvin, dan pelepasan oksigen.',
    meta: '5 Soal · Pilihan Ganda',
    time: 'Hari ini · 14:20',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Fotosintesis dan Reaksi Terang',
    icon: 'leaf',
    color: 'green',
  },
  {
    title: 'Kuis Tata Surya & Karakteristik Planet',
    category: 'Astronomi',
    summary: 'Uji pemahaman tentang planet kebumian, planet gas raksasa, orbit elips, dan gravitasi Matahari.',
    meta: '5 Soal · Pilihan Ganda',
    time: 'Hari ini · 11:05',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Tata Surya dan Karakteristik Planet',
    icon: 'globe',
    color: 'blue',
  },
  {
    title: 'Kuis Penalaran Matematika & Logika',
    category: 'Matematika',
    summary: 'Soal penalaran proporsional, pola deret angka, dan pemecahan masalah bertahap.',
    meta: '5 Soal · Logika Terarah',
    time: 'Kemarin',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Matematika dan Logika Bertahap',
    icon: 'bulb',
    color: 'purple',
  },
  {
    title: 'Kuis Pengetahuan Sains & Alam Sekitar',
    category: 'Sains Dasar',
    summary: 'Pertanyaan seputar wujud zat, siklus air, perubahan energi, dan gaya gesek di lingkungan sekitar.',
    meta: '5 Soal · Sains Terapan',
    time: 'Kemarin',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Sains dan Alam Sekitar',
    icon: 'spark',
    color: 'amber',
  },
  {
    title: 'Kuis Metode & Manajemen Waktu Belajar',
    category: 'Pengembangan Diri',
    summary: 'Refleksi penerapan teknik active recall, spaced repetition, dan strategi fokus pomodoro.',
    meta: '5 Soal · Refleksi Diri',
    time: '2 hari lalu',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Rencana dan Metode Belajar',
    icon: 'plan',
    color: 'blue',
  },
];

const MOCK_MATERIALS = [
  {
    title: 'Ringkasan Fotosintesis: Dapur Bertenaga Surya',
    category: 'Biologi',
    summary: 'Uraian terstruktur tentang struktur daun, konversi foton menjadi glukosa, dan peran krusial klorofil.',
    meta: '3 Bagian · 4 mnt baca',
    time: 'Hari ini · 13:45',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Fotosintesis',
    icon: 'leaf',
    color: 'green',
  },
  {
    title: 'Arsitektur Tata Surya & Hukum Gravitasi',
    category: 'Astronomi',
    summary: 'Susunan planet dalam dan planet luar, pengaruh orbit elips Kepler, serta karakteristik sabuk asteroid.',
    meta: '4 Bagian · 6 mnt baca',
    time: 'Hari ini · 09:30',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Tata Surya',
    icon: 'globe',
    color: 'blue',
  },
  {
    title: 'Kerangka 5 Langkah Pemecahan Masalah Matematika',
    category: 'Matematika',
    summary: 'Langkah terarah membedah soal rumit: pemahaman premis, pembuatan model, penyelesaian, dan validasi.',
    meta: '3 Bagian · 5 mnt baca',
    time: 'Kemarin',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Pemecahan Masalah Matematika',
    icon: 'bulb',
    color: 'purple',
  },
  {
    title: 'Strategi Belajar Efektif & Retensi Memori',
    category: 'Pengembangan Diri',
    summary: 'Panduan active recall, teknik Feynman sederhana, dan cara mengatasi kurva lupa Ebbinghaus secara konsisten.',
    meta: '3 Bagian · 4 mnt baca',
    time: 'Kemarin',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Rencana dan Metode Belajar',
    icon: 'plan',
    color: 'amber',
  },
  {
    title: 'Prinsip Berpikir Kritis & Literasi Informasi',
    category: 'Literasi & Sains',
    summary: 'Tiga pilar verifikasi argumen ilmiah, pengujian data, dan pembedaan kausalitas dari korelasi semu.',
    meta: '3 Bagian · 5 mnt baca',
    time: '3 hari lalu',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Sains dan Pemikiran Kritis',
    icon: 'book',
    color: 'blue',
  },
];

function TopicList(type) {
  const isQuiz = type === 'quiz';
  const items = isQuiz ? MOCK_QUIZZES : MOCK_MATERIALS;
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
    div({ class: 'topic-card-grid', role: 'list' },
      items.map(item => div({ class: 'topic-card', role: 'listitem' },
        div({ class: 'topic-card-body' },
          div({ class: 'topic-card-header' },
            span({ class: `topic-icon ${item.color}` }, icon(item.icon)),
            div({ class: 'topic-card-headline' },
              div({ class: 'topic-card-badges' },
                span({ class: `topic-category-pill ${item.color}` }, item.category),
                span({ class: 'topic-card-time' }, item.time),
              ),
              h3({ class: 'topic-card-title' }, item.title),
            ),
          ),
          p({ class: 'topic-card-summary' }, item.summary),
        ),
        div({ class: 'topic-card-footer' },
          span({ class: 'topic-card-meta' }, item.meta),
          button({
            type: 'button',
            class: 'secondary-button topic-open-btn',
            onclick: () => startTopicChat(type, item.prompt),
          }, span(isQuiz ? 'Mulai Kuis' : 'Buka Materi'), icon('arrowRight')),
        ),
      )),
    ),
    form({ class: 'topic-custom-form', onsubmit: onCustomSubmit },
      customInput,
      button({ type: 'submit', class: 'primary-button topic-submit-btn' },
        icon('plus'), span(() => isQuiz ? 'Buat Kuis Baru' : 'Buat Materi Baru')),
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
          ? span({ class: 'dialog-count-badge' }, `${(current.type === 'quiz' ? MOCK_QUIZZES : MOCK_MATERIALS).length} modul`)
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
