process.env.PDFJS_DISABLE_WORKER = 'true';

const fs = require('fs');
const os = require('os');
const path = require('path');
const OCRRouter = require('./ocrRouter');
const { GoogleGenAI } = require('@google/genai');

/**
 * Extracts text from a file buffer (PDF or plain text)
 * Uses dual-OCR strategy: Tesseract with LSTM for PDFs
 */
async function extractText(filePath, mimetype, fileBuffer = null) {
  if (mimetype === 'application/pdf') {
    // ── Primary path: OCR Router (Tesseract + OCR.space) ──────────────────
    try {
      const ocrRouter = new OCRRouter();
      const text = await ocrRouter.processAnswerKey(filePath, mimetype, fileBuffer);

      console.log('--- PDF EXTRACTED TEXT (Dual-OCR) ---');
      console.log(text);
      console.log('-------------------------------------');

      return text || "PDF Content (Empty or unreadable)";
    } catch (e) {
      console.error("PDF Extraction failed:", e.message);
    }

    // ── HF fallback guard (prevent ENOTFOUND when URL is unset/placeholder) ──
    const hfUrl = process.env.HF_SPACE_URL;
    const hfReady = hfUrl && !hfUrl.includes('your-hf-space-url');
    if (!hfReady) {
      console.warn('[extractText] HF_SPACE_URL is not configured or is a placeholder — skipping HF OCR fallback to prevent ENOTFOUND errors.');
    }

    // ── Secondary path: pdf-parse → scanned-PDF OCR via temp file ─────────
    // pdf-parse exports a plain async function — never instantiate it as a class.
    // If it returns empty text (scanned/image PDF), fall through to temp-file OCR.
    let tempPath = null;
    try {
      let pdfParse;
      try {
        const rawPdfParse = require('pdf-parse');
        pdfParse = typeof rawPdfParse === 'function' ? rawPdfParse : (rawPdfParse.default || rawPdfParse);
      } catch (e) {
        console.error('pdf-parse initialization failed:', e);
      }

      if (!pdfParse) {
        throw new Error('pdf-parse export is unavailable in this runtime.');
      }

      // Guard: filePath may itself be a Buffer (Supabase/Multer memory storage).
      // Never pass a Buffer object to fs.readFileSync — use it directly instead.
      const dataBuffer = fileBuffer
        || (Buffer.isBuffer(filePath) ? filePath : fs.readFileSync(filePath));
      const data = await pdfParse(dataBuffer);
      const extractedText = (data && data.text ? data.text : '').trim();

      if (extractedText.length > 0) {
        // Digital PDF — text layer found, return immediately.
        return extractedText;
      }

      // Empty text = scanned/image PDF. Attempt OCR via a real temp file.
      // NEVER pass a raw Buffer as a file path to fs.* or OCR functions.
      console.warn('[extractText] pdf-parse returned empty text (scanned PDF). Attempting temp-file OCR fallback.');

      const bufferToWrite = fileBuffer || dataBuffer;
      if (!Buffer.isBuffer(bufferToWrite)) {
        throw new Error('No valid buffer available for scanned-PDF OCR fallback.');
      }

      // Write the buffer to a real temporary file.
      tempPath = path.join(os.tmpdir(), `scanmine_ocr_${Date.now()}.pdf`);
      fs.writeFileSync(tempPath, bufferToWrite);

      // Run OCR on the real file path (not a Buffer).
      const ocrRouter = new OCRRouter();
      const ocrText = await ocrRouter.processAnswerKey(tempPath, mimetype, null);
      const finalText = (ocrText || '').trim();

      if (finalText.length === 0) {
        console.warn('[extractText] Scanned PDF OCR fallback also returned empty text.');
        return "PDF Content (Scanned image could not be read. Please enter the answer key manually.)";
      }

      return finalText;

    } catch (fallbackError) {
      console.error("Fallback PDF extraction also failed:", fallbackError.message);
      return "PDF Content (Extraction failed. Please enter the answer key manually.)";
    } finally {
      // Always clean up the temp file, even if OCR or downstream code throws.
      if (tempPath) {
        try { fs.unlinkSync(tempPath); } catch (_) { /* ignore cleanup errors */ }
      }
    }

  } else {
    // Plain text — if buffer provided, convert directly; otherwise read from disk.
    if (fileBuffer) {
      return fileBuffer.toString('utf8');
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}

/**
 * Returns an initialised GoogleGenAI client.
 * Throws a descriptive error early if the API key is absent.
 */
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const MAX_GEMINI_ATTEMPTS = 2;

function getGenAIClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. Add it to your .env file before using AI question generation.'
    );
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

function callGeminiWithTimeout(callFn, timeoutMs = 10000, abortSignal = null) {
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  if (abortSignal?.aborted) {
    controller.abort();
  } else {
    abortSignal?.addEventListener('abort', abortRequest, { once: true });
  }

  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => {
        controller.abort();
        reject(new Error(`Gemini request timed out after ${timeoutMs / 1000}s`));
      },
      timeoutMs
    );
  });

  return Promise.race([
    Promise.resolve().then(() => callFn(controller.signal)),
    timeout,
  ]).finally(() => {
    clearTimeout(timeoutId);
    abortSignal?.removeEventListener('abort', abortRequest);
  });
}

