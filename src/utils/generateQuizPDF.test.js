const mockPdfDoc = {
  internal: {
    pageSize: {
      getWidth: () => 210,
      getHeight: () => 297
    }
  },
  addPage: jest.fn(),
  line: jest.fn(),
  rect: jest.fn(),
  setDrawColor: jest.fn(),
  setFillColor: jest.fn(),
  setFont: jest.fn(),
  setFontSize: jest.fn(),
  setLineWidth: jest.fn(),
  setTextColor: jest.fn(),
  splitTextToSize: jest.fn(text => [String(text)]),
  text: jest.fn(),
  save: jest.fn()
};

jest.mock('jspdf', () => ({
  jsPDF: jest.fn(() => mockPdfDoc)
}));

import { generateQuizPDF } from './generateQuizPDF';

describe('generateQuizPDF', () => {
  beforeEach(() => {
    Object.values(mockPdfDoc).forEach(value => {
      if (typeof value?.mockClear === 'function') value.mockClear();
    });
    mockPdfDoc.splitTextToSize.mockImplementation(text => [String(text)]);
    mockPdfDoc.text.mockClear();
  });

  it('creates a monochrome student paper followed by a separate answer key', () => {
    generateQuizPDF({
      title: 'Science Quiz',
      section: { name: 'Section A' },
      questions: [{
        question_text: 'Which statement is true?',
        correct_answer: 'PRIVATE-ANSWER-789',
        type: 'multiple_choice',
        options: ['First choice', 'Second choice']
      }]
    });

    const textCalls = mockPdfDoc.text.mock.calls.map(([text]) => String(text));
    const answerKeyIndex = textCalls.indexOf('OFFICIAL ANSWER KEY');
    const studentText = textCalls.slice(0, answerKeyIndex).join(' ');

    expect(studentText).toContain('Name:');
    expect(studentText).toContain('Date:');
    expect(studentText).toContain('Section:');
    expect(studentText).toContain('Score:');
    expect(studentText).toContain('First choice');
    expect(studentText).toContain('Second choice');
    expect(studentText).not.toContain('PRIVATE-ANSWER-789');
    expect(answerKeyIndex).toBeGreaterThan(-1);
    expect(textCalls.slice(answerKeyIndex + 1).join(' ')).toContain('PRIVATE-ANSWER-789');
    expect(mockPdfDoc.addPage).toHaveBeenCalledTimes(1);
    expect(mockPdfDoc.save).toHaveBeenCalledWith('Science Quiz-Exam.pdf');

    [mockPdfDoc.setTextColor, mockPdfDoc.setDrawColor, mockPdfDoc.setFillColor]
      .forEach(setColor => setColor.mock.calls.forEach(color => {
        expect([[0, 0, 0], [255, 255, 255]]).toContainEqual(color);
      }));
  });

  it('rejects quizzes with no questions', () => {
    expect(() => generateQuizPDF({ title: 'Empty Quiz', questions: [] }))
      .toThrow('There are no questions available to include in the PDF.');
  });
});
