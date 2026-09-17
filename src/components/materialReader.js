import van from 'vanjs-core';
import { icon } from '../icons.js';
import { startTopicChat, toast } from '../state.js';
import {
  fetchMaterialDetails,
  markMaterialSolved,
  normalizeMaterialSection,
  loadLocalMaterialProgress,
  saveLocalMaterialProgress,
} from '../studyModules.js';
import { t } from '../uiTexts.js';
import { renderMarkdown } from '../markdown.js';

const { div, h2, span, button, p } = van.tags;

export function MaterialReader(materialId) {
  const loading = van.state(true);
  const material = van.state(null);
  const localProg = loadLocalMaterialProgress(materialId);
  const initialIndex = (typeof localProg?.lastSectionIndex === 'number' && localProg.lastSectionIndex >= 0)
    ? localProg.lastSectionIndex
    : 0;
  const currentSectionIndex = van.state(initialIndex);

  fetchMaterialDetails(materialId).then(data => {
    material.val = data;
    loading.val = false;
    const sections = (data?.sections || []).map(normalizeMaterialSection).filter(Boolean);
    if (currentSectionIndex.val >= sections.length && sections.length > 0) {
      currentSectionIndex.val = Math.max(0, sections.length - 1);
    }
  }).catch(() => {
    loading.val = false;
  });

  return () => {
    if (loading.val) {
      return div({ class: 'study-viewer-loading' }, p(() => t('dialogs_material_loading')));
    }
    const mData = material.val;
    if (!mData) {
      return div({ class: 'study-viewer-empty' },
        p(() => t('dialogs_material_not_found')),
      );
    }

    const sections = (mData.sections || []).map(normalizeMaterialSection).filter(Boolean);
    const totalSections = sections.length;
    const currentSec = sections[currentSectionIndex.val] || {};

    const goToSection = (idx) => {
      currentSectionIndex.val = idx;
      saveLocalMaterialProgress(materialId, { lastSectionIndex: idx });
    };

    const markFinished = () => {
      saveLocalMaterialProgress(materialId, { lastSectionIndex: currentSectionIndex.val, isSolved: true });
      markMaterialSolved(materialId, true).then(() => {
        toast(t('dialogs_toast_material_solved'));
      });
    };

    return div({ class: 'study-viewer-container' },
      div({ class: 'study-header-nav' },
        div({ class: 'study-progress-badge' },
          () => `${t('dialogs_material_section_label')} ${currentSectionIndex.val + 1} ${t('dialogs_quiz_of_label')} ${totalSections}`,
        ),
      ),
      div({ class: 'study-material-card' },
        div({ class: 'study-material-header' },
          h2({ class: 'study-material-title' }, currentSec.title || mData.title),
          span({ class: 'study-material-read-time' },
            `${currentSec.readTimeMinutes || currentSec.read_time_minutes || 2} ${t('dialogs_meta_read_time_suffix')}`,
          ),
        ),
        div({ class: 'study-material-body' },
          renderMarkdown(currentSec.content || ''),
        ),
      ),
      div({ class: 'study-footer-nav' },
        button({
          class: 'secondary-button',
          disabled: currentSectionIndex.val === 0,
          onclick: () => goToSection(Math.max(0, currentSectionIndex.val - 1)),
        }, span(() => t('dialogs_material_prev_btn'))),
        div({ class: 'study-footer-actions' },
          button({
            class: 'secondary-button',
            onclick: markFinished,
          }, icon('check'), span(() => t('dialogs_material_finish_btn'))),
          currentSectionIndex.val < totalSections - 1
            ? button({
              class: 'primary-button',
              onclick: () => goToSection(Math.min(totalSections - 1, currentSectionIndex.val + 1)),
            }, span(() => t('dialogs_material_next_btn')))
            : button({
              class: 'secondary-button',
              onclick: () => startTopicChat('material', mData.prompt),
            }, icon('chat'), span(() => t('dialogs_btn_chat'))),
        ),
      ),
    );
  };
}