async function callGeminiWithFailover(
  prompt,
  attachmentBuffer = null,
  mimeType = 'image/jpeg',
  modelNames = GEMINI_MODELS.slice(0, MAX_GEMINI_ATTEMPTS),
  abortSignal = null
) {
  const genai = getGenAIClient();

  for (const modelName of modelNames) {
    try {
      const payload = attachmentBuffer
        ? [
            { text: prompt },
            {
              inlineData: {
                data: Buffer.isBuffer(attachmentBuffer)
                  ? attachmentBuffer.toString('base64')
                  : Buffer.from(attachmentBuffer).toString('base64'),
                mimeType,
              },
            },
          ]
        : prompt;

      return await callGeminiWithTimeout(requestSignal => genai.models.generateContent({
        model: modelName,
        contents: payload,
        config: {
          responseMimeType: 'application/json',
          responseSchema: QUESTION_SCHEMA,
          temperature: 0.4,
          abortSignal: requestSignal,
        },
      }), 10000, abortSignal);
    } catch (error) {
      if (abortSignal?.aborted) throw error;
      console.warn(`[Gemini Timeout] ${error.message}. Moving to next attempt/Groq fallback...`);
    }
  }

  throw new Error(`Gemini failed after ${modelNames.length} attempts.`);
}

async function extractPdfTextFallback(pdfBuffer) {
  const safeBuffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer.subarray(0, 300000) : pdfBuffer;
  const fallbackText = Buffer.isBuffer(safeBuffer)
    ? safeBuffer.subarray(0, 12000).toString('utf8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  const createTextFromPdfTokens = () => {
    if (!Buffer.isBuffer(safeBuffer)) return fallbackText || 'No readable text could be extracted from the PDF.';
    const pdfSource = safeBuffer.toString('binary');
    const textOperators = /\[((?:\\.|[^\]])*)\]\s*TJ\b|(\(((?:\\.|[^\\()])*)\))\s*Tj\b/g;
    const strings = [];
    const startedAt = Date.now();
    let match;
    let iterations = 0;
    let matchCount = 0;
    let collectedLength = 0;
    let timedOut = false;

    while (iterations < 500 && matchCount < 500 && Date.now() - startedAt <= 1000
      && (match = textOperators.exec(pdfSource)) !== null) {
      iterations += 1;
      matchCount += 1;
      const textArray = match[1];
      const singleText = match[3];
      if (textArray) {
        const literalPattern = /\(((?:\\.|[^\\()])*)\)/g;
        let literalMatch;
        while (matchCount < 500 && Date.now() - startedAt <= 1000
          && (literalMatch = literalPattern.exec(textArray)) !== null) {
          matchCount += 1;
          const value = literalMatch[1].slice(0, Math.max(0, 12000 - collectedLength));
          strings.push(value);
          collectedLength += value.length + 1;
          if (collectedLength >= 12000) break;
        }
        if (Date.now() - startedAt > 1000) timedOut = true;
      } else if (singleText) {
        const value = singleText.slice(0, Math.max(0, 12000 - collectedLength));
        strings.push(value);
        collectedLength += value.length + 1;
      }

      if (Date.now() - startedAt > 1000) {
        timedOut = true;
        break;
      }
    }

    const extractedText = strings
      .join(' ')
      .replace(/\\([nrtbf()\\])/g, (_, escaped) => ({
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
      }[escaped] || escaped))
      .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);

    if (timedOut || Date.now() - startedAt > 1000) {
      console.warn('[PDF Fallback] PDF token extraction exceeded 1000ms; returning truncated text.');
      return extractedText || fallbackText || 'PDF text extraction timed out.';
    }
    return extractedText || fallbackText || 'No readable text could be extracted from the PDF.';
  };

  if (!Buffer.isBuffer(pdfBuffer)) {
    return 'No readable text could be extracted from the PDF.';
  }

  let parserTimeoutId;
  try {
    const pdfParse = require('pdf-parse');
    const parsePromise = pdfParse(pdfBuffer, { max: 15 });
    const parseTimeout = new Promise((_, reject) => {
      parserTimeoutId = setTimeout(() => reject(new Error('PDF parsing exceeded 1000ms.')), 1000);
    });
    const pdfData = await Promise.race([parsePromise, parseTimeout]);
    const extractedText = typeof pdfData?.text === 'string' ? pdfData.text.trim() : '';
    if (extractedText) return extractedText.slice(0, 12000);
    console.warn('[PDF Fallback] pdf-parse returned no embedded text; extracting bounded PDF text tokens.');
  } catch (error) {
    console.warn(`[PDF Fallback] pdf-parse failed (${error.message}); returning bounded PDF text.`);
    if (/exceeded 1000ms/.test(error.message)) {
      return fallbackText || 'PDF text extraction timed out.';
    }
  } finally {
    clearTimeout(parserTimeoutId);
  }

  return createTextFromPdfTokens();
}

