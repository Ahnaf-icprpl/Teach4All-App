-- Migration: 025_add_auth_rate_limits_and_ui_texts.sql
-- Description: Seed rate limits for auth endpoints and UI localization strings for Clerk authentication flow

-- 1. Insert rate limits for auth and whoami endpoints
INSERT INTO endpoint_rate_limits (endpoint, rate_limit_per_ip, rate_limit_per_user, burst_limit, window_seconds, updated_at)
VALUES
    ('/api/whoami', 120, 60, 25, 60, CURRENT_TIMESTAMP),
    ('/api/auth/whoami', 120, 60, 25, 60, CURRENT_TIMESTAMP),
    ('/api/auth/login', 60, 30, 10, 60, CURRENT_TIMESTAMP),
    ('/api/auth/logout', 60, 30, 10, 60, CURRENT_TIMESTAMP)
ON CONFLICT (endpoint)
DO UPDATE SET
    rate_limit_per_ip = EXCLUDED.rate_limit_per_ip,
    rate_limit_per_user = EXCLUDED.rate_limit_per_user,
    burst_limit = EXCLUDED.burst_limit,
    window_seconds = EXCLUDED.window_seconds,
    updated_at = CURRENT_TIMESTAMP;

-- 2. Insert UI localization strings for authentication and profile actions
INSERT INTO ui_texts (key, value)
VALUES
    ('auth_login_button', 'Masuk'),
    ('auth_logout_button', 'Keluar'),
    ('auth_guest_name', 'Tamu'),
    ('auth_guest_detail', 'Klik untuk masuk'),
    ('auth_guest_avatar', 'T'),
    ('auth_modal_title', 'Akun Pengguna'),
    ('auth_modal_desc', 'Masuk dengan akun Clerk Anda untuk menyimpan riwayat belajar dan sinkronisasi lintas perangkat.'),
    ('auth_login_with_clerk', 'Masuk dengan Clerk'),
    ('auth_signup_with_clerk', 'Daftar akun baru'),
    ('auth_login_success', 'Berhasil masuk sebagai '),
    ('auth_logout_success', 'Berhasil keluar dari akun'),
    ('auth_status_authenticated', 'Terautentikasi'),
    ('auth_status_unauthenticated', 'Belum masuk')
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
