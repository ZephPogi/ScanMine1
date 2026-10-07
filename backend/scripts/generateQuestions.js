process.env.PDFJS_DISABLE_WORKER = 'true';

const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
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

function callGeminiWithTimeout(callFn, timeoutMs = 10000) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Gemini request timed out after ${timeoutMs / 1000}s`)),
      timeoutMs
    );
  });

  return Promise.race([Promise.resolve().then(callFn), timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function callGeminiWithFailover(prompt, attachmentBuffer = null, mimeType = 'image/jpeg') {
  const genai = getGenAIClient();

  for (const modelName of GEMINI_MODELS.slice(0, MAX_GEMINI_ATTEMPTS)) {
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

      return await callGeminiWithTimeout(() => genai.models.generateContent({
        model: modelName,
        contents: payload,
        config: {
          responseMimeType: 'application/json',
          responseSchema: QUESTION_SCHEMA,
          temperature: 0.4,
        },
      }));
    } catch (error) {
      console.warn(`[Gemini Timeout] ${error.message}. Moving to next attempt/Groq fallback...`);
    }
  }

  throw new Error(`Gemini failed after ${MAX_GEMINI_ATTEMPTS} attempts.`);
}

async function extractPdfTextFallback(pdfBuffer) {
  try {
    const pdfModule = require('pdf-parse');
    let extractedText = '';

    if (typeof pdfModule === 'function') {
      const result = await pdfModule(pdfBuffer);
      extractedText = result?.text || '';
    } else {
      const PDFParse = pdfModule.PDFParse || pdfModule.default?.PDFParse;
      if (typeof PDFParse !== 'function') {
        throw new Error('pdf-parse does not expose a supported parser in this runtime.');
      }

      const parser = new PDFParse({ data: pdfBuffer });
      try {
        const result = await parser.getText();
        extractedText = result?.text || '';
      } finally {
        await parser.destroy();
      }
    }

    const text = extractedText.trim();
    if (text) {
      return text;
    }
    console.warn('[PDF Fallback] pdf-parse returned no embedded text; extracting PDF text tokens directly.');
  } catch (error) {
    console.warn(`[PDF Fallback] pdf-parse failed (${error.message}); extracting PDF text tokens directly.`);
  }

  const pdfSource = pdfBuffer.toString('binary');
  const textOperators = /\[((?:\\.|[^\]])*)\]\s*TJ\b|(\(((?:\\.|[^\\()])*)\))\s*Tj\b/g;
  const strings = [];
  let match;
  while ((match = textOperators.exec(pdfSource)) !== null) {
    const textArray = match[1];
    const singleText = match[3];
    const literals = textArray
      ? textArray.match(/\(((?:\\.|[^\\()])*)\)/g) || []
      : [`(${singleText})`];

    for (const literal of literals) {
      const value = literal.slice(1, -1)
        .replace(/\\([nrtbf()\\])/g, (_, escaped) => ({
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
        }[escaped] || escaped))
        .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
      if (value.trim()) strings.push(value);
    }
  }

  const text = strings.join(' ').replace(/\s+/g, ' ').trim();
  return text || 'No readable text could be extracted from the PDF.';
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

function validateQuestionBreakdownOrder(questions, questionBreakdown) {
  if (!questionBreakdown) return;

  let questionIndex = 0;
  for (const section of questionBreakdown) {
    for (let item = 0; item < section.count; item += 1) {
      if (questions[questionIndex]?.type !== section.type) {
        throw new Error(`Generated questions do not match the requested section order at question ${questionIndex + 1}.`);
      }
      questionIndex += 1;
    }
  }
  if (questions.length !== questionIndex) {
    throw new Error(`Expected exactly ${questionIndex} questions from the requested breakdown.`);
  }
}

async function generateQuestionsWithGroq(text, numberOfQuestions, questionTypes, customPrompt, questionBreakdown) {
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
      model: 'qwen/qwen3.8-27b',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq question generation failed (${response.status}): ${errorText}`);
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

