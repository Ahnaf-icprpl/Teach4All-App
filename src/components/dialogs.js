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
    button({ class: 'tool-row', onclick: closeAnd(newChat) }, icon('plus'), span('Mulai percakapan baru'), kbd('⇧ ⌘ O')),
    button({ class: 'tool-row', onclick: closeAnd(exportWorkspace) }, icon('download'), span('Ekspor ruang kerja Anda')),
    h3('Pintasan yang berguna'),
    p({ class: 'shortcut-row' }, span('Cari percakapan'), kbd('Ctrl / ⌘ K')),
    p({ class: 'shortcut-row' }, span('Fokus ke kolom pesan'), kbd('/')),
    p({ class: 'shortcut-row' }, span('Kirim pesan'), kbd('Enter')),
    p({ class: 'shortcut-row' }, span('Buat baris baru'), kbd('Shift + Enter')),
    p({ class: 'tools-note' }, 'Pada layar sentuh, tekan Enter untuk membuat baris baru. Ketuk ikon panah untuk mengirim.'),
  );
}

function Conversation(id) {
  const chat = chats.val.find(item => item.id === id);
  if (!chat) return p('Percakapan ini sudah tidak tersedia.');
  const titleInput = input({ id: 'conversation-title', value: chat.title, maxlength: 100, required: true, autocomplete: 'off' });
  return form({ onsubmit: event => { event.preventDefault(); renameChat(id, titleInput.value); } },
    label({ for: 'conversation-title', class: 'field-label' }, 'Nama percakapan'), titleInput,
    div({ class: 'dialog-actions' },
      button({ type: 'button', class: 'secondary-button danger-text', onclick: () => { modal.val = { type: 'delete', id }; } }, icon('trash'), 'Hapus'),
      button({ type: 'submit', class: 'primary-button' }, 'Simpan nama'),
    ),
  );
}

function Confirm(type, id) {
  return div(
    p(type === 'clear'
      ? 'Tindakan ini akan menghapus semua percakapan dan draf tersimpan di peramban ini secara permanen. Ekspor data terlebih dahulu jika Anda ingin menyimpannya.'
      : 'Percakapan ini akan dihapus secara permanen dari peramban ini.'),
    div({ class: 'dialog-actions' },
      button({ class: 'secondary-button', onclick: () => { modal.val = null; } }, 'Batal'),
      button({ class: 'danger-button', onclick: () => type === 'clear' ? clearWorkspace() : deleteChat(id) }, type === 'clear' ? 'Hapus semua data' : 'Hapus percakapan'),
    ),
  );
}

export function Dialogs() {
  const titles = {
    tools: 'Alat & Pintasan',
    conversation: 'Opsi percakapan', clear: 'Hapus ruang kerja Anda?', delete: 'Hapus percakapan ini?',
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
      button({ class: 'icon-button', 'aria-label': 'Tutup dialog', onclick: () => { modal.val = null; } }, icon('close'))),
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
