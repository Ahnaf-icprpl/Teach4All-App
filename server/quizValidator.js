/**
 * Algorithmic validator and repair utility for create_quiz tool arguments.
 * Provides resilient JSON parsing, algorithmic repair of common syntax errors from smaller models,
 * strict schema validation, and detailed algorithmic diagnostics for model recalls.
 */

/**
 * Attempts to repair and parse JSON strings produced by less capable models.
 * Handles markdown fences, trailing commas, and unclosed brackets/quotes.
 *
 * @param {string|object} raw
 * @returns {{ success: boolean, data?: object, errorType?: string, diagnostic?: string }}
 */
export function repairAndParseJson(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { success: true, data: raw };
  }

  if (typeof raw !== 'string') {
    return {
      success: false,
      errorType: 'INVALID_TYPE',
      diagnostic: 'Tool arguments must be a valid JSON string or object.',
    };
  }

  let cleaned = raw.trim();

  // Strip markdown code fences if model wrapped JSON in ```json ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // Attempt direct parse first
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { success: true, data: parsed };
    }
  } catch {}

  // Strip trailing commas before closing braces/brackets: {"a": 1,} -> {"a": 1}
  let sanitized = cleaned.replace(/,(\s*[}\]])/g, '$1');

  try {
    const parsed = JSON.parse(sanitized);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { success: true, data: parsed };
    }
  } catch {}

  // Attempt bracket/quote balancing for truncated output
  try {
    let balanced = sanitized;
    // Check unclosed double quotes
    const quoteCount = (balanced.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      balanced += '"';
    }

    // Balance braces and brackets
    const stack = [];
    let inString = false;
    let escape = false;

    for (let i = 0; i < balanced.length; i++) {
      const char = balanced[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') stack.push('}');
        else if (char === '[') stack.push(']');
        else if (char === '}' || char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === char) {
            stack.pop();
          }
        }
      }
    }

    // Remove any trailing commas right before closing
    balanced = balanced.replace(/,\s*$/, '');
    while (stack.length > 0) {
      balanced += stack.pop();
    }

    const parsed = JSON.parse(balanced);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { success: true, data: parsed };
    }
  } catch {}

  // If all repair attempts fail, build algorithmic syntax diagnostic
  let syntaxMsg = 'Invalid JSON format';
  try {
    JSON.parse(cleaned);
  } catch (err) {
    syntaxMsg = err.message;
  }

  const snippet = cleaned.length > 120 ? `${cleaned.slice(0, 100)}...` : cleaned;
  return {
    success: false,
    errorType: 'SYNTAX_ERROR',
    diagnostic: `JSON Syntax Error: ${syntaxMsg}. Received: "${snippet}". Ensure your arguments are strictly valid JSON without unescaped quotes or invalid formatting.`,
  };
}

/**
 * Normalizes an option string by stripping choice prefixes like "A. ", "1) ", "(d) ".
 * Preserves actual words that happen to end in letters.
 * @param {string} str
 * @returns {string}
 */
export function stripOptionPrefix(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/^(?:\([a-dA-D1-4]\)|\[[a-dA-D1-4]\]|[a-dA-D1-4][.)\-])\s*/i, '')
    .replace(/\s+\([a-dA-D1-4]\)$/i, '')
    .trim();
}

/**
 * Validates parsed quiz arguments algorithmically against the required schema.
 * Coerces soft mismatches (case-insensitivity, option prefixing, sensible defaults)
 * and returns structured algorithmic diagnostics if required constraints fail.
 *
 * @param {string|object} rawArgs
 * @returns {{
 *   valid: boolean,
 *   data?: object,
 *   errorType?: string,
 *   errors?: string[],
 *   diagnostic?: string
 * }}
 */
