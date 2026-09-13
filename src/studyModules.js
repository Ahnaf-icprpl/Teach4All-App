import van from 'vanjs-core';
import { QUIZZES_STORAGE_KEY, MATERIALS_STORAGE_KEY } from './storage.js';
import { SEED_QUIZ_QUESTIONS, SEED_MATERIAL_SECTIONS } from './studySeedData.js';

export const INITIAL_QUIZZES = [
  {
    id: '00000000-0000-0000-0001-000000000001',
    title: 'Kuis Fotosintesis & Reaksi Terang',
    category: 'Biologi',
    summary: 'Evaluasi 5 soal tentang kloroplas, penyerapan foton matahari, siklus Calvin, dan pelepasan oksigen.',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Fotosintesis dan Reaksi Terang',
    question_count: 5,
    questionCount: 5,
    is_solved: false,
    isSolved: false,
    icon: 'leaf',
    color: 'green',
    timeType: 'today',
    timeSuffix: '14:20',
  },
  {
    id: '00000000-0000-0000-0001-000000000002',
    title: 'Kuis Tata Surya & Karakteristik Planet',
    category: 'Astronomi',
    summary: 'Uji pemahaman tentang planet kebumian, planet gas raksasa, orbit elips, dan gravitasi Matahari.',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Tata Surya dan Karakteristik Planet',
    question_count: 5,
    questionCount: 5,
    is_solved: false,
    isSolved: false,
    icon: 'globe',
    color: 'blue',
    timeType: 'today',
    timeSuffix: '11:05',
  },
  {
    id: '00000000-0000-0000-0001-000000000003',
    title: 'Kuis Penalaran Matematika & Logika',
    category: 'Matematika',
    summary: 'Soal penalaran proporsional, pola deret angka, dan pemecahan masalah bertahap.',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Matematika dan Logika Bertahap',
    question_count: 5,
    questionCount: 5,
    is_solved: false,
    isSolved: false,
    icon: 'bulb',
    color: 'purple',
    timeType: 'yesterday',
  },
  {
    id: '00000000-0000-0000-0001-000000000004',
    title: 'Kuis Pengetahuan Sains & Alam Sekitar',
    category: 'Sains Dasar',
    summary: 'Pertanyaan seputar wujud zat, siklus air, perubahan energi, dan gaya gesek di lingkungan sekitar.',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Sains dan Alam Sekitar',
    question_count: 5,
    questionCount: 5,
    is_solved: false,
    isSolved: false,
    icon: 'spark',
    color: 'amber',
    timeType: 'yesterday',
  },
  {
    id: '00000000-0000-0000-0001-000000000005',
    title: 'Kuis Metode & Manajemen Waktu Belajar',
    category: 'Pengembangan Diri',
    summary: 'Refleksi penerapan teknik active recall, spaced repetition, dan strategi fokus pomodoro.',
    prompt: 'Buatkan kuis singkat 5 soal pilihan ganda tentang topik berikut: Rencana dan Metode Belajar',
    question_count: 5,
    questionCount: 5,
    is_solved: false,
    isSolved: false,
    icon: 'plan',
    color: 'blue',
    timeType: 'days_ago',
    daysAgo: 2,
  },
];

export const INITIAL_MATERIALS = [
  {
    id: '00000000-0000-0000-0002-000000000001',
    title: 'Ringkasan Fotosintesis: Dapur Bertenaga Surya',
    category: 'Biologi',
    summary: 'Uraian terstruktur tentang struktur daun, konversi foton menjadi glukosa, dan peran krusial klorofil.',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Fotosintesis',
    part_count: 3,
    section_count: 3,
    sectionCount: 3,
    estimated_read_time: 4,
    is_solved: false,
    isSolved: false,
    icon: 'leaf',
    color: 'green',
    timeType: 'today',
    timeSuffix: '13:45',
  },
  {
    id: '00000000-0000-0000-0002-000000000002',
    title: 'Arsitektur Tata Surya & Hukum Gravitasi',
    category: 'Astronomi',
    summary: 'Susunan planet dalam dan planet luar, pengaruh orbit elips Kepler, serta karakteristik sabuk asteroid.',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Tata Surya',
    part_count: 3,
    section_count: 3,
    sectionCount: 3,
    estimated_read_time: 6,
    is_solved: false,
    isSolved: false,
    icon: 'globe',
    color: 'blue',
    timeType: 'today',
    timeSuffix: '09:30',
  },
  {
    id: '00000000-0000-0000-0002-000000000003',
    title: 'Kerangka 5 Langkah Pemecahan Masalah Matematika',
    category: 'Matematika',
    summary: 'Langkah terarah membedah soal rumit: pemahaman premis, pembuatan model, penyelesaian, dan validasi.',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Pemecahan Masalah Matematika',
    part_count: 3,
    section_count: 3,
    sectionCount: 3,
    estimated_read_time: 5,
    is_solved: false,
    isSolved: false,
    icon: 'bulb',
    color: 'purple',
    timeType: 'yesterday',
  },
  {
    id: '00000000-0000-0000-0002-000000000004',
    title: 'Strategi Belajar Efektif & Retensi Memori',
    category: 'Pengembangan Diri',
    summary: 'Panduan active recall, teknik Feynman sederhana, dan cara mengatasi kurva lupa Ebbinghaus secara konsisten.',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Rencana dan Metode Belajar',
    part_count: 3,
    section_count: 3,
    sectionCount: 3,
    estimated_read_time: 4,
    is_solved: false,
    isSolved: false,
    icon: 'plan',
    color: 'amber',
    timeType: 'yesterday',
  },
  {
    id: '00000000-0000-0000-0002-000000000005',
    title: 'Prinsip Berpikir Kritis & Literasi Informasi',
    category: 'Literasi & Sains',
    summary: 'Tiga pilar verifikasi argumen ilmiah, pengujian data, dan pembedaan kausalitas dari korelasi semu.',
    prompt: 'Jelaskan ringkasan materi pembelajaran terstruktur mengenai topik berikut: Sains dan Pemikiran Kritis',
    part_count: 3,
    section_count: 3,
    sectionCount: 3,
    estimated_read_time: 5,
    is_solved: false,
    isSolved: false,
    icon: 'book',
    color: 'blue',
    timeType: 'days_ago',
    daysAgo: 3,
  },
];

