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
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-1.5-flash'];

function getGenAIClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. Add it to your .env file before using AI question generation.'
    );
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function callGeminiWithFailover(prompt, attachmentBuffer = null, mimeType = 'image/jpeg', maxAttempts = 5, stopAfterBusy = false) {
  const genai = getGenAIClient();

  for (const modelName of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

        const response = await genai.models.generateContent({
          model: modelName,
          contents: payload,
          config: {
            responseMimeType: 'application/json',
            responseSchema: QUESTION_SCHEMA,
            temperature: 0.4,
          },
        });

        return response;
      } catch (error) {
        const status = Number(error?.status || error?.response?.status || error?.code || 0);
        const message = (error?.message || '').toLowerCase();

        if (status === 404 || message.includes('404') || message.includes('not found') || message.includes('no longer available')) {
          console.warn(`[Gemini Failover] ${modelName} returned 404. Skipping to next backup model...`);
          break;
        }

        if (status === 503 || status === 429 || message.includes('503') || message.includes('429') || message.includes('high demand') || message.includes('overloaded')) {
          if (attempt < maxAttempts) {
            const baseDelay = 1500 * Math.pow(1.8, attempt - 1);
            const jitter = Math.random() * 800;
            const backoffMs = Math.min(baseDelay + jitter, 10000);
            console.warn(`[Gemini Retry] ${modelName} 503/high demand (Attempt ${attempt}/${maxAttempts}). Waiting${(backoffMs/1000).toFixed(1)}s...`);
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          }
          if (stopAfterBusy) throw error;
          break;
        }

        throw error;
      }
    }
  }

  throw new Error('All Gemini models are currently busy.');
}

async function extractPdfTextFallback(pdfBuffer) {
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
  if (!text) {
    throw new Error('No embedded text was found in the PDF; OCR fallback is disabled.');
  }
  return text;
}

async function generateQuestionsWithGroq(text, numberOfQuestions, questionTypes, customPrompt) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set; cannot generate questions from the extracted PDF text.');
  }

  const prompt = `Generate exactly ${numberOfQuestions} quiz questions from this extracted lesson text.
Use only these question types: ${questionTypes}.
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
    throw new Error('Groq returned no JSON content for PDF question generation.');
  }
  const parsed = JSON.parse(content);
  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new Error('Groq response did not contain a questions array.');
  }
  return JSON.stringify(parsed.questions);
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
 * @returns {Promise<Array>}          - Array of question objects
 */
async function generateQuizFromText(text, examId, numberOfQuestions = 10, questionTypes = ['multiple_choice', 'true_false', 'identification'], customPrompt = '', mimeType = '') {
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

    const isPdf = Buffer.isBuffer(text) || mimeType === 'application/pdf';
    const prompt = isPdf
      ? `Extract lesson concepts and generate ${numberOfQuestions} quiz questions from this attached PDF based on these options:${allowedTypes}. Return strictly valid JSON.`
      : `You are an expert quiz maker.

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

    let rawText;
    if (isPdf) {
      if (!Buffer.isBuffer(text)) {
        throw new Error('A PDF buffer is required when the MIME type is application/pdf.');
      }
      try {
        const response = await callGeminiWithFailover(prompt, text, 'application/pdf', 3, true);
        rawText = response.text?.trim() ?? '';
      } catch (geminiError) {
        console.warn('[generateQuizFromText] Gemini PDF request failed; trying extracted-text fallback:', geminiError.message);
        const extractedText = await extractPdfTextFallback(text);
        rawText = await generateQuestionsWithGroq(extractedText, numberOfQuestions, allowedTypes, customPrompt);
      }
    } else {
      const response = await callGeminiWithFailover(prompt);
      rawText = response.text?.trim() ?? '';
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

    console.log(`[generateQuizFromText] Generated ${questions.length} questions via AI.`);
    return questions;

  } catch (error) {
    console.error('[generateQuizFromText] AI question generation failed:', error.message);
    // Return empty array so the route can still respond (exam is already saved)
    return [];
  }
}

module.exports = { extractText, generateQuizFromText };
