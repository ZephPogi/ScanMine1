const fs = require('fs');
const pdfParse = require('pdf-parse');
const db = require('../db');

/**
 * Extracts text from a file buffer (PDF or plain text)
 */
async function extractText(filePath, mimetype) {
  if (mimetype === 'application/pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } else {
    // Fallback to plain text
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

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    const generatedQuestions = [];

    for (let sentence of sentences) {
      sentence = sentence.trim();
      for (let rule of rules) {
        if (sentence.toLowerCase().includes(rule.keyword.toLowerCase())) {
          // Simple logic: remove the keyword and everything after it to form a "What is X?" question
          // Or just ask about the sentence
          const parts = sentence.split(new RegExp(rule.keyword, 'i'));
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