export const FALLBACK_QUIZZES = INITIAL_QUIZZES;
export const FALLBACK_MATERIALS = INITIAL_MATERIALS;

function loadCachedQuizzes() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(QUIZZES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    }
  } catch {}
  return INITIAL_QUIZZES;
}

function loadCachedMaterials() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(MATERIALS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    }
  } catch {}
  return INITIAL_MATERIALS;
}

export const quizzes = van.state(loadCachedQuizzes());
export const materials = van.state(loadCachedMaterials());

export async function fetchQuizzes() {
  try {
    const res = await fetch('/api/quizzes');
    if (!res.ok) return quizzes.val;
    const data = await res.json();
    if (Array.isArray(data?.quizzes) && data.quizzes.length > 0) {
      const formatted = data.quizzes.map(q => {
        const solved = Boolean(q.is_solved ?? q.isSolved ?? false);
        return {
          ...q,
          questionCount: Number(q.question_count ?? q.questionCount ?? 5),
          question_count: Number(q.question_count ?? q.questionCount ?? 5),
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
    if (Array.isArray(data?.materials) && data.materials.length > 0) {
      const formatted = data.materials.map(m => {
        const solved = Boolean(m.is_solved ?? m.isSolved ?? m.is_completed ?? m.isCompleted ?? false);
        return {
          ...m,
          sectionCount: Number(m.section_count ?? m.part_count ?? m.sectionCount ?? 3),
          section_count: Number(m.section_count ?? m.part_count ?? m.sectionCount ?? 3),
          part_count: Number(m.section_count ?? m.part_count ?? m.sectionCount ?? 3),
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

export function normalizeQuizQuestion(q, idx = 0) {
  if (!q) return null;
  const questionNumber = q.question_number ?? q.questionNumber ?? (idx + 1);
  const questionText = q.question_text ?? q.questionText ?? '';
  const rawOpts = Array.isArray(q.options) ? q.options : [];
  const rawCorrect = String(q.correct_answer ?? q.correctAnswer ?? '').trim();

  const options = rawOpts.map((opt, optIdx) => {
    const defaultKey = String.fromCharCode(65 + optIdx);
    if (typeof opt === 'object' && opt !== null) {
      return {
        key: opt.key || defaultKey,
        text: String(opt.text ?? opt.label ?? opt.value ?? ''),
      };
    }
    return {
      key: defaultKey,
      text: String(opt || ''),
    };
  });

  let correctAnswer = rawCorrect;
  const matchByText = options.find(o => o.text.trim().toLowerCase() === rawCorrect.toLowerCase());
  if (matchByText) {
    correctAnswer = matchByText.key;
  } else {
    const matchByKey = options.find(o => o.key.toUpperCase() === rawCorrect.toUpperCase());
    if (matchByKey) {
      correctAnswer = matchByKey.key;
    }
  }

  return {
    questionNumber,
    questionText,
    question_number: questionNumber,
    question_text: questionText,
    options,
    correctAnswer,
    correct_answer: rawCorrect,
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

export async function fetchQuizDetails(id) {
  if (!id) return null;
  try {
    const res = await fetch(`/api/quizzes?id=${id}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.quiz) {
        const raw = Array.isArray(data.quiz.questions) ? data.quiz.questions : [];
        const questions = raw.map(normalizeQuizQuestion).filter(Boolean);
        return {
          ...data.quiz,
          questions,
          questionCount: questions.length,
          question_count: questions.length,
        };
      }
    }
  } catch {}
  const localQuiz = quizzes.val.find(q => q.id === id) || INITIAL_QUIZZES.find(q => q.id === id);
  if (!localQuiz) return null;
  const rawQuestions = SEED_QUIZ_QUESTIONS[id] || [];
  const questions = rawQuestions.map(normalizeQuizQuestion).filter(Boolean);
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
  const localMat = materials.val.find(m => m.id === id) || INITIAL_MATERIALS.find(m => m.id === id);
  if (!localMat) return null;
  const rawSections = SEED_MATERIAL_SECTIONS[id] || [];
  const sections = rawSections.map(normalizeMaterialSection).filter(Boolean);
  return { ...localMat, sections, sectionCount: sections.length, section_count: sections.length };
}

export function initStudyModules() {
  if (typeof window === 'undefined') return;
  fetchQuizzes().catch(() => {});
  fetchMaterials().catch(() => {});
}