export function diagnoseAndValidateQuizArgs(rawArgs) {
  const parseResult = repairAndParseJson(rawArgs);
  if (!parseResult.success) {
    return {
      valid: false,
      errorType: parseResult.errorType || 'SYNTAX_ERROR',
      errors: [parseResult.diagnostic],
      diagnostic: parseResult.diagnostic,
    };
  }

  const data = parseResult.data;
  const errors = [];

  // Title validation
  const title = (data.title && typeof data.title === 'string') ? data.title.trim() : '';
  if (!title) {
    errors.push("Field 'title' is missing or empty. Provide a descriptive title (e.g., 'Kuis Fotosintesis').");
  }

  // Soft coercion for category & summary
  const category = (data.category && typeof data.category === 'string') ? data.category.trim() : 'Umum';
  const summary = (data.summary && typeof data.summary === 'string')
    ? data.summary.trim()
    : `Kuis interaktif mengenai ${title || 'materi pembelajaran'}`;

  // Enum coercions
  const diffRaw = String(data.difficulty || 'medium').toLowerCase().trim();
  const difficulty = ['easy', 'medium', 'hard'].includes(diffRaw) ? diffRaw : 'medium';

  const iconRaw = String(data.icon || 'bulb').toLowerCase().trim();
  const icon = ['leaf', 'globe', 'bulb', 'atom', 'book', 'spark'].includes(iconRaw) ? iconRaw : 'bulb';

  const colorRaw = String(data.color || 'blue').toLowerCase().trim();
  const color = ['green', 'blue', 'purple', 'amber'].includes(colorRaw) ? colorRaw : 'blue';

  // Questions validation
  let rawQuestions = data.questions;
  if (typeof rawQuestions === 'string') {
    try {
      rawQuestions = JSON.parse(rawQuestions);
    } catch {
      rawQuestions = [];
    }
  }

  if (!Array.isArray(rawQuestions)) {
    errors.push("Field 'questions' must be an array of question objects.");
  } else if (rawQuestions.length === 0) {
    errors.push("Field 'questions' array is empty. At least 1 question is required (default around 20 questions).");
  }

  const validatedQuestions = [];

  if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
    rawQuestions.forEach((q, idx) => {
      const qNum = idx + 1;
      if (!q || typeof q !== 'object') {
        errors.push(`Question #${qNum} is not an object. Each item in 'questions' must be an object.`);
        return;
      }

      // question_text
      const qText = (q.question_text && typeof q.question_text === 'string') ? q.question_text.trim() : '';
      if (!qText) {
        errors.push(`Question #${qNum}: Missing or empty 'question_text'.`);
      }

      // options
      let rawOpts = q.options;
      if (typeof rawOpts === 'string') {
        try {
          rawOpts = JSON.parse(rawOpts);
        } catch {
          rawOpts = rawOpts.split(/\n|,/).map(s => s.trim()).filter(Boolean);
        }
      }

      if (!Array.isArray(rawOpts)) {
        errors.push(`Question #${qNum}: 'options' must be an array of choices.`);
        return;
      }

      const opts = rawOpts.map(o => String(o).trim()).filter(Boolean);
      if (opts.length < 2) {
        errors.push(`Question #${qNum}: 'options' must contain at least 2 distinct choices (found ${opts.length}).`);
        return;
      }

      // correct_answer matching & coercion
      const rawAns = String(q.correct_answer || '').trim();
      if (!rawAns) {
        errors.push(`Question #${qNum}: Missing 'correct_answer'.`);
        return;
      }

      let matchedAnswer = '';
      // 1. Exact match
      if (opts.includes(rawAns)) {
        matchedAnswer = rawAns;
      } else {
        // 2. Case-insensitive match
        const ci = opts.find(o => o.toLowerCase() === rawAns.toLowerCase());
        if (ci) {
          matchedAnswer = ci;
        } else {
          // 3. Choice letter / index matching (e.g. 'A' -> opts[0], 'B' -> opts[1])
          const letterIdx = ['a', 'b', 'c', 'd'].indexOf(rawAns.toLowerCase());
          if (letterIdx >= 0 && letterIdx < opts.length) {
            matchedAnswer = opts[letterIdx];
          } else {
            const numIdx = parseInt(rawAns, 10) - 1;
            if (!isNaN(numIdx) && numIdx >= 0 && numIdx < opts.length) {
              matchedAnswer = opts[numIdx];
            } else {
              // 4. Prefix stripped match (e.g. "C. Mitokondria" vs "Mitokondria")
              const strippedAns = stripOptionPrefix(rawAns);
              if (strippedAns) {
                const foundStripped = opts.find(
                  o => stripOptionPrefix(o).toLowerCase() === strippedAns.toLowerCase()
                );
                if (foundStripped) {
                  matchedAnswer = foundStripped;
                }
              }
            }
          }
        }
      }

      if (!matchedAnswer) {
        errors.push(
          `Question #${qNum}: 'correct_answer' ("${rawAns}") does not match any options: [${opts.map(o => `"${o}"`).join(', ')}]. 'correct_answer' must be identical to one of the choices in 'options'.`
        );
        return;
      }

      // explanation
      const explanation = (q.explanation && typeof q.explanation === 'string' && q.explanation.trim())
        ? q.explanation.trim()
        : 'Penjelasan jawaban kuis pembelajaran.';

      const points = Number(q.points) || 10;

      validatedQuestions.push({
        question_number: qNum,
        question_text: qText,
        question_type: 'multiple_choice',
        options: opts,
        correct_answer: matchedAnswer,
        explanation,
        points,
        is_solved: false,
      });
    });
  }

  if (errors.length > 0) {
    const diagnostic = formatAlgorithmicDiagnostic(errors);
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
      questions: validatedQuestions,
    },
  };
}

/**
 * Formats validation error list into a clear, actionable diagnostic message for the LLM.
 * @param {string[]} errors
 * @returns {string}
 */
export function formatAlgorithmicDiagnostic(errors = []) {
  const count = errors.length;
  const list = errors.map((err, idx) => `  ${idx + 1}. ${err}`).join('\n');
  return [
    `Algorithmic Validation Failed for tool 'create_quiz' (${count} issue${count > 1 ? 's' : ''}):`,
    list,
    '',
    'Required Action:',
    '- Fix the specified issues and call create_quiz again with corrected parameters.',
    '- Ensure all choices in options are distinct and correct_answer matches one of the options exactly.',
  ].join('\n');
}
