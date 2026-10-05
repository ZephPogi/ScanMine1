const Tesseract = require('tesseract.js');
const db = require('../db');
const ScannerLogic = require('./scannerLogic');
const OCRRouter = require('./ocrRouter');

const isVercelRuntime = () => process.env.VERCEL === 'true' || process.env.VERCEL === true || process.env.VERCEL === '1';

// Lazy-loaded only when Gemini fallback is triggered
let _GoogleGenerativeAI = null;
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

function getGoogleGenerativeAI() {
  if (!_GoogleGenerativeAI) {
    _GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
  }
  return _GoogleGenerativeAI;
}

async function callGeminiWithFailover(prompt, imageBuffer = null) {
  const GoogleGenerativeAI = getGoogleGenerativeAI();
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const MAX_ATTEMPTS = 5;

  for (const modelName of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });

        const payload = imageBuffer
          ? [
              prompt,
              {
                inlineData: {
                  data: Buffer.isBuffer(imageBuffer)
                    ? imageBuffer.toString('base64')
                    : Buffer.from(imageBuffer).toString('base64'),
                  mimeType: 'image/jpeg',
                },
              },
            ]
          : prompt;

        return await model.generateContent(payload);
      } catch (error) {
        const status = Number(error?.status || error?.response?.status || error?.code || 0);
        const message = (error?.message || '').toLowerCase();

        if (status === 404 || message.includes('404') || message.includes('not found') || message.includes('no longer available')) {
          console.warn(`[Gemini Failover] ${modelName} returned 404. Skipping to next backup model...`);
          break;
        }

        if (status === 503 || status === 429 || message.includes('503') || message.includes('429') || message.includes('high demand') || message.includes('overloaded')) {
          if (attempt < MAX_ATTEMPTS) {
            const baseDelay = 1500 * Math.pow(1.8, attempt - 1);
            const jitter = Math.random() * 800;
            const backoffMs = Math.min(baseDelay + jitter, 10000);
            console.warn(`[Gemini Retry] ${modelName} 503/high demand (Attempt ${attempt}/5). Waiting${(backoffMs/1000).toFixed(1)}s...`);
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          }
          break;
        }

        throw error;
      }
    }
  }

  throw new Error('All Gemini models are currently busy.');
}

