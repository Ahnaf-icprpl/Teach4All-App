import van from 'vanjs-core';
import { icon } from '../icons.js';
import { MAX_INPUT } from '../storage.js';
import {
  currentChat, hasMessages, draft, setDraft, sendMessage, focusComposer,
  modal, toast, online, offlineReady, storageError, loading,
} from '../state.js';
import { getModel } from '../router.js';
import { renderMarkdown } from '../markdown.js';

const { div, section, h1, h2, p, span, button, textarea, form, article } = van.tags;
const prompts = [
  { icon: 'bulb', color: 'amber', title: 'Jelaskan sederhana', detail: 'Pahami konsep penting', prompt: 'Jelaskan proses fotosintesis secara sederhana beserta contoh dalam kehidupan sehari-hari.' },
  { icon: 'plan', color: 'blue', title: 'Buat rencana belajar', detail: 'Langkah kecil, hasil nyata', prompt: 'Bantu saya membuat rencana belajar sederhana untuk minggu ini.' },
  { icon: 'spark', color: 'purple', title: 'Inspirasi ide kreatif', detail: 'Kembangkan imajinasi Anda', prompt: 'Berikan ide cerita kreatif atau topik menarik untuk memicu ide saya.' },
  { icon: 'book', color: 'green', title: 'Pecahkan masalah', detail: 'Satu langkah demi satu langkah', prompt: 'Tunjukkan langkah demi langkah cara menyelesaikan masalah atau soal ini.' },
];

function Welcome() {
  return section({ class: 'welcome', 'aria-labelledby': 'welcome-title' },
    div({ class: 'welcome-symbol' }, icon('mountain'), span({ class: 'symbol-dot' })),
    div({ class: 'welcome-eyebrow' }, span(), 'RUANG UNTUK RASA INGIN TAHU'),
    h1({ id: 'welcome-title' }, 'Rasa ingin tahu.', van.tags.br(), 'Dunia penuh ', span({ class: 'accent-word' }, 'kemungkinan.')),
    p({ class: 'welcome-description' },
      'Ajukan pertanyaan. Uraikan gagasan rumit. Pelajari hal baru.',
      van.tags.br(),
      'Di mana pun Anda berada, ini tempat yang tepat untuk memulai.',
    ),
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Tanggapan berhasil disalin.');
  } catch {
    toast('Fitur salin tidak tersedia di peramban ini. Pilih teks tanggapan untuk menyalinnya.');
  }
}

function Messages() {
  const chat = currentChat();
  const messagesList = chat?.messages || [];

  return div({ class: 'message-content' },
    ...messagesList.map((message, idx) => {
      const isLastAssistant = message.role === 'assistant' && idx === messagesList.length - 1;
      const isGenerating = loading.val && isLastAssistant && !message.text;
      const isError = message.role === 'assistant' && Boolean(message.text?.startsWith('Error: '));

      return article({ class: `message message-${message.role} ${isError ? 'message-error' : ''}` },
        message.role === 'assistant'
          ? div({ class: 'assistant-label' },
              span({ class: 'assistant-mark' }, icon('mountain')),
              'Teach4All',
              isError ? span({ class: 'demo-label error-label' }, 'Pemberitahuan') : null,
            )
          : h2({ class: 'sr-only' }, 'Anda'),
        div({ class: 'message-text' },
          message.text
            ? renderMarkdown(message.text)
            : (isGenerating
                ? span({ class: 'typing-indicator', 'aria-label': 'Sedang mengetik tanggapan...', title: 'Sedang mengetik tanggapan...' },
                    span({ class: 'typing-dot' }),
                    span({ class: 'typing-dot' }),
                    span({ class: 'typing-dot' }),
                  )
                : '')
        ),
        message.role === 'assistant' && message.text && !loading.val
          ? button({
              class: 'icon-button copy-button',
              'aria-label': 'Salin tanggapan',
              title: 'Salin tanggapan',
              onclick: () => copyText(message.text),
            }, icon('copy'))
          : null,
      );
    }),
  );
}

function Composer() {
  const autoResize = () => {
    draft.val; // track dependency
    requestAnimationFrame(() => {
      inputEl.style.height = 'auto';
      inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
    });
  };

  const inputEl = textarea({
    id: 'message-input',
    placeholder: 'Apa yang sedang Anda pikirkan?',
    rows: 1,
    maxlength: MAX_INPUT,
    'aria-label': 'Pesan Teach4All',
    value: () => draft.val,
    oninput: event => setDraft(event.target.value),
    onkeydown: event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        if (!window.matchMedia('(pointer: coarse)').matches) {
          event.preventDefault();
          sendMessage();
        }
      }
    },
  });

  van.derive(autoResize);

  return div({ class: 'composer-wrap' },
    form({
      class: 'composer',
      onsubmit: event => {
        event.preventDefault();
        sendMessage();
      },
    },
      inputEl,
      div({ class: 'composer-toolbar' },
        div({ class: 'composer-tools' },
          button({
            type: 'button', class: 'icon-button add-button',
            'aria-label': 'Alat percakapan', title: 'Alat percakapan',
            onclick: () => { modal.val = { type: 'tools' }; },
          }, icon('plus')),
        ),
        div({ class: 'send-tools' },
          () => span({ class: `input-count ${draft.val.length > MAX_INPUT - 300 ? '' : 'is-hidden'}` }, `${draft.val.length}/${MAX_INPUT}`),
          button({ type: 'submit', class: 'send-button', 'aria-label': 'Kirim pesan', title: 'Kirim pesan', disabled: () => !draft.val.trim() || loading.val }, 
            loading.val ? icon('settings', 'is-loading') : icon('arrow')),
        ),
      ),
    ),
  );
}

function Suggestions() {
  return section({ class: 'suggestions', 'aria-label': 'Ide untuk memulai' },
    div({ class: 'suggestions-label' }, span('Beberapa topik untuk memulai'), span({ class: 'little-line' })),
    div({ class: 'suggestion-grid' }, prompts.map(prompt =>
      button({ class: 'suggestion-card', onclick: () => { setDraft(prompt.prompt); focusComposer(); } },
        span({ class: `suggestion-icon ${prompt.color}` }, icon(prompt.icon)),
        span({ class: 'suggestion-title' }, prompt.title),
        span({ class: 'suggestion-detail' }, prompt.detail),
        icon('arrowRight', 'suggestion-arrow'),
      ),
    )),
  );
}

export function Chat() {
  return div({ class: () => `workspace ${hasMessages() ? 'has-messages' : 'is-welcome'}` },
    () => storageError.val
      ? div({ class: 'storage-warning', role: 'alert' },
          icon('info'), span(storageError.val))
      : div(),
    () => !online.val && !offlineReady.val
      ? div({ class: 'connection-warning', role: 'status' },
          'Anda sedang luring. Tab ini tetap berfungsi, tetapi pemuatan ulang luring belum disiapkan.')
      : div(),
    div({ class: 'chat-stage' },
      Welcome(),
      div({
        class: 'messages', id: 'messages', role: 'log',
        'aria-label': 'Percakapan', 'aria-live': 'polite', tabindex: '0',
      }, Messages),
      Composer(),
      Suggestions(),
    ),
    div({ class: 'workspace-footer' },
      icon('mountain'),
      span('Belajar tanpa batas. Begitu pula potensi Anda.'),
    ),
  );
}
