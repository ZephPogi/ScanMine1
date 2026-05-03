const fs = require('fs');
const db = require('../db');
const OCRRouter = require('./ocrRouter');

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
 * Applies rules to the text to generate questions
 */
async function generateQuizFromText(text, examId) {
  try {
    // Fetch all rules from database
    const rulesRes = await db.query('SELECT * FROM Rules');
    const rules = rulesRes.rows;

    const lines = text.split(/\r?\n/);
    const generatedQuestions = [];

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      // Updated to handle patterns like "( Mercury ) 1. Question text" or "1. Question - Answer"
      // Captures full words inside any bracket type ( ), [ ], { }
      const qaMatch = line.match(/^(?:[\(\[\{]\s*([^\]\)\}]+\s*)[\)\]\}]\s*)?(\d+)[\.\)]?\s*(.+)$/);
      if (qaMatch) {
        const parenthesizedAns = qaMatch[1]?.trim();
        const qNum = qaMatch[2];
        const rest = qaMatch[3].trim();
        
        let answer = parenthesizedAns || rest;
        let questionText = parenthesizedAns ? rest : `Question ${qNum}`;

        // If no parenthesized answer, check if 'rest' contains a separator like '-' or ':'
        if (!parenthesizedAns && (rest.includes(' - ') || rest.includes(': '))) {
          const parts = rest.split(/ - |: /);
          if (parts.length >= 2) {
            questionText = parts[0].trim();
            answer = parts[1].trim();
          }
        }
        
        if (examId) {
          await db.query(
            'INSERT INTO Generated_Questions (exam_id, question_text, correct_answer) VALUES ($1, $2, $3)',
            [examId, questionText, answer]
          );
        }
        generatedQuestions.push({ question_text: questionText, correct_answer: answer });
        continue; 
      }

      for (let rule of rules) {
        if (line.toLowerCase().includes(rule.keyword.toLowerCase())) {
          // Simple logic: remove the keyword and everything after it to form a "What is X?" question
          // Or just ask about the sentence
          const parts = line.split(new RegExp(rule.keyword, 'i'));
          if (parts.length === 2) {
            const concept = parts[0].trim();
            const answer = parts[1].trim();
            
            let questionText = `What ${rule.keyword} ${answer}?`;
            if (rule.keyword === 'is defined as') {
               questionText = `What is the definition of ${concept}?`;
            }

            // Save to DB
            if (examId) {
                const insertRes = await db.query(
                  'INSERT INTO Generated_Questions (exam_id, rule_id, question_text, correct_answer) VALUES ($1, $2, $3, $4) RETURNING id',
                  [examId, rule.id, questionText, answer]
                );
                generatedQuestions.push({
                    id: insertRes.rows[0].id,
                    question_text: questionText,
                    correct_answer: answer
                });
            } else {
                 generatedQuestions.push({ question_text: questionText, correct_answer: answer });
            }
          }
        }
      }
    }
    return generatedQuestions;
  } catch (error) {
    console.error('Error generating questions:', error);
    throw error;
  }
}

module.exports = { extractText, generateQuizFromText };
