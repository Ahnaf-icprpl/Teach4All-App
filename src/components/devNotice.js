import van from 'vanjs-core';
import { icon } from '../icons.js';
import { isDevEnv } from '../env.js';
import { t } from '../uiTexts.js';

const { div, span, button } = van.tags;

export function DevNotice() {
  const dismissed = van.state(
    typeof sessionStorage !== 'undefined'
      ? Boolean(sessionStorage.getItem('teach4all_dev_banner_dismissed'))
      : false
  );

  return () => {
    if (!isDevEnv() || dismissed.val) {
      return div({ hidden: true });
    }

    return div({ class: 'dev-notice-wrapper', role: 'region', 'aria-label': () => t('dev_banner_badge') },
      div({ class: 'dev-notice-popup', role: 'status' },
        span({ class: 'dev-notice-icon-box' }, icon('spark')),
        span({ class: 'dev-notice-badge' }, () => t('dev_banner_badge')),
        span({ class: 'dev-notice-text' }, () => t('dev_banner_notice')),
        button({
          type: 'button',
          class: 'icon-button dev-notice-close',
          'aria-label': () => t('dev_banner_close_aria'),
          title: () => t('dev_banner_close_aria'),
          onclick: () => {
            dismissed.val = true;
            try {
              if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem('teach4all_dev_banner_dismissed', '1');
              }
            } catch {}
          },
        }, icon('close')),
      ),
    );
  };
}
