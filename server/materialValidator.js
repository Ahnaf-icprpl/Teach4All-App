import { repairAndParseJson } from './quizValidator.js';

export { repairAndParseJson };

const ALLOWED_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const ALLOWED_ICONS = ['book', 'leaf', 'globe', 'bulb', 'atom', 'spark'];
const ALLOWED_COLORS = ['green', 'blue', 'purple', 'amber'];

/**
 * Normalizes difficulty value into valid database enum: beginner, intermediate, or advanced.
 *
 * @param {any} diff
 * @returns {'beginner' | 'intermediate' | 'advanced'}
 */
export function normalizeDifficulty(diff) {
  if (!diff || typeof diff !== 'string') return 'beginner';
  const lower = diff.trim().toLowerCase();
  if (lower === 'easy' || lower === 'pemula' || lower === 'beginner') return 'beginner';
  if (lower === 'medium' || lower === 'menengah' || lower === 'intermediate') return 'intermediate';
  if (lower === 'hard' || lower === 'lanjutan' || lower === 'mahir' || lower === 'advanced') return 'advanced';
  return ALLOWED_DIFFICULTIES.includes(lower) ? lower : 'beginner';
}

/**
 * Normalizes icon into one of the supported inline SVGs.
 *
 * @param {any} icon
 * @returns {string}
 */
export function normalizeIcon(icon) {
  if (!icon || typeof icon !== 'string') return 'book';
  const lower = icon.trim().toLowerCase();
  return ALLOWED_ICONS.includes(lower) ? lower : 'book';
}

/**
 * Normalizes color accent into one of the supported themes.
 *
 * @param {any} color
 * @returns {string}
 */
export function normalizeColor(color) {
  if (!color || typeof color !== 'string') return 'green';
  const lower = color.trim().toLowerCase();
  return ALLOWED_COLORS.includes(lower) ? lower : 'green';
}

/**
 * Estimates reading time in minutes based on text content.
 * Average reading speed: ~150 words/min.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateReadTime(text) {
  if (!text || typeof text !== 'string') return 2;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 150));
}

/**
 * Validates parsed material arguments algorithmically against the multi-section schema.
 * Coerces soft mismatches and returns structured algorithmic diagnostics if constraints fail.
 *
 * @param {string|object} rawArgs
 * @returns {{
 *   valid: boolean,
 *   data?: {
 *     title: string,
 *     category: string,
 *     summary: string,
 *     difficulty: string,
 *     icon: string,
 *     color: string,
 *     estimatedReadTime: number,
 *     sections: Array<{
 *       sectionNumber: number,
 *       title: string,
 *       content: string,
 *       readTimeMinutes: number,
 *       isCompleted: boolean
 *     }>
 *   },
 *   errorType?: string,
 *   errors?: string[],
 *   diagnostic?: string
 * }}
 */