const QUESTION_TYPE_LABELS = {
  multiple_choice: 'Multiple Choice',
  true_false: 'True / False',
  identification: 'Identification',
};

function createBreakdownInstructions(questionBreakdown) {
  if (!questionBreakdown) return '';

  let questionNumber = 1;
  const sections = questionBreakdown.map((section, index) => {
    const endQuestion = questionNumber + section.count - 1;
    const typeInstruction = section.type === 'multiple_choice'
      ? '4 choices A-D, correctAnswer MUST be a single letter A-D'
      : section.type === 'true_false'
        ? "correctAnswer MUST be 'True' or 'False'"
        : 'correctAnswer MUST be the exact answer word or phrase';
    const sectionText = `- Section ${index + 1} (Questions ${questionNumber} to ${endQuestion}): ${QUESTION_TYPE_LABELS[section.type]} (${typeInstruction}).`;
    questionNumber = endQuestion + 1;
    return sectionText;
  });
  const totalQuestions = questionNumber - 1;
  return `Generate a quiz with exactly ${totalQuestions} questions strictly ordered into the following numbered sections:\n${sections.join('\n')}\nReturn strictly valid JSON array of questions maintaining this EXACT sequence.`;
}

function normalizeQuestionBreakdown(questionBreakdown, allowedTypes) {
  if (questionBreakdown == null) return null;
  if (!Array.isArray(questionBreakdown) || questionBreakdown.length === 0) {
    throw new Error('Question breakdown must be a non-empty ordered array.');
  }

  const seenTypes = new Set();
  const normalized = questionBreakdown.map(section => {
    if (!section || !allowedTypes.includes(section.type) || seenTypes.has(section.type)) {
      throw new Error('Question breakdown contains an invalid or duplicate question type.');
    }
    if (!Number.isInteger(section.count) || section.count < 1) {
      throw new Error('Each enabled question section must have a positive whole-number count.');
    }
    seenTypes.add(section.type);
    return { type: section.type, count: section.count };
  });
  return normalized;
}

async function generateQuestionsWithGroq(
  text,
  numberOfQuestions,
  questionTypes,
  customPrompt,
  questionBreakdown,
  model = 'qwen/qwen3.8-27b',
  abortSignal = null
) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set; cannot generate questions from the lesson text.');
  }

  const breakdownInstructions = createBreakdownInstructions(questionBreakdown);
  const prompt = `Generate exactly ${numberOfQuestions} quiz questions from this lesson text.
Use only these question types: ${questionTypes}.
CRITICAL FOR MULTIPLE CHOICE: For 'multiple_choice' items, 'correctAnswer' MUST be strictly a single uppercase letter corresponding to the correct choice ('A', 'B', 'C', or 'D'). Do NOT put the full text or word in 'correctAnswer'.
${breakdownInstructions}
${customPrompt?.trim() ? `Additional teacher instructions: ${customPrompt.trim()}\n` : ''}
Return a JSON object with a "questions" array. Each question must have "question", "options", "correctAnswer", and "type" fields.

Lesson text:
"""
${text.slice(0, 12000)}
"""`;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Groq question generation failed (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Groq returned no JSON content for question generation.');
  }
  const parsed = JSON.parse(content);
  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new Error('Groq response did not contain a questions array.');
  }
  return JSON.stringify(parsed.questions);
}

