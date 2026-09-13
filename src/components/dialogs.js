import van from 'vanjs-core';
import { icon } from '../icons.js';
import {
  modal, chats, newChat, exportWorkspace,
  clearWorkspace, renameChat, deleteChat,
} from '../state.js';
import { t } from '../uiTexts.js';

const { dialog, div, h2, h3, p, span, button, label, form, input } = van.tags;

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
  });

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