async function callGroqVisionFallback(imageBuffer) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set.');
  }
  if (!imageBuffer) {
    throw new Error('An image buffer is required for Groq Vision fallback.');
  }

  const imageBase64 = Buffer.isBuffer(imageBuffer)
    ? imageBuffer.toString('base64')
    : Buffer.from(imageBuffer).toString('base64');
  const requestBody = JSON.stringify({
    model: 'qwen/qwen3.8-27b',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract student name from header if present, and all multiple-choice answers written on this paper. Return STRICT valid JSON: {"studentName": "...", "answers": {"1": "A", "2": "B", "3": "C"}}',
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
        ],
      },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });
  const MAX_GROQ_ATTEMPTS = 3;
  let response;
  let lastError;

  for (let attempt = 1; attempt <= MAX_GROQ_ATTEMPTS; attempt++) {
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      });
    } catch (error) {
      lastError = error;
      if (attempt === MAX_GROQ_ATTEMPTS) break;

      const backoffMs = Math.min(1000 * Math.pow(1.5, attempt - 1), 5000);
      console.warn(`[Groq Retry] Groq API error or rate limit (Attempt ${attempt}/3). Retrying in ${(backoffMs/1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, backoffMs));
      continue;
    }

    if (response.status === 429 || response.status === 503) {
      const errorText = await response.text();
      lastError = new Error(`Groq Vision request failed (${response.status}): ${errorText}`);
      if (attempt === MAX_GROQ_ATTEMPTS) break;

      const backoffMs = Math.min(1000 * Math.pow(1.5, attempt - 1), 5000);
      console.warn(`[Groq Retry] Groq API error or rate limit (Attempt ${attempt}/3). Retrying in ${(backoffMs/1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, backoffMs));
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq Vision request failed (${response.status}): ${errorText}`);
    }
    lastError = null;
    break;
  }

  if (!response || lastError) {
    throw lastError || new Error('Groq Vision request failed after 3 attempts.');
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Groq Vision returned no JSON content.');
  }
  return JSON.parse(content);
}

function sanitizeRawOcrTokens(rawTokens, studentAccountName) {
  const headerBlocklist = new Set([
    'name', 'date', 'score', 'subject', 'class', 'quiz',
    'test', 'exam', 'section', 'teacher', 'student',
  ]);
  const accountNameParts = new Set(
    String(studentAccountName || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
  );
  const tokens = Array.isArray(rawTokens)
    ? rawTokens
    : String(rawTokens || '').split(/\r?\n/);

  return tokens
    .map(token => String(token || '').replace(/[^A-Za-z0-9]/g, '').trim())
    .filter(Boolean)
    .filter(token => {
      const normalizedToken = token.toLowerCase();
      if (headerBlocklist.has(normalizedToken)) return false;
      if (accountNameParts.has(normalizedToken)) return false;
      if (token.length > 2 && !/^(true|false)$/i.test(token)) return false;
      return /^[A-E1-4]$/i.test(token) || /^(true|false|t|f)$/i.test(token);
    })
    .map(token => token.toUpperCase());
}

/**
 * Determines whether a student answer looks garbled / unreadable
 * relative to the expected answer format from the answer key.
 *
 * @param {string} studentAns   Raw answer extracted by OCR
 * @param {string|number} expectedAns  Correct answer from the answer key
 * @returns {boolean} true if the answer appears garbled and needs Gemini re-parse
 */
function isGarbledAnswer(studentAns, expectedAns) {
  if (!studentAns || studentAns.trim() === '' || studentAns === '?') return true;

  const student  = studentAns.trim().toUpperCase();
  const expected = String(expectedAns).trim().toUpperCase();

  // Case A: Multiple Choice — expected is a single letter A-E or digit 1-5
  if (/^[A-E1-5]$/.test(expected)) {
    // Any student answer that isn't also a single A-E/1-5 token is garbage
    return !/^[A-E1-5]$/.test(student);
  }

  // Case B: True / False
  if (['TRUE', 'FALSE', 'T', 'F'].includes(expected)) {
    return !['TRUE', 'FALSE', 'T', 'F'].includes(student);
  }

  // Case C: Identification — accept any non-empty alphanumeric string
  // (fuzzy matching later handles partial correctness)
  return false;
}

/**
 * Detects invalid / garbled multiple-choice answers.
 *
 * For questions whose correct answer is a single letter (A-E) or digit (1-5),
 * any student answer longer than one character is treated as garbled OCR text
 * (e.g. "VE", "AY", "FAIATL").
 *
 * @param {string}        studentAns  Raw answer token extracted by OCR
 * @param {string|number} correctAns  Correct answer from the answer key
 * @returns {boolean} true if the answer looks garbled and should trigger re-parse
 */
function sanitizeAnswerText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/^(?:Answer|Ans)\s*:\s*/i, '')
    .replace(/^Option\s+/i, '')
    .trim();
}

function isInvalidChoice(studentAns, correctAns) {
  if (!studentAns || studentAns === '?') return true;

  // Strip optional "Answer: " / "Ans: " / "Option " prefix that some answer-key formats include
  const isSingleLetterKey = /^[A-E1-5]$/i.test(
    sanitizeAnswerText(correctAns)
  );

  // If the expected answer is a single-letter MC key, any token longer than
  // one character is garbled OCR output.
  if (isSingleLetterKey && studentAns.trim().length > 1) {
    return true; // Mark as garbled
  }

  return false;
}

/**
 * Runs OCR with a specific page segmentation mode
 */
async function runOCR(imageBuffer, psm) {
  if (isVercelRuntime()) {
    console.warn('[OCR] Vercel detected: skipping local Tesseract entirely to avoid WASM ENOENT/Aborted crashes.');
    return '';
  }

  try {
    const result = await Tesseract.recognize(imageBuffer, 'eng', {
      tessedit_pageseg_mode: psm,
    });
    return result.data.text || '';
  } catch (error) {
    const message = (error && (error.message || String(error))) || '';
    if (/ENOENT|Aborted|tesseract\.wasm|Failed to fetch|fetch failed|wasm/i.test(message)) {
      console.warn('[OCR] Tesseract WASM initialization failed safely; skipping local OCR and letting Gemini Vision handle the image.', message);
      return '';
    }
    throw error;
  }
}

/**
 * Extracts full text from image using the dual-OCR strategy
 * Uses OCR.space for handwritten text (student papers) and Tesseract for printed text
 */
async function extractTextFromImage(imagePath, imageBuffer = null) {
  try {
    const ocrRouter = new OCRRouter();

    // Use smart routing to automatically choose the best OCR engine
    // For student papers (handwritten), it will use OCR.space Engine 3
    // For printed text, it will use Tesseract with LSTM
    const text = await ocrRouter.processStudentPaper(imagePath, imageBuffer);

    return text;
  } catch (error) {
    const isBypass = error && (error.code === 'VERCEL_TESSERACT_BYPASS' || /Vercel bypass|bypass.*Tesseract/i.test(error.message || ''));

    if (isBypass || isVercelRuntime()) {
      console.warn('[OCR] Vercel bypass active: skipping local Tesseract. Returning empty OCR text so Gemini Vision fallback can parse the uploaded image buffer.');
      return '';
    }

    console.error('OCR Error:', error);
    // Fallback to legacy Tesseract approach if dual-OCR fails
    console.log('Falling back to legacy Tesseract approach...');
    return await extractTextFromImageLegacy(imagePath, imageBuffer);
  }
}

/**
 * Legacy fallback OCR using Tesseract with multiple strategies
 */
async function extractTextFromImageLegacy(imagePath, imageBuffer = null) {
  try {
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const fs = require('fs');

    const img = imageBuffer ? await loadImage(imageBuffer) : await loadImage(imagePath);
    // Upscale 2x for better OCR accuracy
    const scale = img.width < 1000 ? 3 : 2;
    const canvas = createCanvas(img.width * scale, img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Strategy 1: Raw upscaled (no preprocessing)
    const rawBuffer = canvas.toBuffer('image/png');

    // Strategy 2: Grayscale + gentle threshold (dark ink on light bg)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // Keep dark ink (< 140) as black, everything else white
      const val = lum < 140 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = val;
    }
    ctx.putImageData(imgData, 0, 0);
    const bwBuffer = canvas.toBuffer('image/png');

    // Try 4 different OCR modes across both images
    const attempts = await Promise.all([
      runOCR(rawBuffer, '6'),
      runOCR(rawBuffer, '4'),
      runOCR(bwBuffer, '6'),
      runOCR(bwBuffer, '11'),
    ]);

    // Score each attempt by how many answer-like patterns it contains
    const scoreText = (text) => {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let score = 0;
      for (const line of lines) {
        // Matches "1. C", "1) C", "1 C" (Multiple Choice)
        if (/^(\d+[\.\):]?\s*)?[A-Da-d]\.?$/.test(line)) score += 5;
        // Matches "1. Word" or "1) Word" (Identification)
        if (/^\d+[\.\)]\s*[A-Za-z]{2,}/.test(line)) score += 4;
        // Matches "Word" on its own line (Identification)
        if (/^[A-Za-z]{3,}$/.test(line)) score += 2;
        // Matches just a letter
        if (/^[A-Da-d]$/i.test(line)) score += 1;
      }
      return score;
    };

    let bestText = '';
    let bestScore = -1;
    attempts.forEach((text, i) => {
      const s = scoreText(text);
      console.log(`OCR Strategy ${i} score=${s}:`, text.substring(0, 100).replace(/\n/g, '|'));
      if (s > bestScore) { bestScore = s; bestText = text; }
    });

    console.log('--- BEST OCR RESULT (LEGACY) ---');
    console.log(bestText);
    return bestText;
  } catch (error) {
    console.error('Legacy OCR Error:', error);
    return '';
  }
}

/**
 * Parses student answers from OCR text produced by the HF YOLOv8+TrOCR hybrid
 * service (or any legacy OCR fallback).
 *
 * The Hugging Face model returns one answer token per detected bounding box,
 * separated by newlines.  Two formats are supported:
 *
 *   Sequential (bare) — one token per line, mapped to Q1, Q2 … in order:
 *     B
 *     C
 *     C
 *     B
 *
 *   Numbered — explicit question number on each line (either format):
 *     1. B
 *     2. C
 *     1) Mercury
 *
 * The function also handles legacy formats (markdown tables, answer-then-number)
 * so older submissions keep working.
 *
 * @param {string} ocrText   Raw text returned by the OCR/HF service
 * @param {number} [totalQuestions=0]  When provided, gaps are pre-filled with '?'
 * @returns {{ [questionNumber: number]: string }}
 */
/**
 * parseStudentAnswers — dual-parser system
 *
 * STAGE 1: Pure JS (fast & free)
 *   a) Try explicit numbered regex matching (e.g. "1. A", "Q2: B", "1) C").
 *   b) If no numbered answers found, fall back to sequential mapping:
 *      clean each non-empty line with /[^A-Za-z0-9]/g and map to Q1, Q2…
 *
 * STAGE 2: Gemini, then Groq Vision fallback (optional / conditional)
 *   Triggered for garbled answers when ENABLE_GEMINI_FALLBACK=true and at
 *   least one provider key is configured.
 */
/**
 * @param {string}      ocrText            Raw OCR text
 * @param {number}      [totalQuestions=0]  Number of questions (fills gaps with '?')
 * @param {Object}      [correctAnswers={}] Map of { [qNum]: expectedAnswer } used for
 *                                          answer-key-aware garble detection
 * @param {Buffer|null} [imageBuffer=null]  Raw image buffer for vision fallbacks
 */
async function parseStudentAnswers(ocrText, totalQuestions = 0, correctAnswers = {}, imageBuffer = null, accountName = '') {
  // Expose imageBuffer under _imageBuffer so the STAGE 2 closure can access it
  const _imageBuffer = imageBuffer;
  const answers = {};
  let extractedStudentName = '';

  // ── STAGE 1a: Explicit numbered regex matching ────────────────────────
  const lines = ocrText.split(/\r?\n/);
  let numberedFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Markdown table: "| 1. | C |" or "| 1 | B |"
    const tableMatch = trimmed.match(/^\|\s*(\d+)[\.\)]?\s*\|\s*([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*)\s*\|/);
    if (tableMatch) {
      answers[parseInt(tableMatch[1], 10)] = tableMatch[2].trim().toUpperCase();
      numberedFound = true;
      continue;
    }

    // Table without outer pipes: "1. | C"
    const tableMatch2 = trimmed.match(/^(\d+)[\.\)]?\s*\|\s*([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*)\s*$/);
    if (tableMatch2) {
      answers[parseInt(tableMatch2[1], 10)] = tableMatch2[2].trim().toUpperCase();
      numberedFound = true;
      continue;
    }

    // Number-first: "1. B", "1) C", "Q2: B", "2. Mercury", "3 D"
    const numbered = trimmed.match(/^(?:Q|q)?(\d+)[\.\):\s]\s*([A-Za-z][A-Za-z\s]*)$/);
    if (numbered) {
      answers[parseInt(numbered[1], 10)] = numbered[2].trim().toUpperCase();
      numberedFound = true;
      continue;
    }

    // Answer-first: "C. 1" or "( Mercury ) 1."
    const answerFirst = trimmed.match(/^(?:\(?\s*)?([A-Za-z][A-Za-z\s]*)(?:\s*\))?\s+(\d+)[\.\)]/);
    if (answerFirst) {
      answers[parseInt(answerFirst[2], 10)] = answerFirst[1].trim().toUpperCase();
      numberedFound = true;
      continue;
    }
  }

  // ── STAGE 1b: Pure JS sequential fallback ────────────────────────────
  if (!numberedFound) {
    const cleanLines = sanitizeRawOcrTokens(lines, accountName);

    if (cleanLines.length > 0) {
      console.log(
        `[Parser] No numbered answers found. Mapping ${cleanLines.length} ` +
        'sequential token(s) to Q1, Q2 …'
      );
      const limit = totalQuestions > 0 ? Math.min(cleanLines.length, totalQuestions) : cleanLines.length;
      for (let i = 0; i < limit; i++) {
        answers[i + 1] = cleanLines[i].toUpperCase();
      }
    }
  }
  const applySanitizedOcrFallback = () => {
    if (numberedFound) return;

    const cleanTokens = sanitizeRawOcrTokens(lines, accountName);
    Object.keys(answers).forEach(qNum => delete answers[qNum]);
    const limit = totalQuestions > 0 ? Math.min(cleanTokens.length, totalQuestions) : cleanTokens.length;
    for (let i = 0; i < limit; i++) {
      answers[i + 1] = cleanTokens[i];
    }
    if (totalQuestions > 0) {
      for (let q = 1; q <= totalQuestions; q++) {
        if (!answers[q]) answers[q] = '?';
      }
    }
  };

  // ── Fill missing question slots with '?' ─────────────────────────────
  if (totalQuestions > 0) {
    for (let q = 1; q <= totalQuestions; q++) {
      if (!answers[q]) answers[q] = '?';
    }
  }

  // ── STAGE 2: Answer-Key-Aware Gemini fallback (conditional) ──────────
  //
  // Two checks are combined:
  //   • isGarbledAnswer — broad format check (also catches TF, Identification)
  //   • isInvalidChoice — targeted check for multi-char tokens on MC questions
  //     (e.g. "VE", "AY", "FAIATL") that would otherwise slip through
  //
  // When ENABLE_GEMINI_FALLBACK=true, any question that fails either check
  // triggers Gemini Flash Vision to re-parse the original image.
  if (
    process.env.ENABLE_GEMINI_FALLBACK === 'true' &&
    (process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY)
  ) {
    const questionNums = totalQuestions > 0
      ? Array.from({ length: totalQuestions }, (_, i) => i + 1)
      : Object.keys(answers).map(Number);

    // Separate garbled-choice answers from other garbled answers so we can
    // emit the right log message and choose the correct Gemini call path.
    const invalidChoiceQNums = [];
    const otherGarbledQNums  = [];

    for (const qNum of questionNums) {
      const studentAns  = answers[qNum] || '?';
      const expectedAns = correctAnswers[qNum]; // may be undefined for Identification

      if (isInvalidChoice(studentAns, expectedAns ?? studentAns)) {
        invalidChoiceQNums.push(qNum);
      } else if (isGarbledAnswer(studentAns, expectedAns ?? studentAns)) {
        otherGarbledQNums.push(qNum);
      }
    }

    const garbledQNums = [...new Set([...invalidChoiceQNums, ...otherGarbledQNums])];

    if (garbledQNums.length > 0) {
      // Emit the correct log message based on which detector(s) fired
      if (invalidChoiceQNums.length > 0) {
        const sampleGarbled = invalidChoiceQNums.map(q => `${q}:'${answers[q]}'`).join(', ');
        console.log(
          `[Parser] Detected garbled OCR tokens (${sampleGarbled}). Triggering Gemini Vision fallback...`
        );
      } else {
        console.log(
          `[Parser] Garbled answers detected for Q${otherGarbledQNums.join(', Q')}. ` +
          'Attempting Gemini Flash fallback...'
        );
      }

      const applyAiResponse = (aiResponse) => {
        extractedStudentName = typeof aiResponse.studentName === 'string'
          ? aiResponse.studentName.trim()
          : extractedStudentName;
        const aiAnswers = aiResponse.answers && typeof aiResponse.answers === 'object'
          ? aiResponse.answers
          : aiResponse;

        for (const [qStr, ans] of Object.entries(aiAnswers)) {
          const qNum = parseInt(qStr, 10);
          if (!isNaN(qNum) && qNum >= 1) {
            answers[qNum] = String(ans).trim().toUpperCase();
          }
        }
      };

      let geminiFailed = !process.env.GEMINI_API_KEY;
      if (process.env.GEMINI_API_KEY) {
        try {
          // Build a structured description of each question's expected format
          // so Gemini knows exactly what kind of answer to look for.
          const questionHints = questionNums.map(qNum => {
            const expected = correctAnswers[qNum];
            let type = 'Identification';
            if (expected !== undefined) {
              const exp = String(expected).trim().toUpperCase();
              if (/^[A-E1-5]$/.test(exp))                     type = 'Multiple Choice (single letter A-E)';
              else if (['TRUE','FALSE','T','F'].includes(exp)) type = 'True/False';
            }
            return `  Q${qNum}: ${type}`;
          }).join('\n');

          const basePrompt =
            'You are an answer sheet parser. ' +
            'Extract each student answer for the questions listed below. ' +
            'Use the question type hints to decide what a valid answer looks like. ' +
            'Return ONLY JSON: {"studentName":"Extracted student name from header or empty string","answers":{"1":"A","2":"B"}} ' +
            'with no markdown or explanation.\n\n' +
            'QUESTION TYPE HINTS:\n' + questionHints;

          let result;
          if (invalidChoiceQNums.length > 0 && _imageBuffer) {
            const visionPrompt =
              basePrompt + '\n\nThe student answer sheet image is attached. ' +
              'Read the student name written on the header and the handwritten or bubble answers directly from the image.';
            console.log('[Parser] Executing Gemini vision fallback with image buffer...');
            result = await callGeminiWithFailover(visionPrompt, _imageBuffer);
          } else {
            const textPrompt = basePrompt + '\n\nOCR TEXT:\n' + ocrText;
            console.log('[Parser] Executing Gemini text fallback with OCR text...');
            result = await callGeminiWithFailover(textPrompt);
          }

          const rawText = result.response.text().trim();
          const jsonStr = rawText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
          applyAiResponse(JSON.parse(jsonStr));
          geminiFailed = false;
          console.log('[Parser] Gemini fallback answers applied:', answers);
        } catch (geminiErr) {
          geminiFailed = true;
          console.warn('[Parser] Gemini fallback failed:', geminiErr.message);
        }
      }

      if (geminiFailed && process.env.GROQ_API_KEY && _imageBuffer) {
        try {
          console.log('[Parser] Executing Groq Vision fallback with image buffer...');
          applyAiResponse(await callGroqVisionFallback(_imageBuffer));
          console.log('[Parser] Groq Vision fallback answers applied:', answers);
        } catch (groqErr) {
          console.warn('[Parser] Groq Vision fallback failed:', groqErr.message);
          applySanitizedOcrFallback();
          console.warn('[Parser] Using sanitized raw OCR tokens as the final fallback.');
        }
      } else if (geminiFailed) {
        applySanitizedOcrFallback();
        console.warn('[Parser] Groq Vision fallback unavailable; using sanitized raw OCR tokens.');
      }
    } else {
      console.log('[Parser] All answers passed garble check — Gemini fallback not needed.');
    }
  }

  console.log('[Parser] Final parsed student answers:', answers);
  return { answers, extractedStudentName };
}

/**
 * Main Grading Logic
 */
async function gradeSubmission(examId, studentId, imagePath, imageBuffer = null, imageUrl = null, requestBody = {}) {
  try {
    // 1. Get Answer Keys (manual first, then AI generated)
    let keysRes = await db.query('SELECT * FROM Answer_Keys WHERE exam_id = $1 ORDER BY id ASC', [examId]);
    let answerKeys = keysRes.rows;

    if (answerKeys.length === 0) {
      const genRes = await db.query('SELECT id, correct_answer as answer_text FROM Generated_Questions WHERE exam_id = $1 ORDER BY id ASC', [examId]);
      answerKeys = genRes.rows;
    }

    if (answerKeys.length === 0) {
      return {
        totalScore: 0, maxScore: 0, results: [],
        error: 'No Answer Key found. Please define an Answer Key or generate questions first.'
      };
    }

    // 2. OCR - extract text from paper
    const ocrText = await extractTextFromImage(imagePath, imageBuffer);

    // 3. Parse student answers from OCR text.
    //    Pass the answer-key count so the parser pre-fills missing slots with '?'
    //    instead of leaving them undefined — ensures every question is graded.
    // Build correctAnswers map so parseStudentAnswers can do format-aware
    // garble detection (MC expects "A", TF expects "TRUE"/"FALSE", etc.)
    const correctAnswers = {};
    answerKeys.forEach((key, idx) => {
      correctAnswers[idx + 1] = key.answer_text?.toString().trim();
    });

    const parsedAnswers = await parseStudentAnswers(
      ocrText,
      answerKeys.length,
      correctAnswers,
      imageBuffer,
      requestBody.studentName
    );
    const studentAnswers = parsedAnswers.answers;
    const extractedStudentName = parsedAnswers.extractedStudentName;

    const userRole = (requestBody.role || requestBody.userRole || '').toLowerCase();
    const isTeacher = userRole === 'teacher' || userRole === 'instructor' || userRole === 'admin';
    const isVerifiedOwner = Boolean(extractedStudentName) &&
      verifyNameMatch(requestBody.studentName, extractedStudentName);

    // Only check student account scans; teachers are trusted and bypassed
    if (!isTeacher && extractedStudentName && !isVerifiedOwner) {
      const error = new Error(`Paper ownership mismatch: This paper appears to belong to "${extractedStudentName}", but you are logged in as "${requestBody.studentName}".`);
      error.status = 400;
      error.code = 'NAME_MISMATCH';
      throw error;
    }

    let correctCount = 0;
    const feedbackLines = [];

    // 4. Compare each answer with enhanced fuzzy matching
    for (let i = 0; i < answerKeys.length; i++) {
      const qNum = i + 1;
      const rawCorrectAnswer = answerKeys[i].answer_text?.toString().trim();
      const correctAnswer = sanitizeAnswerText(rawCorrectAnswer);
      const studentAnswer = sanitizeAnswerText(studentAnswers[qNum] || '');

      // Use enhanced fuzzy matching with dynamic thresholds
      const isCorrect = studentAnswer && ScannerLogic.isMatch(studentAnswer, correctAnswer);

      if (isCorrect) correctCount++;

      // Calculate similarity score for feedback
      const similarity = ScannerLogic.jaroWinklerSimilarity(
        studentAnswer.toLowerCase(),
        correctAnswer.toLowerCase()
      );

      feedbackLines.push(
        `Q${qNum}: Student answered "${studentAnswer || '?'}" | Correct: "${correctAnswer}" | Similarity: ${(similarity * 100).toFixed(1)}% | ${isCorrect ? '✅ Correct' : '❌ Wrong'}`
      );
    }

    const totalScore = correctCount;
    const maxScore = answerKeys.length;
    const feedback = feedbackLines.join('\n');
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

    console.log(`Grading: ${totalScore}/${maxScore} (${percentage.toFixed(1)}%)`);
    console.log('Feedback:\n', feedback);

    // 5. Save or update result (overwrite if student already has a submission)
    await db.query(
      `INSERT INTO Student_Submissions (student_id, exam_id, extracted_text, score, feedback, image_url, points_earned, total_items, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (student_id, exam_id)
       DO UPDATE SET 
         extracted_text = EXCLUDED.extracted_text, 
         score = EXCLUDED.score, 
         feedback = EXCLUDED.feedback, 
         image_url = EXCLUDED.image_url, 
         points_earned = EXCLUDED.points_earned,
         total_items = EXCLUDED.total_items,
        is_verified = EXCLUDED.is_verified,
         created_at = NOW()`,
      [studentId, examId, ocrText, percentage, feedback, imageUrl, totalScore, maxScore, isTeacher || isVerifiedOwner]
    );

    const sub = await db.query(
      'SELECT id, is_verified FROM Student_Submissions WHERE student_id = $1 AND exam_id = $2',
      [studentId, examId]
    );

    return {
      submission_id: sub.rows[0]?.id,
      is_verified: sub.rows[0]?.is_verified,
      totalScore, maxScore, feedback,
      results: feedbackLines
    };

  } catch (error) {
    console.error('Grading Error:', error);
    throw error;
  }
}

function verifyNameMatch(accountName, paperName) {
  if (!accountName || !paperName) return true; // Default to true if paper header is unreadable
  const clean = (str) => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const accTokens = clean(accountName).split(/\s+/).filter(t => t.length > 1);
  const paperTokens = clean(paperName).split(/\s+/).filter(t => t.length > 1);
  if (accTokens.length === 0 || paperTokens.length === 0) return true;
  const matches = paperTokens.filter(token => accTokens.includes(token));
  const ratio = matches.length / Math.max(accTokens.length, paperTokens.length);
  return ratio >= 0.4; // True if key name tokens match
}

module.exports = { gradeSubmission, sanitizeRawOcrTokens };