function getLessonFacts(text) {
  return String(text || '')
    .split(/(?:[.!?]\s+|\r?\n+|;\s+)/)
    .map(fact => fact.replace(/\s+/g, ' ').trim())
    .filter(fact => fact.length > 8);
}

function createLocalQuestions(text, questionCount, questionTypes, questionBreakdown) {
  const facts = getLessonFacts(text);
  const safeFacts = facts.length ? facts : ['The lesson introduces its main topic and explains its key concepts.'];
  const requestedTypes = questionBreakdown
    ? questionBreakdown.flatMap(section => Array(section.count).fill(section.type))
    : Array.from({ length: questionCount }, (_, index) => questionTypes[index % questionTypes.length]);

  return requestedTypes.map((type, index) => {
    const fact = safeFacts[index % safeFacts.length];
    if (type === 'true_false') {
      return {
        question: `True or False: ${fact}`,
        options: ['True', 'False'],
        correctAnswer: 'True',
        type,
      };
    }
    if (type === 'identification') {
      return {
        question: `What key information does the lesson state?`,
        options: [],
        correctAnswer: fact,
        type,
      };
    }

    const distractors = safeFacts
      .filter((candidate, candidateIndex) => candidate !== fact && candidateIndex !== index)
      .slice(0, 3);
    const options = [fact, ...distractors];
    const genericDistractors = [
      'It describes an unrelated process.',
      'It states the opposite of the lesson.',
      'It gives an example outside the topic.',
    ];
    for (const distractor of genericDistractors) {
      if (options.length >= 4) break;
      options.push(distractor);
    }
    return {
      question: 'According to the lesson, which statement is correct?',
      options,
      correctAnswer: 'A',
      type: 'multiple_choice',
    };
  });
}

function repairGeneratedQuestions(questions, lessonText, questionCount, questionTypes, questionBreakdown) {
  const expectedTypes = questionBreakdown
    ? questionBreakdown.flatMap(section => Array(section.count).fill(section.type))
    : Array.from({ length: questionCount }, (_, index) => questionTypes[index % questionTypes.length]);
  const localQuestions = createLocalQuestions(lessonText, expectedTypes.length, questionTypes, questionBreakdown);
  const facts = getLessonFacts(lessonText);
  const optionLetters = ['A', 'B', 'C', 'D'];

  return expectedTypes.map((type, index) => {
    const item = questions[index] && typeof questions[index] === 'object' ? questions[index] : {};
    const fallback = localQuestions[index];
    const repaired = {
      ...item,
      question: typeof item.question === 'string' && item.question.trim()
        ? item.question.trim()
        : fallback.question,
      type,
    };

    if (type === 'true_false') {
      const answer = String(item.correctAnswer || '').trim().toLowerCase();
      repaired.options = ['True', 'False'];
      repaired.correctAnswer = answer === 'false' ? 'False' : 'True';
      return repaired;
    }

    if (type === 'identification') {
      repaired.options = [];
      repaired.correctAnswer = typeof item.correctAnswer === 'string' && item.correctAnswer.trim()
        ? item.correctAnswer.trim()
        : fallback.correctAnswer;
      return repaired;
    }

    let options = Array.isArray(item.options)
      ? item.options.filter(option => typeof option === 'string' && option.trim())
        .map(option => option.replace(/^\s*[A-D]\s*[.)]\s*/i, '').trim())
      : [];
    options = [...new Set(options)].slice(0, 4);
    const rawAnswer = typeof item.correctAnswer === 'string' ? item.correctAnswer.trim() : '';
    const answerMatch = rawAnswer.match(/^([A-D])(?:\s*[).:-]|\s*\(|$)/i);
    let correctIndex = answerMatch ? optionLetters.indexOf(answerMatch[1].toUpperCase()) : -1;
    const matchingAnswer = rawAnswer
      ? options.findIndex(option => option.toLowerCase() === rawAnswer.toLowerCase())
      : -1;
    if (matchingAnswer >= 0) correctIndex = matchingAnswer;

    if (!options.length && rawAnswer && !answerMatch) {
      options.push(rawAnswer);
      correctIndex = 0;
    } else if (options.length && rawAnswer && !answerMatch && matchingAnswer < 0) {
      options[0] = rawAnswer;
      correctIndex = 0;
    }
    const candidates = [...facts, ...fallback.options];
    for (const candidate of candidates) {
      if (options.length >= 4) break;
      if (typeof candidate === 'string' && candidate.trim()
        && !options.some(option => option.toLowerCase() === candidate.trim().toLowerCase())) {
        options.push(candidate.trim());
      }
    }
    while (options.length < 4) {
      options.push(`None of the above (${options.length + 1})`);
    }
    if (correctIndex < 0 || correctIndex >= 4) correctIndex = 0;
    repaired.options = options;
    repaired.correctAnswer = optionLetters[correctIndex];
    return repaired;
  });
}

