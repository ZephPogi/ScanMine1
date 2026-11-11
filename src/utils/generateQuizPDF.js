const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const MARGIN = 15;
const LINE_HEIGHT = 5;

const getQuestionText = (question, index) => (
  question?.question
  || question?.question_text
  || question?.questionText
  || `Question ${index + 1}`
);

const getOptions = (question) => (
  Array.isArray(question?.options)
    ? question.options.map(option => {
      const value = typeof option === 'string'
        ? option
        : option?.text || option?.label || option?.value || '';
      return String(value).replace(/^\s*[A-D]\s*[.)]\s*/i, '').trim();
    })
    : []
);

const getCorrectAnswer = (question, options) => {
  const answer = String(
    question?.correctAnswer
    ?? question?.correct_answer
    ?? question?.answer_text
    ?? question?.answer
    ?? ''
  ).replace(/^(?:Answer:\s*)+/i, '').trim();
  const letterMatch = answer.match(/^([A-D])(?:\s*[).:-]|\s*\(|$)/i);

  if (letterMatch) {
    const letter = letterMatch[1].toUpperCase();
    const option = options[letter.charCodeAt(0) - 65];
    return option ? `${letter}) ${option}` : letter;
  }

  const optionIndex = options.findIndex(option => option && option.toLowerCase() === answer.toLowerCase());
  return optionIndex >= 0 ? `${String.fromCharCode(65 + optionIndex)}) ${options[optionIndex]}` : answer || 'N/A';
};

const getQuestions = (quiz) => {
  if (Array.isArray(quiz?.questions) && quiz.questions.length) return quiz.questions;
  return [
    ...(Array.isArray(quiz?.manual) ? quiz.manual : []),
    ...(Array.isArray(quiz?.generated) ? quiz.generated : [])
  ];
};

const getSectionName = (quiz) => (
  quiz?.section?.name
  || quiz?.section_name
  || quiz?.sectionName
  || (typeof quiz?.section === 'string' ? quiz.section : '')
);

