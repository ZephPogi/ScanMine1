const Tesseract = require('tesseract.js');
const db = require('../db');
const ScannerLogic = require('./scannerLogic');
const OCRRouter = require('./ocrRouter');

// Lazy-loaded only when Gemini fallback is triggered
let _GoogleGenerativeAI = null;
function getGoogleGenerativeAI() {
  if (!_GoogleGenerativeAI) {
    _GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
  }
  return _GoogleGenerativeAI;
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
  const result = await Tesseract.recognize(imageBuffer, 'eng', {
    tessedit_pageseg_mode: psm,
  });
  return result.data.text || '';
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
 * STAGE 2: Gemini 3.6 Flash fallback (optional / conditional)
 *   Triggered only when ALL slots are '?' AND ENABLE_GEMINI_FALLBACK=true
 *   AND GEMINI_API_KEY is set.
 */
/**
 * @param {string}      ocrText            Raw OCR text
 * @param {number}      [totalQuestions=0]  Number of questions (fills gaps with '?')
 * @param {Object}      [correctAnswers={}] Map of { [qNum]: expectedAnswer } used for
 *                                          answer-key-aware garble detection
 * @param {Buffer|null} [imageBuffer=null]  Raw image buffer — passed to Gemini Vision
 *                                          when garbled MC tokens are detected
 */
async function parseStudentAnswers(ocrText, totalQuestions = 0, correctAnswers = {}, imageBuffer = null) {
  // Expose imageBuffer under _imageBuffer so the STAGE 2 closure can access it
  const _imageBuffer = imageBuffer;
  const answers = {};

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
    const cleanLines = lines
      .map(l => l.replace(/[^A-Za-z0-9]/g, '').trim())
      .filter(Boolean);

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
    process.env.GEMINI_API_KEY
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
          'Attempting Gemini 2.0 Flash fallback...'
        );
      }

      try {
        const GoogleGenerativeAI = getGoogleGenerativeAI();
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
          'Return ONLY a raw JSON object like {"1": "A", "2": "TRUE", "3": "Mercury"} ' +
          'with no markdown, no explanation, and no extra keys.\n\n' +
          'QUESTION TYPE HINTS:\n' + questionHints;

        let result;

        const retryGeminiCall = async (operation) => {
          let lastError;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              return await operation(attempt);
            } catch (error) {
              lastError = error;
              const status = Number(error?.status || error?.response?.status || error?.code || 0);
              const message = (error?.message || '').toLowerCase();
              const isRetryable = status === 503 || /503|service unavailable|high demand|overloaded|too many requests|rate limit|temporary|network|fetch failed/.test(message);

              if (attempt >= 3 || !isRetryable) {
                throw error;
              }

              console.warn(`[Parser] Gemini fallback temporarily unavailable (attempt ${attempt}/3). Retrying in 2s...`, error?.message || error);
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          throw lastError;
        };

        // ── Vision path: triggered when garbled-choice tokens are detected ──
        // Pass the original image so Gemini can read the bubble/handwriting
        // directly instead of relying on already-corrupted OCR text.
        if (invalidChoiceQNums.length > 0 && _imageBuffer) {
          console.log('[Parser] Executing gemini-3.8-flash Vision fallback with image buffer...');
          const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });
          const imagePart = {
            inlineData: {
              data: Buffer.isBuffer(_imageBuffer)
                ? _imageBuffer.toString('base64')
                : Buffer.from(_imageBuffer).toString('base64'),
              mimeType: 'image/jpeg',
            },
          };
          const visionPrompt =
            basePrompt + '\n\nThe student answer sheet image is attached. ' +
            'Read the handwritten or bubble answers directly from the image.';
          result = await retryGeminiCall(async () => model.generateContent([visionPrompt, imagePart]));
        } else {
          // ── Text path: fall back to OCR text when no image is available ──
          console.log('[Parser] Executing gemini-3.8-flash Text fallback with OCR text...');
          const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });
          const textPrompt = basePrompt + '\n\nOCR TEXT:\n' + ocrText;
          result = await retryGeminiCall(async () => model.generateContent(textPrompt));
        }

        const rawText = result.response.text().trim();

        // Strip markdown fences if Gemini wraps in ```json ... ```
        const jsonStr = rawText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
        const geminiAnswers = JSON.parse(jsonStr);

        for (const [qStr, ans] of Object.entries(geminiAnswers)) {
          const qNum = parseInt(qStr, 10);
          if (!isNaN(qNum) && qNum >= 1) {
            answers[qNum] = String(ans).trim().toUpperCase();
          }
        }
        console.log('[Parser] Gemini fallback answers applied:', answers);
      } catch (geminiErr) {
        console.warn('[Parser] Gemini fallback failed:', geminiErr.message);
      }
    } else {
      console.log('[Parser] All answers passed garble check — Gemini fallback not needed.');
    }
  }

  console.log('[Parser] Final parsed student answers:', answers);
  return answers;
}

/**
 * Main Grading Logic
 */
async function gradeSubmission(examId, studentId, imagePath, imageBuffer = null, imageUrl = null) {
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

    const studentAnswers = await parseStudentAnswers(ocrText, answerKeys.length, correctAnswers, imageBuffer);

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
      `INSERT INTO Student_Submissions (student_id, exam_id, extracted_text, score, feedback, image_url, points_earned, total_items)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (student_id, exam_id)
       DO UPDATE SET 
         extracted_text = EXCLUDED.extracted_text, 
         score = EXCLUDED.score, 
         feedback = EXCLUDED.feedback, 
         image_url = EXCLUDED.image_url, 
         points_earned = EXCLUDED.points_earned,
         total_items = EXCLUDED.total_items,
         created_at = NOW()`,
      [studentId, examId, ocrText, percentage, feedback, imageUrl, totalScore, maxScore]
    );

    const sub = await db.query(
      'SELECT id FROM Student_Submissions WHERE student_id = $1 AND exam_id = $2',
      [studentId, examId]
    );

    return {
      submission_id: sub.rows[0]?.id,
      totalScore, maxScore, feedback,
      results: feedbackLines
    };

  } catch (error) {
    console.error('Grading Error:', error);
    throw error;
  }
}

module.exports = { gradeSubmission };
