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
      const importedPdf = require('pdf-parse');
      const pdfParse = typeof importedPdf === 'function'
        ? importedPdf
        : (importedPdf && typeof importedPdf.default === 'function'
          ? importedPdf.default
          : (importedPdf && typeof importedPdf.pdfParse === 'function' ? importedPdf.pdfParse : null));

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
function getGenAIClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. Add it to your .env file before using AI question generation.'
    );
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
 * @param {string} text              - Source passage to generate questions from
 * @param {string|number|null} examId - DB exam ID (used to persist questions)
 * @param {number} numberOfQuestions  - How many questions to request
 * @param {string[]} questionTypes    - Subset of: ['multiple_choice','true_false','identification']
 * @param {string} customPrompt       - Optional extra instructions for the AI
 * @returns {Promise<Array>}          - Array of question objects
 */
async function generateQuizFromText(text, examId, numberOfQuestions = 10, questionTypes = ['multiple_choice', 'true_false', 'identification'], customPrompt = '') {
  // ── Guard: API key must be present ──────────────────────────────────────
  if (!process.env.GEMINI_API_KEY) {
    console.error('[generateQuizFromText] GEMINI_API_KEY is missing. Returning empty question list.');
    return [];
  }

  try {
    const genai = getGenAIClient();

    // Build question type rules based on the requested types
    const allowedTypes = Array.isArray(questionTypes) && questionTypes.length > 0
      ? questionTypes
      : ['multiple_choice', 'true_false', 'identification'];

    const typeLabels = {
      multiple_choice: 'multiple_choice',
      true_false:      'true_false',
      identification:  'identification',
    };
    const allowedTypeNames = allowedTypes.map(t => typeLabels[t] || t).join(', ');

    const typeRules = [
      allowedTypes.includes('multiple_choice') && '- For multiple_choice: provide exactly 4 options (A, B, C, D) and set correctAnswer to the correct option text.',
      allowedTypes.includes('true_false')      && '- For true_false: set options to ["True", "False"] and correctAnswer to either "True" or "False".',
      allowedTypes.includes('identification')  && '- For identification: leave options as an empty array [] and set correctAnswer to the exact answer word or phrase.',
    ].filter(Boolean).join('\n');

    const customInstructions = customPrompt?.trim()
      ? `\nAdditional instructions from the teacher:\n"${customPrompt.trim()}"\n`
      : '';

    const prompt = `You are an expert quiz maker.

Analyze the following passage and generate exactly ${numberOfQuestions} quiz questions.
Only use these question types: ${allowedTypeNames}.
Distribute the questions evenly across the allowed types.
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

    let response;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await genai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema:   QUESTION_SCHEMA,
            temperature:      0.4,
          }
        });
        break;
      } catch (error) {
        lastError = error;
        const message = (error?.message || '').toLowerCase();
        const status = String(error?.status || error?.code || '');
        const isRetryableGeminiError = status === '503' || /503|service unavailable|high demand|overloaded|rate limit|too many requests|429/.test(message);

        if (attempt >= 3 || !isRetryableGeminiError) {
          throw error;
        }

        console.warn(`[generateQuizFromText] Gemini temporarily unavailable (attempt ${attempt}/3). Retrying in 2s...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // ── Parse response ───────────────────────────────────────────────────
    const rawText = response.text?.trim() ?? '';
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('[generateQuizFromText] Failed to parse Gemini JSON response:', rawText.slice(0, 500));
      throw new Error('Gemini returned malformed JSON.');
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Gemini response is not a JSON array.');
    }

    // Clamp to requested number
    const questions = parsed.slice(0, numberOfQuestions);

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

    console.log(`[generateQuizFromText] Generated ${questions.length} questions via Gemini AI.`);
    return questions;

  } catch (error) {
    console.error('[generateQuizFromText] AI question generation failed:', error.message);
    // Return empty array so the route can still respond (exam is already saved)
    return [];
  }
}

module.exports = { extractText, generateQuizFromText };
