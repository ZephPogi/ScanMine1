const Tesseract = require('tesseract.js');
const db = require('../db');
const ScannerLogic = require('./scannerLogic');
const OCRRouter = require('./ocrRouter');

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
function parseStudentAnswers(ocrText, totalQuestions = 0) {
  const answers = {};
  const sequentialTokens = []; // Collect bare tokens for sequential fallback

  const lines = ocrText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // ── Priority 1: Numbered formats ──────────────────────────────────────

    // Markdown table: "| 1. | C |" or "| 1 | B |"
    const tableMatch = trimmed.match(/^\|\s*(\d+)[\.\)]?\s*\|\s*([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*)\s*\|/);
    if (tableMatch) {
      answers[parseInt(tableMatch[1], 10)] = tableMatch[2].trim().toUpperCase();
      continue;
    }

    // Table without outer pipes: "1. | C"
    const tableMatch2 = trimmed.match(/^(\d+)[\.\)]?\s*\|\s*([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*)\s*$/);
    if (tableMatch2) {
      answers[parseInt(tableMatch2[1], 10)] = tableMatch2[2].trim().toUpperCase();
      continue;
    }

    // Number-first: "1. B", "1) C", "2. Mercury", "3 D"
    const numbered = trimmed.match(/^(\d+)[\.\):\s]\s*([A-Za-z][A-Za-z\s]*)$/);
    if (numbered) {
      answers[parseInt(numbered[1], 10)] = numbered[2].trim().toUpperCase();
      continue;
    }

    // Answer-first: "C. 1" or "( Mercury ) 1."
    const answerFirst = trimmed.match(/^(?:\(?\s*)?([A-Za-z][A-Za-z\s]*)(?:\s*\))?\s+(\d+)[\.\)]/);
    if (answerFirst) {
      answers[parseInt(answerFirst[2], 10)] = answerFirst[1].trim().toUpperCase();
      continue;
    }

    // ── Priority 2: Sequential (bare) tokens ─────────────────────────────
    // These are the primary output of the YOLOv8+TrOCR pipeline:
    //   a single letter (A-D) or a short identification word on its own line.
    // We collect them here and map them to Q1, Q2 … after the loop.
    const isMultipleChoice = /^[A-Da-d]\.?$/.test(trimmed);
    const isIdentification = /^[A-Za-z]{2,30}$/.test(trimmed);

    if (isMultipleChoice || isIdentification) {
      sequentialTokens.push(trimmed.replace(/\.$/, '').toUpperCase());
    }
  }

  // ── Merge sequential tokens if no numbered answers were parsed ─────────
  if (Object.keys(answers).length === 0 && sequentialTokens.length > 0) {
    console.log(
      `[Parser] No numbered answers found. Mapping ${sequentialTokens.length} ` +
      'sequential token(s) from HF output to Q1, Q2 …'
    );
    sequentialTokens.forEach((token, idx) => {
      answers[idx + 1] = token;
    });
  }

  // ── Fill missing question slots with '?' ──────────────────────────────
  if (totalQuestions > 0) {
    for (let q = 1; q <= totalQuestions; q++) {
      if (!answers[q]) answers[q] = '?';
    }
  }

  console.log('[Parser] Parsed student answers:', answers);
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
    const studentAnswers = parseStudentAnswers(ocrText, answerKeys.length);

    let correctCount = 0;
    const feedbackLines = [];

    // 4. Compare each answer with enhanced fuzzy matching
    for (let i = 0; i < answerKeys.length; i++) {
      const qNum = i + 1;
      const correctAnswer = answerKeys[i].answer_text?.toString().trim();
      const studentAnswer = (studentAnswers[qNum] || '').trim();

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
