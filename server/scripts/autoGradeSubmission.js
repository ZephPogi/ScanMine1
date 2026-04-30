const Tesseract = require('tesseract.js');
const db = require('../db');

/**
 * Extracts text from an image using Tesseract OCR
 */
async function extractTextFromImage(imagePath) {
  try {
    const result = await Tesseract.recognize(imagePath, 'eng', {
      logger: m => console.log(m)
    });
    return result.data.text;
  } catch (error) {
    console.error('Error in OCR:', error);
    throw error;
  }
}

/**
 * Compares student answer text against the correct answer keys
 */
async function gradeSubmission(examId, studentId, studentText) {
  try {
    // Get Answer Keys for the exam
    const keysRes = await db.query('SELECT * FROM Answer_Keys WHERE exam_id = $1', [examId]);
    const answerKeys = keysRes.rows;

    if (answerKeys.length === 0) {
        throw new Error('No answer keys found for this exam');
    }

    let correctCount = 0;
    const feedbackLines = [];

    // Simple comparison logic (can be made fuzzy or ML-based later)
    for (let key of answerKeys) {
        // Checking if the expected answer exists in the student's text
        if (studentText.toLowerCase().includes(key.answer_text.toLowerCase())) {
            correctCount++;
            feedbackLines.push(`Found match for answer: ${key.answer_text}`);
        } else {
            feedbackLines.push(`Missing answer: ${key.answer_text}`);
        }
    }

    const totalQuestions = answerKeys.length;
    const score = (correctCount / totalQuestions) * 100;
    const feedback = feedbackLines.join('\n');

    // Save submission to database
    const insertRes = await db.query(
      'INSERT INTO Student_Submissions (student_id, exam_id, extracted_text, score, feedback) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [studentId, examId, studentText, score, feedback]
    );

    return {
      submission_id: insertRes.rows[0].id,
      score,
      feedback,
      extracted_text: studentText
    };

  } catch (error) {
    console.error('Error grading submission:', error);
    throw error;
  }
}

module.exports = { extractTextFromImage, gradeSubmission };
