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
    const { createCanvas, loadImage } = require('canvas');
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
 * Extracts answers from OCR text using line-by-line approach.
 * Handles formats: "1. C", "1) C", "1 C", "1.C", "(C) 1", etc.
 * Also handles markdown table format from OCR.space
 */
function parseStudentAnswers(ocrText) {
  const answers = {};
  const lines = ocrText.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Handle markdown table format: "| 1. | C |"
    const tableMatch = trimmed.match(/^\|\s*(\d+)[\.\)]?\s*\|\s*([A-Za-z0-9]+)\s*\|$/);
    if (tableMatch) {
      answers[parseInt(tableMatch[1])] = tableMatch[2].trim();
      continue;
    }
    
    // Handle table format without pipe: "1. | C"
    const tableMatch2 = trimmed.match(/^(\d+)[\.\)]?\s*\|\s*([A-Za-z0-9]+)\s*$/);
    if (tableMatch2) {
      answers[parseInt(tableMatch2[1])] = tableMatch2[2].trim();
      continue;
    }
    
    // Format: "1. C", "1) C", "1. Mercury", "1 Mercury" (number then answer)
    const m1 = trimmed.match(/^(\d+)[\.\):\s]+\s*([A-Za-z\s]+)$/);
    if (m1) {
      answers[parseInt(m1[1])] = m1[2].trim();
      continue;
    }
    
    // Format: "C. 1" or "C) 1" or "( Mercury ) 1." (answer then number)
    const m2 = trimmed.match(/^(?:\(\s*)?([A-Za-z\s]+)(?:\s*\))?\s*(\d+)[\.\)]/);
    if (m2) {
      answers[parseInt(m2[2])] = m2[1].trim();
      continue;
    }

    // Just a letter on a line by itself (sequential)
    const m3 = trimmed.match(/^([A-Da-d])\.?$/);
    if (m3) {
      // We can't reliably map this to a question number without context
      // So we collect them in order later
    }
  }
  
  // Fallback: if we found nothing numbered, extract all single letters in order
  if (Object.keys(answers).length === 0) {
    console.log('No numbered answers found, extracting letters in order...');
    let qNum = 1;
    for (const line of lines) {
      const m = line.trim().match(/^([A-Da-d])\.?$/i);
      if (m) {
        answers[qNum] = m[1].toUpperCase();
        qNum++;
      }
    }
  }
  
  console.log('Parsed student answers:', answers);
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

    // 3. Parse student answers from OCR text
    const studentAnswers = parseStudentAnswers(ocrText);

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