// JSON schema that Gemini must conform to for each question
const QUESTION_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      question:      { type: 'string' },
      options:       { type: 'array', items: { type: 'string' } },
      correctAnswer: { type: 'string' },
      type:          { type: 'string', enum: ['multiple_choice', 'true_false', 'identification'] }
    },
    required: ['question', 'correctAnswer', 'type']
  }
};

/**
 * Uses Google Gemini (gemini-3.6-flash) to generate quiz questions from text.
 *
 * @param {string|Buffer} text       - Source passage or uploaded PDF buffer
 * @param {number} numberOfQuestions  - How many questions to request
 * @param {string[]} questionTypes    - Subset of: ['multiple_choice','true_false','identification']
 * @param {string} customPrompt       - Optional extra instructions for the AI
 * @param {string} mimeType           - MIME type of the source file, when available
 * @param {Array<{type: string, count: number}>|null} questionBreakdown - Ordered question sections
 * @returns {Promise<{success: true, items: Array}>} - Generated or locally repaired questions
 */
function generateLocalQuizQuestions(text, numberOfQuestions = 10, questionTypes = ['multiple_choice', 'true_false', 'identification'], questionBreakdown = null) {
  const defaultTypes = ['multiple_choice', 'true_false', 'identification'];
  const allowedTypes = Array.isArray(questionTypes)
    ? [...new Set(questionTypes.filter(type => defaultTypes.includes(type)))]
    : [];
  const safeTypes = allowedTypes.length ? allowedTypes : defaultTypes;
  const normalizedBreakdown = normalizeQuestionBreakdown(questionBreakdown, safeTypes);
  const requestedQuestionCount = normalizedBreakdown
    ? normalizedBreakdown.reduce((total, section) => total + section.count, 0)
    : Number.isSafeInteger(numberOfQuestions) && numberOfQuestions > 0
      ? numberOfQuestions
      : 10;

  return repairGeneratedQuestions(
    [],
    String(text || ''),
    requestedQuestionCount,
    safeTypes,
    normalizedBreakdown
  );
}

function isQuotaExhausted(error) {
  const message = String(error?.message || error || '');
  return error?.status === 429
    || error?.response?.status === 429
    || /RESOURCE_EXHAUSTED|quota/i.test(message);
}

