import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  modal, chats, theme, setTheme, apiKey, setApiKeyValue, newChat, exportWorkspace,
  clearWorkspace, renameChat, deleteChat, storageError, toast,
} from '../state.js';
import { getModel, isPlaceholderKey } from '../router.js';

const { dialog, div, h2, h3, p, span, button, label, select, option, form, input, kbd } = van.tags;

function Settings() {
  const currentKey = apiKey.val || '';
  const keyInput = input({
    id: 'api-key-input', type: 'password', placeholder: 'sk-or-...',
    autocomplete: 'off', value: currentKey,
  });

  const getStatusText = () => {
    if (!apiKey.val) return 'No API key set. OpenRouter calls will fail without a key.';
    if (isPlaceholderKey(apiKey.val)) return 'Using placeholder key from .env. Add your real OpenRouter key above to receive live AI responses.';
    return 'OpenRouter API key is configured and active.';
  };

  return div({ class: 'settings-content' },
    div({ class: 'setting-row' },
      div(h3('Appearance'), p('Make this space feel like yours.')),
      select({ 'aria-label': 'Appearance', value: theme.val, onchange: event => setTheme(event.target.value) },
        option({ value: 'system' }, 'System'), option({ value: 'light' }, 'Light'), option({ value: 'dark' }, 'Dark')),
    ),
    div({ class: 'setting-row' },
      div(
        h3('AI Model & Provider'),
        p(`OpenRouter · ${getModel()}`),
      ),
    ),
    div({ class: 'setting-row' },
      div(
        h3('OpenRouter API key'),
        p('Required for live responses. Get your key at openrouter.ai/keys'),
      ),
      button({
        class: 'secondary-button',
        onclick: () => {
          setApiKeyValue(keyInput.value.trim());
          toast('API key saved.');
        },
      }, 'Save key'),
    ),
    div({ class: 'api-key-form' },
      keyInput,
      p({ class: () => `settings-note ${isPlaceholderKey(apiKey.val) ? 'warning-text' : ''}` }, getStatusText),
    ),
    div({ class: 'setting-row' }, div(h3('Your conversations'), p(`${chats.val.length} saved on this browser. No account needed.`)),
      button({ class: 'secondary-button', onclick: exportWorkspace }, icon('download'), 'Export')),
    p({ class: 'settings-note' }, 'Local browser storage isn’t a backup. Export important chats before clearing browser data or switching devices. Use one tab at a time; separate tabs do not merge changes.'),
    storageError.val ? p({ class: 'settings-note warning-text' }, storageError.val) : null,
    div({ class: 'setting-row' }, div(h3('Clear local data'), p('Delete all conversations and your current draft.'))),
      button({ class: 'danger-text secondary-button', onclick: () => { modal.val = { type: 'clear' }; } }, 'Clear data'),
    div({ class: 'settings-footnote' }, icon('leaf'), 'A lighter app. A little more room to explore.'),
  );
}

function Tools() {
  const closeAnd = action => () => { modal.val = null; action(); };
  return div({ class: 'tools-content' },
    button({ class: 'tool-row', onclick: closeAnd(newChat) }, icon('plus'), span('Start a new conversation'), kbd('⌘ ⇧ O')),
    button({ class: 'tool-row', onclick: closeAnd(exportWorkspace) }, icon('download'), span('Export your workspace')),
    h3('A few handy shortcuts'),
    p({ class: 'shortcut-row' }, span('Search conversations'), kbd('Ctrl / ⌘ K')),
    p({ class: 'shortcut-row' }, span('Focus your message'), kbd('/')),
    p({ class: 'shortcut-row' }, span('Send a message'), kbd('Enter')),
    p({ class: 'shortcut-row' }, span('Add a new line'), kbd('Shift + Enter')),
    p({ class: 'settings-note' }, 'On touch devices, Enter adds a new line. Tap the arrow to send.'),
  );
}

function Conversation(id) {
  const chat = chats.val.find(item => item.id === id);
  if (!chat) return p('This conversation is no longer available.');
  const titleInput = input({ id: 'conversation-title', value: chat.title, maxlength: 100, required: true, autocomplete: 'off' });
  return form({ onsubmit: event => { event.preventDefault(); renameChat(id, titleInput.value); } },
    label({ for: 'conversation-title', class: 'field-label' }, 'Conversation name'), titleInput,
    div({ class: 'dialog-actions' },
      button({ type: 'button', class: 'secondary-button danger-text', onclick: () => { modal.val = { type: 'delete', id }; } }, icon('trash'), 'Delete'),
      button({ type: 'submit', class: 'primary-button' }, 'Save name'),
    ),
  );
}

function Confirm(type, id) {
  return div(
    p(type === 'clear'
      ? 'This will permanently remove all conversations and the draft saved in this browser. Export anything you want to keep first.'
      : 'This conversation will be permanently removed from this browser.'),
    div({ class: 'dialog-actions' },
      button({ class: 'secondary-button', onclick: () => { modal.val = null; } }, 'Cancel'),
      button({ class: 'danger-button', onclick: () => type === 'clear' ? clearWorkspace() : deleteChat(id) }, type === 'clear' ? 'Clear all data' : 'Delete conversation'),
    ),
  );
}

export function Dialogs() {
  const titles = {
    settings: 'Your workspace', tools: 'A few useful things',
    conversation: 'Conversation options', clear: 'Clear your workspace?', delete: 'Delete this conversation?',
  };
  return () => {
    const current = modal.val;
    if (!current) return div({ hidden: true });
    const previousFocus = document.activeElement;
    const content = current.type === 'settings' ? Settings()
      : current.type === 'tools' ? Tools()
        : current.type === 'conversation' ? Conversation(current.id)
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
    div({ class: 'dialog-heading' }, h2({ id: 'dialog-title' }, titles[current.type]),
      button({ class: 'icon-button', 'aria-label': 'Close dialog', onclick: () => { modal.val = null; } }, icon('close'))),
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
