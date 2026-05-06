const fs = require('fs');
const db = require('../db');
const OCRRouter = require('./ocrRouter');
const nlp = require('compromise');

/**
 * Extracts text from a file buffer (PDF or plain text)
 * Uses dual-OCR strategy: Tesseract with LSTM for PDFs
 */
async function extractText(filePath, mimetype, fileBuffer = null) {
  if (mimetype === 'application/pdf') {
    try {
      const ocrRouter = new OCRRouter();

      // Use OCR router for PDF processing (Tesseract with LSTM)
      const text = await ocrRouter.processAnswerKey(filePath, mimetype, fileBuffer);

      console.log('--- PDF EXTRACTED TEXT (Dual-OCR) ---');
      console.log(text);
      console.log('-------------------------------------');

      return text || "PDF Content (Empty or unreadable)";
    } catch (e) {
      console.error("PDF Extraction failed:", e.message);
      // Fallback to pdf-parse if OCR router fails
      try {
        const { PDFParse } = require('pdf-parse');
        const dataBuffer = fileBuffer || fs.readFileSync(filePath);
        const parser = new PDFParse({ data: dataBuffer });
        const result = await parser.getText();
        await parser.destroy();
        return result.text || "PDF Content (Empty or unreadable)";
      } catch (fallbackError) {
        console.error("Fallback PDF extraction also failed:", fallbackError.message);
        return "PDF Content (Extraction failed. Please enter the answer key manually.)";
      }
    }
  } else {
    // Fallback to plain text - if buffer provided, convert to string
    if (fileBuffer) {
      return fileBuffer.toString('utf8');
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}

/**
 * Applies compromise NLP to generate fill-in-the-blank questions
 */
async function generateQuizFromText(text, examId, numberOfQuestions = 10) {
  try {
    const doc = nlp(text);
    const sentences = doc.sentences().out('array');

    const generatedQuestions = [];

    for (const sentence of sentences) {
      if (generatedQuestions.length >= numberOfQuestions) break;

      const trimmedSentence = sentence.trim();
      const wordCount = trimmedSentence.split(/\s+/).length;

      // Skip sentences that are too short or too long
      if (wordCount < 5 || wordCount > 20) continue;

      // Find the most prominent noun or entity
      const sentenceDoc = nlp(trimmedSentence);
      const nouns = sentenceDoc.nouns().out('array');
      const topics = sentenceDoc.topics().out('array');

      // Use topics first, then fall back to nouns
      const candidates = [...topics, ...nouns];

      if (candidates.length === 0) continue;

      // Take the first major noun/entity as the answer
      const answerText = candidates[0].trim();

      // Replace the answer with "__________" to create the question
      const questionText = trimmedSentence.replace(answerText, '__________');

      const question = {
        type: 'identification',
        answer_text: answerText,
        question_text: questionText
      };

      // Save to DB if examId is provided
      if (examId) {
        await db.query(
          'INSERT INTO Generated_Questions (exam_id, question_text, correct_answer) VALUES ($1, $2, $3)',
          [examId, questionText, answerText]
        );
      }

      generatedQuestions.push(question);
    }

    return generatedQuestions;
  } catch (error) {
    console.error('Error generating questions:', error);
    throw error;
  }
}

module.exports = { extractText, generateQuizFromText };