async function generateQuizFromText(text, numberOfQuestions = 10, questionTypes = ['multiple_choice', 'true_false', 'identification'], customPrompt = '', mimeType = '', questionBreakdown = null, options = {}) {
  const { signal } = options;
  const defaultTypes = ['multiple_choice', 'true_false', 'identification'];
  const allowedTypes = Array.isArray(questionTypes)
    ? [...new Set(questionTypes.filter(type => defaultTypes.includes(type)))]
    : [];
  const safeTypes = allowedTypes.length ? allowedTypes : defaultTypes;
  let normalizedBreakdown = null;
  try {
    normalizedBreakdown = normalizeQuestionBreakdown(questionBreakdown, safeTypes);
  } catch (error) {
    console.warn('[generateQuizFromText] Ignoring invalid question breakdown:', error.message);
  }
  const requestedQuestionCount = normalizedBreakdown
    ? normalizedBreakdown.reduce((total, section) => total + section.count, 0)
    : Number.isSafeInteger(numberOfQuestions) && numberOfQuestions > 0
      ? numberOfQuestions
      : 10;
  let lessonText = Buffer.isBuffer(text)
    ? (mimeType === 'application/pdf' ? await extractPdfTextFallback(text) : text.toString('utf8'))
    : String(text || '');
  const localFallback = () => ({
    success: true,
    items: generateLocalQuizQuestions(lessonText, requestedQuestionCount, safeTypes, normalizedBreakdown),
    provider: 'local-fallback',
  });
  if (lessonText.replace(/\s+/g, ' ').trim().length < 50) {
    console.warn('[generateQuizFromText] Source text is too short; generating questions locally.');
    return localFallback();
  }

  try {
    const breakdownInstructions = createBreakdownInstructions(normalizedBreakdown);

    const typeLabels = {
      multiple_choice: 'multiple_choice',
      true_false:      'true_false',
      identification:  'identification',
    };
    const allowedTypeNames = safeTypes.map(t => typeLabels[t] || t).join(', ');

    const typeRules = [
      safeTypes.includes('multiple_choice') && '- For multiple_choice: provide exactly 4 options (A, B, C, D) and set correctAnswer to the corresponding option letter.',
      safeTypes.includes('true_false')      && '- For true_false: set options to ["True", "False"] and correctAnswer to either "True" or "False".',
      safeTypes.includes('identification')  && '- For identification: leave options as an empty array [] and set correctAnswer to the exact answer word or phrase.',
    ].filter(Boolean).join('\n');
    const multipleChoiceInstruction = "CRITICAL FOR MULTIPLE CHOICE: For 'multiple_choice' items, 'correctAnswer' MUST be strictly a single uppercase letter corresponding to the correct choice ('A', 'B', 'C', or 'D'). Do NOT put the full text or word in 'correctAnswer'.";

    const customInstructions = customPrompt?.trim()
      ? `\nAdditional instructions from the teacher:\n"${customPrompt.trim()}"\n`
      : '';

    const isPdf = Buffer.isBuffer(text) || mimeType === 'application/pdf';
    const prompt = isPdf
      ? `Extract lesson concepts from this attached PDF. ${breakdownInstructions || `Generate ${requestedQuestionCount} quiz questions based on these options: ${safeTypes}.`}\n${multipleChoiceInstruction}\nReturn strictly valid JSON.`
      : `You are an expert quiz maker.

Analyze the following passage and generate exactly ${requestedQuestionCount} quiz questions.
Only use these question types: ${allowedTypeNames}.
${normalizedBreakdown ? '' : 'Distribute the questions evenly across the allowed types.'}
${breakdownInstructions}
${multipleChoiceInstruction}
${customInstructions}
Rules:
${typeRules}
- All questions must be directly answerable from the passage.
- Return ONLY a JSON array — no markdown, no extra text.

Passage:
"""
${lessonText.slice(0, 12000)}
"""

JSON output:`;

    const CANDIDATE_MODELS = [
      { provider: 'groq', model: process.env.GROQ_QUIZ_PARSE_MODEL || 'llama-3.3-70b-versatile' },
      { provider: 'groq', model: 'llama-3.1-8b-instant' },
      { provider: 'gemini', model: process.env.GEMINI_QUIZ_PARSE_MODEL || 'gemini-1.5-flash' },
    ];

    for (const candidate of CANDIDATE_MODELS) {
      try {
        let rawText;
        if (candidate.provider === 'groq') {
          rawText = await generateQuestionsWithGroq(
            lessonText,
            requestedQuestionCount,
            normalizedBreakdown ? normalizedBreakdown.map(section => section.type) : safeTypes,
            customPrompt,
            normalizedBreakdown,
            candidate.model,
            signal
          );
        } else {
          if (isPdf && !Buffer.isBuffer(text)) {
            throw new Error('A PDF buffer is required when the MIME type is application/pdf.');
          }
          const response = await callGeminiWithFailover(
            prompt,
            isPdf ? text : null,
            'application/pdf',
            [candidate.model],
            signal
          );
          rawText = response.text?.trim() ?? '';
        }

        let parsed = JSON.parse(rawText);
        if (!Array.isArray(parsed)) parsed = parsed?.questions;
        if (!Array.isArray(parsed)) throw new Error(`${candidate.provider} returned no questions array.`);

        const items = repairGeneratedQuestions(
          parsed,
          lessonText,
          requestedQuestionCount,
          safeTypes,
          normalizedBreakdown
        );
        console.log(`[generateQuizFromText] Generated ${items.length} questions via ${candidate.provider}.`);
        return { success: true, items, provider: candidate.provider };
      } catch (error) {
        if (signal?.aborted) throw error;
        if (isQuotaExhausted(error)) {
          console.warn(`[AI Loop] ${candidate.provider} model quota exhausted (429). Skipping immediately to the next model.`);
          continue;
        }
        console.warn(`[AI Loop] ${candidate.provider} model ${candidate.model} failed: ${error.message}`);
      }
    }

    return localFallback();

  } catch (error) {
    console.error('[generateQuizFromText] AI question generation failed:', error.message);
    return localFallback();
  }
}

module.exports = {
  extractText,
  extractPdfTextFallback,
  generateLocalQuizQuestions,
  generateQuizFromText,
};