export const generateQuizPDF = (quiz) => {
  const questions = getQuestions(quiz);
  if (!questions.length) {
    throw new Error('There are no questions available to include in the PDF.');
  }

  const { jsPDF: JsPDF } = require('jspdf');
  const doc = new JsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  let yPosition;

  const drawStudentHeader = () => {
    doc.setTextColor(...BLACK);
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.25);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(String(quiz?.title || quiz?.name || 'Quiz'), pageWidth / 2, 16, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const firstRowY = 26;
    const secondRowY = 35;
    const halfWidth = contentWidth / 2;
    doc.text('Name:', MARGIN, firstRowY);
    doc.line(MARGIN + 13, firstRowY + 1, MARGIN + halfWidth - 3, firstRowY + 1);
    doc.text('Date:', MARGIN + halfWidth, firstRowY);
    doc.line(MARGIN + halfWidth + 12, firstRowY + 1, pageWidth - MARGIN, firstRowY + 1);
    doc.text('Section:', MARGIN, secondRowY);
    doc.text(String(getSectionName(quiz)), MARGIN + 17, secondRowY);
    doc.line(MARGIN + 17, secondRowY + 1, MARGIN + halfWidth - 3, secondRowY + 1);
    doc.text('Score:', MARGIN + halfWidth, secondRowY);
    doc.line(MARGIN + halfWidth + 13, secondRowY + 1, pageWidth - MARGIN, secondRowY + 1);
    doc.line(MARGIN, 41, pageWidth - MARGIN, 41);
    yPosition = 49;
  };

  const addStudentPage = () => {
    doc.addPage();
    drawStudentHeader();
  };

  const ensureStudentSpace = (height) => {
    if (yPosition + height > pageHeight - MARGIN) addStudentPage();
  };

  const writeStudentText = (text, x, width, fontStyle, fontSize) => {
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(...BLACK);
    const lines = doc.splitTextToSize(String(text || ''), width);
    lines.forEach(line => {
      ensureStudentSpace(LINE_HEIGHT);
      doc.text(line, x, yPosition);
      yPosition += LINE_HEIGHT;
    });
  };

  drawStudentHeader();
  questions.forEach((question, index) => {
    const questionText = getQuestionText(question, index);
    writeStudentText(`${index + 1}. ${questionText}`, MARGIN, contentWidth, 'bold', 11);

    const options = getOptions(question);
    options.forEach((option, optionIndex) => {
      writeStudentText(
        `${String.fromCharCode(65 + optionIndex)}) ${option}`,
        MARGIN + 6,
        contentWidth - 6,
        'normal',
        10
      );
    });
    yPosition += 3;
  });

  const answerColumns = [
    { title: 'Item #', x: MARGIN, width: 18 },
    { title: 'Correct Answer', x: MARGIN + 18, width: 48 },
    { title: 'Question Context', x: MARGIN + 66, width: contentWidth - 66 }
  ];
  const keyLineHeight = 4.5;
  const keyRowPadding = 3;

  const drawAnswerKeyHeader = () => {
    doc.setTextColor(...BLACK);
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.25);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('OFFICIAL ANSWER KEY', pageWidth / 2, 18, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(String(quiz?.title || quiz?.name || 'Quiz'), pageWidth / 2, 25, { align: 'center' });

    yPosition = 32;
    const headerHeight = 8;
    answerColumns.forEach(column => {
      doc.setFillColor(...WHITE);
      doc.rect(column.x, yPosition, column.width, headerHeight, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(column.title, column.x + 2, yPosition + 5.3);
    });
    yPosition += headerHeight;
  };

  const addAnswerKeyPage = () => {
    doc.addPage();
    drawAnswerKeyHeader();
  };

  const drawAnswerKeyRowPart = (index, answerLines, contextLines, startLine, endLine, firstPart) => {
    const visibleContext = contextLines.slice(startLine, endLine);
    const visibleAnswer = answerLines.slice(startLine, endLine);
    const visibleItem = firstPart ? [String(index + 1)] : [];
    const lineCount = Math.max(visibleItem.length, visibleAnswer.length, visibleContext.length, 1);
    const rowHeight = lineCount * keyLineHeight + keyRowPadding * 2;

    if (yPosition + rowHeight > pageHeight - MARGIN) addAnswerKeyPage();

    answerColumns.forEach(column => {
      doc.setFillColor(...WHITE);
      doc.rect(column.x, yPosition, column.width, rowHeight, 'FD');
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...BLACK);
    const cellLines = [visibleItem, visibleAnswer, visibleContext];
    answerColumns.forEach((column, columnIndex) => {
      cellLines[columnIndex].forEach((line, lineIndex) => {
        doc.text(line, column.x + 2, yPosition + keyRowPadding + 3 + lineIndex * keyLineHeight);
      });
    });
    yPosition += rowHeight;
  };

  addAnswerKeyPage();
  questions.forEach((question, index) => {
    const options = getOptions(question);
    const answer = getCorrectAnswer(question, options);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const contextLines = doc.splitTextToSize(
      getQuestionText(question, index),
      answerColumns[2].width - 4
    );
    const answerLines = doc.splitTextToSize(answer, answerColumns[1].width - 4);
    let lineIndex = 0;
    let firstPart = true;

    while (lineIndex < Math.max(contextLines.length, answerLines.length, 1)) {
      const availableLines = Math.max(
        1,
        Math.floor((pageHeight - MARGIN - yPosition - keyRowPadding * 2) / keyLineHeight)
      );
      const endLine = Math.min(
        Math.max(contextLines.length, answerLines.length, 1),
        lineIndex + availableLines
      );
      drawAnswerKeyRowPart(index, answerLines, contextLines, lineIndex, endLine, firstPart);
      lineIndex = endLine;
      firstPart = false;
      if (lineIndex < Math.max(contextLines.length, answerLines.length, 1)) addAnswerKeyPage();
    }
  });

  const safeTitle = String(quiz?.title || quiz?.name || 'Quiz')
    .replace(/[<>:"/\\|?*]/g, '-')
    .trim();
  doc.save(`${safeTitle || 'Quiz'}-Exam.pdf`);
};

export default generateQuizPDF;
