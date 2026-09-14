import van from 'vanjs-core';
import { QUIZZES_STORAGE_KEY, MATERIALS_STORAGE_KEY } from './storage.js';

export const INITIAL_QUIZZES = [];
export const INITIAL_MATERIALS = [];

export const FALLBACK_QUIZZES = INITIAL_QUIZZES;
export const FALLBACK_MATERIALS = INITIAL_MATERIALS;

function loadCachedQuizzes() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(QUIZZES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch {}
  return [];
}

function loadCachedMaterials() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(MATERIALS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch {}
  return [];
}

export const quizzes = van.state(loadCachedQuizzes());
export const materials = van.state(loadCachedMaterials());

export async function fetchQuizzes() {
  try {
    const res = await fetch('/api/quizzes');
    if (!res.ok) return quizzes.val;
    const data = await res.json();
    if (Array.isArray(data?.quizzes)) {
      const formatted = data.quizzes.map(q => {
        const solved = Boolean(q.is_solved ?? q.isSolved ?? false);
        return {
          ...q,
          questionCount: Number(q.question_count ?? q.questionCount ?? 0),
          question_count: Number(q.question_count ?? q.questionCount ?? 0),
          is_solved: solved,
          isSolved: solved,
        };
      });
      quizzes.val = formatted;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(QUIZZES_STORAGE_KEY, JSON.stringify(formatted));
        }
      } catch {}
      return formatted;
    }
  } catch {}
  return quizzes.val;
}

export async function fetchMaterials() {
  try {
    const res = await fetch('/api/materials');
    if (!res.ok) return materials.val;
    const data = await res.json();
    if (Array.isArray(data?.materials)) {
      const formatted = data.materials.map(m => {
        const solved = Boolean(m.is_solved ?? m.isSolved ?? m.is_completed ?? m.isCompleted ?? false);
        return {
          ...m,
          sectionCount: Number(m.section_count ?? m.part_count ?? m.sectionCount ?? 0),
          section_count: Number(m.section_count ?? m.part_count ?? m.sectionCount ?? 0),
          part_count: Number(m.section_count ?? m.part_count ?? m.sectionCount ?? 0),
          is_solved: solved,
          isSolved: solved,
          is_completed: solved,
          isCompleted: solved,
        };
      });
      materials.val = formatted;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(MATERIALS_STORAGE_KEY, JSON.stringify(formatted));
        }
      } catch {}
      return formatted;
    }
  } catch {}
  return materials.val;
}

export async function markQuizSolved(id, isSolved = true) {
  const val = Boolean(isSolved);
  const updated = quizzes.val.map(q => (q.id === id ? { ...q, is_solved: val, isSolved: val } : q));
  quizzes.val = updated;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(QUIZZES_STORAGE_KEY, JSON.stringify(updated));
    }
  } catch {}
  try {
    await fetch('/api/quizzes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isSolved: val }),
    });
  } catch {}
  return updated;
}

export async function markMaterialSolved(id, isSolved = true) {
  const val = Boolean(isSolved);
  const updated = materials.val.map(m => (m.id === id ? { ...m, is_solved: val, isSolved: val, is_completed: val, isCompleted: val } : m));
  materials.val = updated;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MATERIALS_STORAGE_KEY, JSON.stringify(updated));
    }
  } catch {}
  try {
    await fetch('/api/materials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isSolved: val }),
    });
  } catch {}
  return updated;
}

export function shuffleArray(array) {
  if (!Array.isArray(array) || array.length <= 1) return array ? [...array] : [];
  const copy = [...array];
  let tries = 0;
  do {
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    tries++;
  } while (
    tries < 5 &&
    copy.every((item, idx) => item === array[idx])
  );
  return copy;
}