export function diagnoseAndValidateMaterialArgs(rawArgs) {
  const parseResult = repairAndParseJson(rawArgs);
  if (!parseResult.success) {
    return {
      valid: false,
      errorType: parseResult.errorType,
      errors: [parseResult.diagnostic],
      diagnostic: parseResult.diagnostic,
    };
  }

  const payload = parseResult.data || {};
  const errors = [];

  // 1. Validate title
  let title = payload.title;
  if (typeof title !== 'string' || !title.trim()) {
    errors.push("Missing required field 'title' or title is empty. You must provide a descriptive title for the material.");
  } else {
    title = title.trim();
    if (title.length > 255) {
      title = title.slice(0, 255);
    }
  }

  // 2. Validate category
  let category = payload.category;
  if (typeof category !== 'string' || !category.trim()) {
    category = 'Umum';
  } else {
    category = category.trim();
    if (category.length > 100) {
      category = category.slice(0, 100);
    }
  }

  // 3. Validate summary
  let summary = payload.summary;
  if (typeof summary !== 'string') {
    summary = summary ? String(summary).trim() : '';
  } else {
    summary = summary.trim();
  }

  // 4. Validate and normalize difficulty, icon, color
  const difficulty = normalizeDifficulty(payload.difficulty);
  const icon = normalizeIcon(payload.icon);
  const color = normalizeColor(payload.color);

  // 5. Validate sections array (multi-section support)
  const rawSections = payload.sections;
  if (!rawSections) {
    errors.push("Missing required field 'sections'. Material must contain a 'sections' array with multi-section structured learning content.");
  } else if (!Array.isArray(rawSections)) {
    errors.push(`Invalid type for 'sections': expected array, received ${typeof rawSections}.`);
  } else if (rawSections.length === 0) {
    errors.push("The 'sections' array is empty. A learning material must contain at least one educational section (preferably 2-5 sections).");
  }

  const validatedSections = [];
  if (Array.isArray(rawSections)) {
    for (let i = 0; i < rawSections.length; i++) {
      const sec = rawSections[i];
      const secPrefix = `Section ${i + 1}`;
      if (!sec || typeof sec !== 'object' || Array.isArray(sec)) {
        errors.push(`${secPrefix}: must be an object with 'title' and 'content'.`);
        continue;
      }

      // Title
      let secTitle = sec.title;
      if (typeof secTitle !== 'string' || !secTitle.trim()) {
        errors.push(`${secPrefix}: missing or empty 'title'. Every section must have a descriptive title.`);
      } else {
        secTitle = secTitle.trim();
        if (secTitle.length > 255) {
          secTitle = secTitle.slice(0, 255);
        }
      }

      // Content
      let secContent = sec.content;
      if (typeof secContent !== 'string' || !secContent.trim()) {
        errors.push(`${secPrefix}: missing or empty 'content'. Every section must provide detailed educational content.`);
      } else {
        secContent = secContent.trim();
        if (secContent.length < 50) {
          errors.push(`${secPrefix}: 'content' is too brief (${secContent.length} chars). A learning material section must provide a comprehensive, multi-paragraph educational explanation with proper markdown formatting.`);
        }
      }

      // Section Number
      let secNum = parseInt(sec.section_number ?? sec.sectionNumber, 10);
      if (isNaN(secNum) || secNum < 1) {
        secNum = i + 1;
      }

      // Read time minutes
      let readTime = parseInt(sec.read_time_minutes ?? sec.readTimeMinutes, 10);
      if (isNaN(readTime) || readTime < 1) {
        readTime = estimateReadTime(secContent || '');
      }

      validatedSections.push({
        sectionNumber: secNum,
        section_number: secNum,
        title: secTitle || `Bagian ${secNum}`,
        content: secContent || '',
        readTimeMinutes: readTime,
        read_time_minutes: readTime,
        isCompleted: Boolean(sec.is_completed ?? sec.isCompleted ?? false),
      });
    }
  }

  // 6. Overall estimated read time
  let totalReadTime = parseInt(payload.estimated_read_time ?? payload.estimatedReadTime, 10);
  if (isNaN(totalReadTime) || totalReadTime < 1) {
    totalReadTime = validatedSections.reduce((acc, s) => acc + (s.readTimeMinutes || 2), 0) || 5;
  }

  if (errors.length > 0) {
    const diagnostic = `Schema Validation Error (${errors.length} issue${errors.length > 1 ? 's' : ''}):\n` +
      errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n') +
      '\nPlease call create_material again with strictly valid arguments satisfying the required multi-section schema.';

    return {
      valid: false,
      errorType: 'VALIDATION_ERROR',
      errors,
      diagnostic,
    };
  }

  return {
    valid: true,
    data: {
      title,
      category,
      summary,
      difficulty,
      icon,
      color,
      estimatedReadTime: totalReadTime,
      estimated_read_time: totalReadTime,
      sections: validatedSections,
    },
  };
}
