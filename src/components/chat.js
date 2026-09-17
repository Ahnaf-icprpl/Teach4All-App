import van from 'vanjs-core';
import { icon } from '../icons.js';
import { MAX_INPUT } from '../storage.js';
import {
  currentChat, hasMessages, draft, setDraft, sendMessage, focusComposer,
  modal, toast, online, offlineReady, storageError, loading, messagesLoading,
  searchingWeb, buildingQuiz,
} from '../state.js';
import { getModel } from '../router.js';
import { renderMarkdown } from '../markdown.js';
import { t, activePrompts, rotatePrompts } from '../uiTexts.js';
import { login } from '../auth.js';

const { div, section, h1, h2, p, span, button, textarea, form, article, img } = van.tags;

function Welcome() {
  return section({ class: 'welcome', 'aria-labelledby': 'welcome-title' },
    div({ class: 'welcome-symbol' }, img({ src: './logo.png', alt: '', class: 'welcome-symbol-logo', 'aria-hidden': 'true' })),
    h1({ id: 'welcome-title' }, () => t('chat_welcome_title_p1'), van.tags.br(), () => t('chat_welcome_title_p2'), span({ class: 'accent-word' }, () => t('chat_welcome_title_p3'))),
    p({ class: 'welcome-description' },
      () => t('chat_welcome_desc_p1'),
      van.tags.br(),
      () => t('chat_welcome_desc_p2'),
    ),
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('chat_copy_success'));
  } catch {
    toast(t('chat_copy_fail'));
  }
}

function Messages() {
  const chat = currentChat();
  const messagesList = chat?.messages || [];

  if (messagesLoading.val && !messagesList.length) {
    return div({ class: 'message-content' },
      div({ class: 'message-history-loader' },
        span({ class: 'typing-indicator', 'aria-label': () => t('chat_loading_conversation_aria'), title: () => t('chat_loading_conversation_aria') },
          span({ class: 'typing-dot' }),
          span({ class: 'typing-dot' }),
          span({ class: 'typing-dot' }),
        ),
        span(() => t('chat_loading_messages_text')),
      ),
    );
  }

  return div({ class: 'message-content' },
    ...messagesList.map((message, idx) => {
      const isLastAssistant = message.role === 'assistant' && idx === messagesList.length - 1;
      const isGenerating = loading.val && isLastAssistant && !message.text;
      const isError = message.role === 'assistant' && Boolean(message.text?.startsWith('Error: '));

      return article({ class: `message message-${message.role} ${isError ? 'message-error' : ''}` },
        message.role === 'assistant'
          ? div({ class: 'assistant-label' },
              span({ class: 'assistant-mark' }, img({ src: './logo.png', alt: '', class: 'assistant-mark-logo', 'aria-hidden': 'true', width: 28, height: 28 })),
              () => t('chat_assistant_name'),
              isError ? span({ class: 'demo-label error-label' }, () => t('chat_notice_label')) : null,
            )
          : h2({ class: 'sr-only' }, () => t('chat_user_aria')),
        message.role === 'user'
          ? div({ class: 'user-message-bubble-wrap' },
              div({ class: 'message-text' },
                message.text ? renderMarkdown(message.text) : ''
              ),
              button({
                type: 'button',
                class: 'icon-button copy-button copy-prompt-button',
                'aria-label': () => t('chat_copy_prompt_aria'),
                title: () => t('chat_copy_prompt_aria'),
                onclick: () => copyText(message.text),
              }, icon('copy')),
            )
          : div({ class: 'message-text' },
              message.text
                ? renderMarkdown(message.text)
                : (isGenerating
                    ? (buildingQuiz.val
                        ? span({ class: 'searching-web-indicator building-quiz-indicator' },
                            icon('globe', 'spin-slow'),
                            icon('bulb', 'spin-slow'),
                            () => t('chat_quiz_building_status'),
                          )
                        : (searchingWeb.val
                            ? span({ class: 'searching-web-indicator' },
                                icon('globe', 'spin-slow'),
                                () => t('chat_web_search_status'),
                              )
                            : span({ class: 'typing-indicator', 'aria-label': () => t('chat_typing_aria'), title: () => t('chat_typing_aria') },
                                span({ class: 'typing-dot' }),
                                span({ class: 'typing-dot' }),
                                span({ class: 'typing-dot' }),
                              )))
                    : '')
            ),
        message.role === 'assistant' && message.text && !loading.val
          ? button({
              class: 'icon-button copy-button',
              'aria-label': () => t('chat_copy_button_aria'),
              title: () => t('chat_copy_button_aria'),
              onclick: () => copyText(message.text),
            }, icon('copy'))
          : null,
        isError && (message.text?.includes('tamu') || message.text?.includes('masuk') || message.text?.includes('login'))
          ? button({
              type: 'button',
              class: 'error-login-action-btn',
              onclick: () => login(),
            }, icon('login'), span(() => t('auth_login_button') || 'Masuk'))
          : null,
      );
    }),
  );
}

