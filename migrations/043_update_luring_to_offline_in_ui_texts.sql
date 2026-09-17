-- Migration: 043_update_luring_to_offline_in_ui_texts.sql
-- Description: Update UI texts changing 'luring' to 'offline'

UPDATE ui_texts
SET value = 'Mode offline', updated_at = CURRENT_TIMESTAMP
WHERE key = 'topbar_offline_badge';

UPDATE ui_texts
SET value = 'Anda sedang offline. Tab ini tetap berfungsi, tetapi pemuatan ulang offline belum disiapkan.', updated_at = CURRENT_TIMESTAMP
WHERE key = 'chat_offline_warning';

UPDATE ui_texts
SET value = 'Anda tampaknya sedang offline. Sambungkan kembali untuk mengirim pesan.', updated_at = CURRENT_TIMESTAMP
WHERE key = 'state_offline_notice';

UPDATE ui_texts
SET value = 'Pemasangan mode offline belum selesai. Percakapan Anda tetap tersimpan secara lokal; sambungkan kembali dan muat ulang untuk mencoba lagi.', updated_at = CURRENT_TIMESTAMP
WHERE key = 'offline_setup_failed';
