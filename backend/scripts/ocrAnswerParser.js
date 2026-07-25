/**
 * OCR Answer Parser
 * Extracts question numbers, answers, and question text from OCR text
 * Captures full line: [Answer Text] + [Number] + [Question Text]
 */

/**
 * Parse OCR text to extract question-answer pairs with full question text
 * @param {string} ocrText - Raw OCR text from the image
 * @returns {Array} - Array of objects with { questionNumber, answer, questionText }
 */
function parseOCRAnswers(ocrText) {
  if (!ocrText || typeof ocrText !== 'string') {
    return [];
  }

  const questions = [];
  
  // Split text into lines for better parsing
  const lines = ocrText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Flexible regex to capture: [Answer Text] + [Number] + [Question Text]
  // Pattern: (.*?)\s*(\d+[\.\)])\s*(.*)
  const fullLinePattern = /^(.*?)\s*(\d+[\.\)])\s*(.*)$/;
  
  for (const line of lines) {
    const match = line.match(fullLinePattern);
    
    if (match) {
      const studentAnswer = match[1].trim();
      const questionId = parseInt(match[2].replace(/[^\d]/g, ''));
      const questionText = match[3].trim();
      
      // Only add if we have a reasonable answer (not empty, not too long)
      if (studentAnswer.length > 0 && studentAnswer.length < 100) {
        questions.push({
          questionNumber: questionId,
          answer: studentAnswer,
          questionText: questionText
        });
      }
    }
  }
  
  // If no matches with full line pattern, try alternative approach
  // This handles cases where answer and question might be on separate lines
  if (questions.length === 0) {
    const alternativePattern = /([A-Za-z0-9\s]+)\s*(\d+)[.)]\s*(.*)/g;
    let altMatch;
    
    while ((altMatch = alternativePattern.exec(ocrText)) !== null) {
      const answerText = altMatch[1].trim();
      const questionNumber = parseInt(altMatch[2]);
      const questionText = altMatch[3].trim();
      
      if (answerText.length > 0 && answerText.length < 100) {
        questions.push({
          questionNumber,
          answer: answerText,
          questionText: questionText
        });
      }
    }
  }
  
  // Sort by question number
  return questions.sort((a, b) => a.questionNumber - b.questionNumber);
}

/**
 * Parse OCR text and return just the answers in order
 * @param {string} ocrText - Raw OCR text from the image
 * @returns {Array} - Array of answer strings in order
 */
function parseAnswersOnly(ocrText) {
  const parsed = parseOCRAnswers(ocrText);
  
  // Sort by question number and return just the answers
  return parsed
    .sort((a, b) => a.questionNumber - b.questionNumber)
    .map(item => item.answer);
}

/**
 * Parse OCR text and return full question-answer pairs
 * @param {string} ocrText - Raw OCR text from the image
 * @returns {Array} - Array of objects with { questionNumber, answer, questionText }
 */
function parseFullQuestions(ocrText) {
  return parseOCRAnswers(ocrText);
}

module.exports = {
  parseOCRAnswers,
  parseAnswersOnly,
  parseFullQuestions
};