/**
 * Cleans pasted text by collapsing multiple consecutive spaces/tabs into a single space,
 * and collapsing all consecutive newlines into a single line break (max 1 newline, no blank lines).
 *
 * @param {string} text
 * @returns {string}
 */
export function cleanPastedText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/[^\S\r\n]+/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n');
}

function Composer() {
  const autoResize = () => {
    draft.val; // track dependency
    requestAnimationFrame(() => {
      inputEl.style.height = 'auto';
      inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
    });
  };

  const handlePaste = event => {
    const clipboardData = event.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    const text = clipboardData.getData('text');
    if (!text) return;

    event.preventDefault();
    const cleaned = cleanPastedText(text);
    if (!cleaned) return;

    const target = event.target;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const currentVal = target.value || '';
    const availableSpace = Math.max(0, MAX_INPUT - (currentVal.length - (end - start)));
    const toInsert = cleaned.slice(0, availableSpace);
    if (!toInsert) return;

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, toInsert);
    } catch {}

    if (!inserted) {
      const newVal = currentVal.slice(0, start) + toInsert + currentVal.slice(end);
      target.value = newVal;
      setDraft(newVal);
      const newCursorPos = Math.min(start + toInsert.length, newVal.length);
      target.selectionStart = target.selectionEnd = newCursorPos;
    } else {
      setDraft(target.value);
    }
  };

  const inputEl = textarea({
    id: 'message-input',
    autofocus: true,
    placeholder: () => t('chat_composer_placeholder'),
    rows: 1,
    maxlength: MAX_INPUT,
    'aria-label': () => t('chat_composer_aria'),
    value: () => draft.val,
    oninput: event => {
      setDraft(event.target.value);
      autoResize();
    },
    onblur: () => {
      if (typeof window !== 'undefined' && (window.scrollY !== 0 || document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0)) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    },
    onpaste: handlePaste,
    onkeydown: event => {
      if (event.key === 'Enter') {
        if (event.shiftKey) {
          requestAnimationFrame(autoResize);
          return;
        }
        if (!event.isComposing) {
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
            'aria-label': () => t('chat_composer_tools_aria'), title: () => t('chat_composer_tools_aria'),
            onclick: () => { modal.val = { type: 'tools' }; },
          }, icon('plus')),
        ),
        div({ class: 'send-tools' },
          () => span({ class: `input-count ${draft.val.length > MAX_INPUT - 300 ? '' : 'is-hidden'}` }, `${draft.val.length}/${MAX_INPUT}`),
          button({ type: 'submit', class: 'send-button', 'aria-label': () => t('chat_send_button_aria'), title: () => t('chat_send_button_aria'), disabled: () => !draft.val.trim() || loading.val }, 
            loading.val ? icon('settings', 'is-loading') : icon('arrow')),
        ),
      ),
    ),
  );
}

function Suggestions() {
  return section({ class: 'suggestions', 'aria-label': () => t('chat_suggestions_aria') },
    div({ class: 'suggestions-label' },
      span(() => t('chat_suggestions_heading')),
      span({ class: 'little-line' }),
      button({
        type: 'button',
        class: 'icon-button rotate-prompts-btn',
        'aria-label': () => t('chat_suggestions_aria'),
        title: () => t('chat_suggestions_aria'),
        onclick: rotatePrompts,
      }, icon('spark')),
    ),
    () => div({ class: 'suggestion-grid' }, activePrompts.val.map(prompt =>
      button({
        type: 'button',
        class: 'suggestion-card',
        disabled: () => loading.val,
        onclick: () => {
          if (loading.val) return;
          sendMessage(prompt.prompt);
        },
      },
        span({ class: `suggestion-icon ${prompt.color || 'amber'}` }, icon(prompt.icon || 'bulb')),
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
          () => t('chat_offline_warning'))
      : div(),
    div({ class: 'chat-stage' },
      Welcome(),
      div({
        class: 'messages', id: 'messages', role: 'log',
        'aria-label': () => t('chat_messages_aria'), 'aria-live': 'polite', tabindex: '0',
      }, Messages),
      Composer(),
      Suggestions(),
    ),
    div({ class: 'workspace-footer' },
      span(() => t('chat_footer_text')),
    ),
  );
}
