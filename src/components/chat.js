import van from 'vanjs-core';
import { icon } from '../icons.js';
import { MAX_INPUT } from '../storage.js';
import {
  currentChat, hasMessages, draft, setDraft, sendMessage, focusComposer,
  modal, toast, online, offlineReady, storageError, loading, apiKey,
} from '../state.js';
import { getModel, isPlaceholderKey } from '../router.js';

const { div, section, h1, h2, p, span, button, textarea, form, article } = van.tags;
const prompts = [
  { icon: 'bulb', color: 'amber', title: 'Explain it simply', detail: 'Make a big idea click', prompt: 'Explain photosynthesis simply, with an everyday example.' },
  { icon: 'plan', color: 'blue', title: 'Make a plan', detail: 'Small steps, real progress', prompt: 'Help me make a simple study plan for this week.' },
  { icon: 'spark', color: 'purple', title: 'Find a little inspiration', detail: 'See where an idea takes you', prompt: 'Give me a creative story prompt to get my ideas flowing.' },
  { icon: 'book', color: 'green', title: 'Work through it', detail: 'One question at a time', prompt: 'Show me how to solve a problem step by step.' },
];

function Welcome() {
  return section({ class: 'welcome', 'aria-labelledby': 'welcome-title' },
    div({ class: 'welcome-symbol' }, icon('mountain'), span({ class: 'symbol-dot' })),
    div({ class: 'welcome-eyebrow' }, span(), 'A SPACE FOR CURIOSITY'),
    h1({ id: 'welcome-title' }, 'A little curiosity.', van.tags.br(), 'A world of ', span({ class: 'accent-word' }, 'possibility.')),
    p({ class: 'welcome-description' }, 'Ask a question. Untangle an idea. Learn something new.', van.tags.br(), 'Wherever you are, this is a good place to start.'),
  );
}

async function copyMessage(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Response copied.');
  } catch {
    toast('Copy is unavailable in this browser. Select the response text to copy it.');
  }
}

function Messages() {
  const chat = currentChat();
  const messagesList = chat?.messages || [];
  return div({ class: 'message-content' },
    ...messagesList.map((message, idx) => {
      const isLastAssistant = message.role === 'assistant' && idx === messagesList.length - 1;
      const isGenerating = loading.val && isLastAssistant && !message.text;
      const isStreaming = loading.val && isLastAssistant && Boolean(message.text);
      const isError = message.role === 'assistant' && Boolean(message.text?.startsWith('Error: '));

      return article({ class: `message message-${message.role} ${isError ? 'message-error' : ''}` },
        message.role === 'assistant'
          ? div({ class: 'assistant-label' },
              span({ class: 'assistant-mark' }, icon('mountain')),
              'Teach4All',
              isGenerating
                ? span({ class: 'demo-label loading-label' }, icon('settings'), 'Connecting...')
                : isStreaming
                  ? span({ class: 'demo-label loading-label' }, icon('settings'), 'Streaming...')
                  : isError
                    ? span({ class: 'demo-label error-label' }, 'Notice')
                    : span({ class: 'demo-label' }, 'AI response')
            )
          : h2({ class: 'sr-only' }, 'You'),
        div({ class: 'message-text' }, message.text || (isGenerating ? 'Connecting to OpenRouter...' : '...')),
        message.role === 'assistant' && message.text && !isGenerating && !isStreaming
          ? button({
              class: 'icon-button copy-button',
              'aria-label': 'Copy response',
              title: 'Copy response',
              onclick: () => copyMessage(message.text),
            }, icon('copy'))
          : null,
      );
    }),
  );
}

function Composer() {
  const input = textarea({
    id: 'message-input', placeholder: 'What’s on your mind?', rows: 1, maxlength: MAX_INPUT,
    'aria-label': 'Message Teach4All', 'aria-describedby': 'composer-note',
    value: () => draft.val,
    oninput: event => setDraft(event.target.value),
    onkeydown: event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing
        && !window.matchMedia('(pointer: coarse)').matches) {
        event.preventDefault();
        sendMessage();
      }
    },
  });
  van.derive(() => {
    draft.val;
    requestAnimationFrame(() => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    });
  });
  return div({ class: 'composer-wrap' },
    form({ class: 'composer', onsubmit: event => { event.preventDefault(); sendMessage(); } },
      input,
      div({ class: 'composer-toolbar' },
        div({ class: 'composer-tools' },
          button({ type: 'button', class: 'icon-button add-button', 'aria-label': 'Chat tools', title: 'Chat tools', onclick: () => { modal.val = { type: 'tools' }; } }, icon('plus')),
          span({ class: 'toolbar-divider' }),
          span({ class: 'companion-button' }, icon('globe'), 'OpenRouter companion'),
        ),
        div({ class: 'send-tools' },
          () => span({ class: `input-count ${draft.val.length > MAX_INPUT - 300 ? '' : 'is-hidden'}` }, `${draft.val.length}/${MAX_INPUT}`),
          button({ type: 'submit', class: 'send-button', 'aria-label': 'Send message', title: 'Send message', disabled: () => !draft.val.trim() || loading.val }, 
            loading.val ? icon('settings', 'is-loading') : icon('arrow')),
        ),
      ),
    ),
    div({ class: 'composer-note', id: 'composer-note' },
      icon('leaf'), span('Light on data. Big on possibility.'), span({ class: 'note-dot' }, '·'),
      () => span(
        isPlaceholderKey(apiKey.val)
          ? `OpenRouter (${getModel()}) · Placeholder key`
          : `OpenRouter (${getModel()})`
      ),
    ),
  );
}

function Suggestions() {
  return section({ class: 'suggestions', 'aria-label': 'Ideas to get started' },
    div({ class: 'suggestions-label' }, span('A few places to begin'), span({ class: 'little-line' })),
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
    () => storageError.val ? div({ class: 'storage-warning', role: 'alert' }, icon('info'),
      span(storageError.val), button({ class: 'text-button', onclick: () => { modal.val = { type: 'settings' }; } }, 'Settings')) : div(),
    () => !online.val && !offlineReady.val
      ? div({ class: 'connection-warning', role: 'status' }, 'You’re offline. This tab still works, but offline reload hasn’t been prepared yet.') : div(),
    div({ class: 'chat-stage' },
      Welcome(),
      div({ class: 'messages', id: 'messages', role: 'log', 'aria-label': 'Conversation', 'aria-live': 'polite', tabindex: '0' }, Messages),
      Composer(),
      Suggestions(),
    ),
    div({ class: 'workspace-footer' }, icon('mountain'), span('Learning has no boundaries. Neither should you.')),
  );
}