function normalizeMultipleChoiceAnswers(questions) {
  const optionLetters = ['A', 'B', 'C', 'D'];

  return questions.map((question) => {
    if (question.type !== 'multiple_choice') return question;

    const options = Array.isArray(question.options) ? question.options : [];
    const cleanOptions = options.map((option) => (
      typeof option === 'string'
        ? option.replace(/^\s*[A-D]\s*[.)]\s*/i, '')
        : option
    ));
    question.options = cleanOptions;

    const answer = typeof question.correctAnswer === 'string'
      ? question.correctAnswer.trim()
      : '';
    const letterMatch = answer.match(/^([A-D])(?:\s*[).:-]|\s*\(|$)/i);
    if (letterMatch) {
      question.correctAnswer = letterMatch[1].toUpperCase();
      return question;
    }

    if (answer.length > 1) {
      const normalizedAnswer = answer.toLowerCase();
      let matchingIndex = cleanOptions.findIndex(
        option => typeof option === 'string' && option.trim().toLowerCase() === normalizedAnswer
      );
      if (matchingIndex < 0) {
        matchingIndex = cleanOptions.findIndex(
          option => typeof option === 'string'
            && option.trim()
            && (option.toLowerCase().includes(normalizedAnswer) || normalizedAnswer.includes(option.trim().toLowerCase()))
        );
      }
      if (matchingIndex >= 0 && matchingIndex < optionLetters.length) {
        question.correctAnswer = optionLetters[matchingIndex];
      }
    }
    if (!optionLetters.includes(question.correctAnswer)) {
      throw new Error('A multiple-choice answer could not be mapped to A, B, C, or D.');
    }
    return question;
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
 * @param {string|number|null} examId - DB exam ID (used to persist questions)
 * @param {number} numberOfQuestions  - How many questions to request
 * @param {string[]} questionTypes    - Subset of: ['multiple_choice','true_false','identification']
 * @param {string} customPrompt       - Optional extra instructions for the AI
 * @param {string} mimeType           - MIME type of the source file, when available
 * @param {Array<{type: string, count: number}>|null} questionBreakdown - Ordered question sections
 * @returns {Promise<Array>}          - Array of question objects
 */
async function generateQuizFromText(text, examId, numberOfQuestions = 10, questionTypes = ['multiple_choice', 'true_false', 'identification'], customPrompt = '', mimeType = '', questionBreakdown = null) {
  // ── Guard: API key must be present ──────────────────────────────────────
  if (!process.env.GEMINI_API_KEY) {
    console.error('[generateQuizFromText] GEMINI_API_KEY is missing. Returning empty question list.');
    return [];
  }

  try {
    // Build question type rules based on the requested types
    const allowedTypes = Array.isArray(questionTypes) && questionTypes.length > 0
      ? questionTypes
      : ['multiple_choice', 'true_false', 'identification'];
    const normalizedBreakdown = normalizeQuestionBreakdown(questionBreakdown, allowedTypes);
    const requestedQuestionCount = normalizedBreakdown
      ? normalizedBreakdown.reduce((total, section) => total + section.count, 0)
      : numberOfQuestions;
    const breakdownInstructions = createBreakdownInstructions(normalizedBreakdown);

    const typeLabels = {
      multiple_choice: 'multiple_choice',
      true_false:      'true_false',
      identification:  'identification',
    };
    const allowedTypeNames = allowedTypes.map(t => typeLabels[t] || t).join(', ');

    const typeRules = [
      allowedTypes.includes('multiple_choice') && '- For multiple_choice: provide exactly 4 options (A, B, C, D) and set correctAnswer to the corresponding option letter.',
      allowedTypes.includes('true_false')      && '- For true_false: set options to ["True", "False"] and correctAnswer to either "True" or "False".',
      allowedTypes.includes('identification')  && '- For identification: leave options as an empty array [] and set correctAnswer to the exact answer word or phrase.',
    ].filter(Boolean).join('\n');
    const multipleChoiceInstruction = "CRITICAL FOR MULTIPLE CHOICE: For 'multiple_choice' items, 'correctAnswer' MUST be strictly a single uppercase letter corresponding to the correct choice ('A', 'B', 'C', or 'D'). Do NOT put the full text or word in 'correctAnswer'.";

    const customInstructions = customPrompt?.trim()
      ? `\nAdditional instructions from the teacher:\n"${customPrompt.trim()}"\n`
      : '';

    const isPdf = Buffer.isBuffer(text) || mimeType === 'application/pdf';
    const prompt = isPdf
      ? `Extract lesson concepts from this attached PDF. ${breakdownInstructions || `Generate ${requestedQuestionCount} quiz questions based on these options: ${allowedTypes}.`}\n${multipleChoiceInstruction}\nReturn strictly valid JSON.`
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
${text.slice(0, 12000)}
"""

JSON output:`;

    let rawText;
    try {
      if (isPdf && !Buffer.isBuffer(text)) {
        throw new Error('A PDF buffer is required when the MIME type is application/pdf.');
      }
      const response = isPdf
        ? await callGeminiWithFailover(prompt, text, 'application/pdf')
        : await callGeminiWithFailover(prompt);
      rawText = response.text?.trim() ?? '';
    } catch {
      const fallbackText = isPdf ? await extractPdfTextFallback(text) : text;
      rawText = await generateQuestionsWithGroq(
        fallbackText,
        requestedQuestionCount,
        normalizedBreakdown ? normalizedBreakdown.map(section => section.type) : allowedTypes,
        customPrompt,
        normalizedBreakdown
      );
    }

    // ── Parse response ───────────────────────────────────────────────────
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('[generateQuizFromText] Failed to parse AI JSON response:', rawText.slice(0, 500));
      throw new Error('AI returned malformed JSON.');
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Gemini response is not a JSON array.');
    }

    if (normalizedBreakdown && parsed.length !== requestedQuestionCount) {
      throw new Error(`Expected exactly ${requestedQuestionCount} questions from the requested breakdown.`);
    }

    const questions = normalizeMultipleChoiceAnswers(
      parsed.slice(0, requestedQuestionCount)
    );
    validateQuestionBreakdownOrder(questions, normalizedBreakdown);

    // ── Persist to DB if examId is provided ──────────────────────────────
    for (const q of questions) {
      if (examId) {
        try {
          await db.query(
            'INSERT INTO Generated_Questions (exam_id, question_text, correct_answer) VALUES ($1, $2, $3)',
            [examId, q.question, q.correctAnswer]
          );
        } catch (dbErr) {
          // Non-fatal: log and continue
          console.warn('[generateQuizFromText] DB insert skipped for question:', q.question, dbErr.message);
        }
      }
    }

    console.log(`[generateQuizFromText] Generated ${questions.length} questions via AI.`);
    return questions;

  } catch (error) {
    console.error('[generateQuizFromText] AI question generation failed:', error.message);
    // Return empty array so the route can still respond (exam is already saved)
    return [];
  }
}

module.exports = { extractText, generateQuizFromText };