export function normalizeQuizQuestion(q, idx = 0, { shuffle = false } = {}) {
  if (!q) return null;
  const questionNumber = q.question_number ?? q.questionNumber ?? (idx + 1);
  const questionText = q.question_text ?? q.questionText ?? '';
  const rawOpts = Array.isArray(q.options) ? q.options : [];
  const rawCorrect = q.correct_answer ?? q.correctAnswer;

  const options = rawOpts.map((opt, optIdx) => {
    if (typeof opt === 'object' && opt !== null) {
      const idVal = opt.id !== undefined ? Number(opt.id) : optIdx;
      return {
        id: Number.isInteger(idVal) ? idVal : optIdx,
        text: String(opt.text ?? opt.label ?? opt.value ?? ''),
      };
    }
    return {
      id: optIdx,
      text: String(opt || ''),
    };
  });

  let correctAnswer = 0;
  if (typeof rawCorrect === 'number' && Number.isInteger(rawCorrect)) {
    correctAnswer = rawCorrect;
  } else if (typeof rawCorrect === 'string' && /^\d+$/.test(rawCorrect.trim())) {
    correctAnswer = parseInt(rawCorrect.trim(), 10);
  } else if (rawCorrect !== undefined && rawCorrect !== null) {
    const cleanCorrect = String(rawCorrect).trim();
    const foundById = options.find(o => String(o.id) === cleanCorrect);
    if (foundById) {
      correctAnswer = foundById.id;
    } else {
      const foundByText = options.find(o => o.text.trim().toLowerCase() === cleanCorrect.toLowerCase());
      if (foundByText) {
        correctAnswer = foundByText.id;
      }
    }
  }

  const finalOptions = shuffle ? shuffleArray(options) : options;

  return {
    questionNumber,
    questionText,
    question_number: questionNumber,
    question_text: questionText,
    options: finalOptions,
    correctAnswer,
    correct_answer: correctAnswer,
    explanation: q.explanation || '',
    points: Number(q.points) || 10,
    is_solved: Boolean(q.is_solved ?? q.isSolved ?? false),
  };
}

export function normalizeMaterialSection(s, idx = 0) {
  if (!s) return null;
  const sectionNumber = s.section_number ?? s.sectionNumber ?? (idx + 1);
  const readTimeMinutes = Number(s.read_time_minutes ?? s.readTimeMinutes ?? 2);
  return {
    ...s,
    sectionNumber,
    section_number: sectionNumber,
    readTimeMinutes,
    read_time_minutes: readTimeMinutes,
    title: s.title || `Bagian ${sectionNumber}`,
    content: s.content || '',
  };
}

export async function fetchQuizDetails(id, { shuffle = true } = {}) {
  if (!id) return null;
  try {
    const res = await fetch(`/api/quizzes?id=${id}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.quiz) {
        const raw = Array.isArray(data.quiz.questions) ? data.quiz.questions : [];
        const questions = raw.map((q, qIdx) => normalizeQuizQuestion(q, qIdx, { shuffle })).filter(Boolean);
        return {
          ...data.quiz,
          questions,
          questionCount: questions.length,
          question_count: questions.length,
        };
      }
    }
  } catch {}
  const localQuiz = quizzes.val.find(q => q.id === id);
  if (!localQuiz) return null;
  const rawQuestions = Array.isArray(localQuiz.questions) ? localQuiz.questions : [];
  const questions = rawQuestions.map((q, qIdx) => normalizeQuizQuestion(q, qIdx, { shuffle })).filter(Boolean);
  return { ...localQuiz, questions, questionCount: questions.length, question_count: questions.length };
}

export async function fetchMaterialDetails(id) {
  if (!id) return null;
  try {
    const res = await fetch(`/api/materials?id=${id}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.material) {
        const raw = Array.isArray(data.material.sections) ? data.material.sections : [];
        const sections = raw.map(normalizeMaterialSection).filter(Boolean);
        return {
          ...data.material,
          sections,
          sectionCount: sections.length,
          section_count: sections.length,
        };
      }
    }
  } catch {}
  const localMat = materials.val.find(m => m.id === id);
  if (!localMat) return null;
  const rawSections = Array.isArray(localMat.sections) ? localMat.sections : [];
  const sections = rawSections.map(normalizeMaterialSection).filter(Boolean);
  return { ...localMat, sections, sectionCount: sections.length, section_count: sections.length };
}

export function initStudyModules() {
  if (typeof window === 'undefined') return;
  fetchQuizzes().catch(() => {});
  fetchMaterials().catch(() => {});
}
