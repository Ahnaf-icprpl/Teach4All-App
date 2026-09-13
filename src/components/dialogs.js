import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  modal, chats, newChat, exportWorkspace,
  clearWorkspace, renameChat, deleteChat,
} from '../state.js';

const { dialog, div, h2, h3, p, span, button, label, form, input, kbd } = van.tags;

function Tools() {
  const closeAnd = action => () => { modal.val = null; action(); };
  return div({ class: 'tools-content' },
    button({ class: 'tool-row', onclick: closeAnd(newChat) }, icon('plus'), span('Start a new conversation'), kbd('⇧ ⌘ O')),
    button({ class: 'tool-row', onclick: closeAnd(exportWorkspace) }, icon('download'), span('Export your workspace')),
    h3('A few handy shortcuts'),
    p({ class: 'shortcut-row' }, span('Search conversations'), kbd('Ctrl / ⌘ K')),
    p({ class: 'shortcut-row' }, span('Focus your message'), kbd('/')),
    p({ class: 'shortcut-row' }, span('Send a message'), kbd('Enter')),
    p({ class: 'shortcut-row' }, span('Add a new line'), kbd('Shift + Enter')),
    p({ class: 'tools-note' }, 'On touch devices, Enter adds a new line. Tap the arrow to send.'),
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
    tools: 'A few useful things',
    conversation: 'Conversation options', clear: 'Clear your workspace?', delete: 'Delete this conversation?',
  };
  return () => {
    const current = modal.val;
    if (!current) return div({ hidden: true });
    const previousFocus = document.activeElement;
    const content = current.type === 'tools' ? Tools()
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
