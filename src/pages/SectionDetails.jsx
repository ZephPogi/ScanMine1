import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './SectionDetails.css';
import Sidebar from './Sidebar';

const SectionDetails = ({ section, onBack }) => {
  const navigate = useNavigate();
  // Mock data para sa students
  const students = [
    { id: "2023-0001", name: "Jose Rizal", gender: "Male", email: "rizal.j@school.edu" },
    { id: "2023-0002", name: "Andres Bonifacio", gender: "Male", email: "bonifacio.a@school.edu" },
    { id: "2023-0003", name: "Maria Clara", gender: "Female", email: "clara.m@school.edu" },
  ];

  // Attach Exam modal state
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [examFile, setExamFile] = useState(null);
  const [answerKeyFile, setAnswerKeyFile] = useState(null);
  const [manualAnswers, setManualAnswers] = useState('');
  const examInputRef = useRef(null);
  const answerInputRef = useRef(null);

  // AI Quiz Generator modal state
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [quizFile, setQuizFile] = useState(null);
  const quizFileInputRef = useRef(null);

  // Add Q&A Manually modal state
  const [showQAModal, setShowQAModal] = useState(false);
  const [qaList, setQAList] = useState([
    { question: '', answer: '' },
    { question: '', answer: '' },
  ]);

  // Quiz Taking Interface modal state
  const [showQuizTaking, setShowQuizTaking] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [answerSheetFile, setAnswerSheetFile] = useState(null);
  const answerSheetRef = useRef(null);

  // Mock quiz data
  const quizQuestions = [
    { id: 1, text: 'What is the value of x in 2x + 4 = 10?', options: ['x = 2', 'x = 3', 'x = 4'] },
    { id: 2, text: 'Simplify: 5(x - 2) + 3', options: ['5x - 7', '5x - 10', '5x + 1'] },
    { id: 3, text: 'What is the slope of y = 3x + 1?', options: ['1', '3', '-3'] },
    { id: 4, text: 'Factor: x² - 9', options: ['(x-3)(x+3)', '(x-9)(x+1)', '(x-3)²'] },
    { id: 5, text: 'Solve for x: 3x + 7 = 22', options: ['x = 3', 'x = 5', 'x = 7'] },
    { id: 6, text: 'What is 2³?', options: ['6', '8', '9'] },
    { id: 7, text: 'Solve: |x - 4| = 6', options: ['x = 10 or x = -2', 'x = 10', 'x = -2'] },
    { id: 8, text: 'What is the y-intercept of y = 2x + 5?', options: ['2', '5', '-5'] },
    { id: 9, text: 'Simplify: √144', options: ['12', '14', '11'] },
    { id: 10, text: 'Solve: x/3 = 9', options: ['x = 3', 'x = 27', 'x = 12'] },
  ];

  const handleExamFileChange = (e) => {
    if (e.target.files[0]) setExamFile(e.target.files[0]);
  };

  const handleAnswerKeyFileChange = (e) => {
    if (e.target.files[0]) setAnswerKeyFile(e.target.files[0]);
  };

  const handleSaveAndAssign = () => {
    // TODO: Implement save logic
    console.log('Exam file:', examFile);
    console.log('Answer key file:', answerKeyFile);
    console.log('Manual answers:', manualAnswers);
    setShowAttachModal(false);
    // Reset
    setExamFile(null);
    setAnswerKeyFile(null);
    setManualAnswers('');
  };

  const closeModal = () => {
    setShowAttachModal(false);
    setExamFile(null);
    setAnswerKeyFile(null);
    setManualAnswers('');
  };

  const handleQuizFileChange = (e) => {
    if (e.target.files[0]) setQuizFile(e.target.files[0]);
  };

  const handleGenerateQuiz = () => {
    // TODO: Implement AI quiz generation
    console.log('Quiz file:', quizFile);
    setShowQuizModal(false);
    setQuizFile(null);
  };

  const closeQuizModal = () => {
    setShowQuizModal(false);
    setQuizFile(null);
  };

  // Q&A handlers
  const handleQAChange = (index, field, value) => {
    const updated = [...qaList];
    updated[index][field] = value;
    setQAList(updated);
  };

  const addQuestion = () => {
    setQAList([...qaList, { question: '', answer: '' }]);
  };

  const handleSaveQuiz = () => {
    // TODO: Implement save quiz logic
    console.log('Q&A list:', qaList);
    setShowQAModal(false);
    setQAList([{ question: '', answer: '' }, { question: '', answer: '' }]);
  };

  const closeQAModal = () => {
    setShowQAModal(false);
    setQAList([{ question: '', answer: '' }, { question: '', answer: '' }]);
  };

  // Quiz Taking handlers
  const handleSelectAnswer = (questionIdx, optionIdx) => {
    setSelectedAnswers({ ...selectedAnswers, [questionIdx]: optionIdx });
  };

  const handlePrevQuestion = () => {
    if (currentQuestion > 0) setCurrentQuestion(currentQuestion - 1);
  };

  const handleNextQuestion = () => {
    if (currentQuestion < quizQuestions.length - 1) setCurrentQuestion(currentQuestion + 1);
  };

  const handleSubmitExam = () => {
    console.log('Submitted answers:', selectedAnswers);
    console.log('Answer sheet file:', answerSheetFile);
    setShowQuizTaking(false);
    setCurrentQuestion(0);
    setSelectedAnswers({});
    setAnswerSheetFile(null);
  };

  const closeQuizTaking = () => {
    setShowQuizTaking(false);
    setCurrentQuestion(0);
    setSelectedAnswers({});
    setAnswerSheetFile(null);
  };

  return (
    <div className="page-layout">
      <Sidebar />
      <div className="section-container">
        {/* 1. BACK BUTTON & SUBJECT INFO */}
        <header className="minimal-header">
          <button className="back-btn" onClick={onBack}>
            ← Back to Classes
          </button>
          <div className="subject-title">
            <h1>{section?.name || "Grade 10 - Rizal"}</h1>
            <p>{section?.subject || "Philippine History"}</p>
          </div>
        </header>

        <div className="section-grid">
          {/* 2. STUDENT ROSTER */}
          <section className="roster-section">
            <div className="card-header">
              <h3>👥 Student Roster</h3>
              <button className="add-btn">+ Add Student</button>
            </div>
            <div className="table-wrapper">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td className="student-name">{s.name}</td>
                      <td>{s.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3 & 4. MANAGEMENT & RESULTS */}
          <aside className="actions-sidebar">
            {/* Exam Management */}
            <div className="action-card">
              <h4>Exam Management</h4>
              <button className="btn-action primary" onClick={() => setShowAttachModal(true)}>
                Attach Exam & Key
              </button>
              <button className="btn-action secondary" onClick={() => setShowQuizModal(true)}>AI Quiz Generator</button>
              <button className="btn-action outline" onClick={() => setShowQAModal(true)}>Add Q&A Manually</button>
            </div>

            {/* Result and View */}
            <div className="action-card">
              <h4>Result and View</h4>
              <button className="btn-action success" onClick={() => navigate('/auto-grading-results')}>Auto-Grading Results</button>
              <button className="btn-action info" onClick={() => setShowQuizTaking(true)}>Quiz Taking Interface</button>
            </div>
          </aside>
        </div>
      </div>

      {/* ===== ATTACH EXAM MODAL ===== */}
      {showAttachModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content attach-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="modal-header-bar">
              <span className="modal-prof-label">prof</span>
              <button className="modal-close-btn" onClick={closeModal}>×</button>
            </div>

            <div className="modal-title-banner">
              Attach Exam with Answer Key
            </div>

            {/* Exam Questions File */}
            <div className="upload-section">
              <label className="upload-label">📄 Exam Questions File</label>
              <div className="upload-row">
                <span className="upload-placeholder">
                  {examFile ? examFile.name : 'Upload PDF / Word / Image (Questions only)'}
                </span>
                <input
                  type="file"
                  ref={examInputRef}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  style={{ display: 'none' }}
                  onChange={handleExamFileChange}
                />
                <button className="browse-btn exam-browse" onClick={() => examInputRef.current.click()}>
                  Browse
                </button>
              </div>
            </div>

            {/* Answer Key File */}
            <div className="upload-section">
              <label className="upload-label">🔑 Answer Key (Correct Answers)</label>
              <div className="upload-row">
                <span className="upload-placeholder">
                  {answerKeyFile ? answerKeyFile.name : 'Upload PDF / Image / Text (Correct answers)'}
                </span>
                <input
                  type="file"
                  ref={answerInputRef}
                  accept=".pdf,.png,.jpg,.jpeg,.txt"
                  style={{ display: 'none' }}
                  onChange={handleAnswerKeyFileChange}
                />
                <button className="browse-btn answer-browse" onClick={() => answerInputRef.current.click()}>
                  Browse
                </button>
              </div>
            </div>

            {/* Manual Answer Key */}
            <div className="manual-section">
              <p className="manual-divider">— Or type answer key manually —</p>
              <textarea
                className="manual-textarea"
                placeholder="Type answers in order (e.g., A, B, C, D...)"
                value={manualAnswers}
                onChange={(e) => setManualAnswers(e.target.value)}
                rows={4}
              />
              <p className="manual-hint">1. B 2. A 3. C 4. D 5. B</p>
            </div>

            {/* Save Button */}
            <div className="modal-footer">
              <button className="save-assign-btn" onClick={handleSaveAndAssign}>
                Save & Assign to Students
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== AI QUIZ GENERATOR MODAL ===== */}
      {showQuizModal && (
        <div className="modal-overlay" onClick={closeQuizModal}>
          <div className="modal-content quiz-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="modal-header-bar">
              <span className="modal-prof-label">prof</span>
              <button className="modal-close-btn" onClick={closeQuizModal}>×</button>
            </div>

            <div className="modal-title-banner">
              Generate Quiz from File
            </div>

            {/* Steps */}
            <div className="quiz-steps">
              <div className="quiz-step-row">
                <span className="quiz-step-icon">📄</span>
                <span>Upload any file (PDF, Image, Word, Text)</span>
                <input
                  type="file"
                  ref={quizFileInputRef}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
                  style={{ display: 'none' }}
                  onChange={handleQuizFileChange}
                />
              </div>
              <div className="quiz-step-row">
                <span className="quiz-step-icon">🤖</span>
                <span>AI extracts questions & answers automatically</span>
              </div>
              <div className="quiz-step-row">
                <span className="quiz-step-icon">👁</span>
                <span>Preview & edit generated quiz</span>
              </div>
            </div>

            {/* Generate Button */}
            <div className="modal-footer">
              <button className="generate-quiz-btn" onClick={() => { quizFileInputRef.current.click(); }}>
                ✦ Generate Quiz
              </button>
            </div>

            <p className="quiz-capture-hint">📷 Or capture physical question paper → auto-extract</p>
          </div>
        </div>
      )}

      {/* ===== ADD Q&A MANUALLY MODAL ===== */}
      {showQAModal && (
        <div className="modal-overlay" onClick={closeQAModal}>
          <div className="modal-content qa-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="modal-header-bar">
              <span className="modal-prof-label">prof</span>
              <button className="modal-close-btn qa-close" onClick={closeQAModal}>×</button>
            </div>

            <div className="modal-title-banner qa-banner">
              Add Questions & Answers
            </div>

            {/* Questions List */}
            <div className="qa-list">
              {qaList.map((item, index) => (
                <div className="qa-item" key={index}>
                  <label className="qa-label">Question {index + 1}</label>
                  <input
                    type="text"
                    className="qa-input"
                    placeholder={index === 0 ? 'What is the capital of France?' : 'Solve for x: 2x + 5 = 15'}
                    value={item.question}
                    onChange={(e) => handleQAChange(index, 'question', e.target.value)}
                  />
                  <label className="qa-answer-label">Answer:</label>
                  <input
                    type="text"
                    className="qa-input"
                    placeholder={index === 0 ? 'Paris' : 'x = 5'}
                    value={item.answer}
                    onChange={(e) => handleQAChange(index, 'answer', e.target.value)}
                  />
                </div>
              ))}
            </div>

            {/* Add Another */}
            <div className="qa-add-wrapper">
              <button className="qa-add-btn" onClick={addQuestion}>
                + Add Another Question
              </button>
            </div>

            {/* Save */}
            <div className="modal-footer">
              <button className="qa-save-btn" onClick={handleSaveQuiz}>
                Save Quiz
              </button>
            </div>

            <p className="qa-scan-hint">📷 Scan physical answer sheet → Auto-grade</p>
          </div>
        </div>
      )}

      {/* ===== QUIZ TAKING INTERFACE MODAL ===== */}
      {showQuizTaking && (
        <div className="modal-overlay" onClick={closeQuizTaking}>
          <div className="modal-content quiz-taking-modal" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="modal-header-bar">
              <span className="modal-prof-label">student / interface taking</span>
              <button className="modal-close-btn" onClick={closeQuizTaking}>×</button>
            </div>

            <div className="modal-title-banner quiz-taking-banner">
              <span>Algebra Midterm Exam</span>
              <span className="quiz-timer">Time: 45:00</span>
            </div>

            {/* Progress */}
            <div className="quiz-progress-section">
              <div className="quiz-progress-bar">
                <div
                  className="quiz-progress-fill"
                  style={{ width: `${((currentQuestion + 1) / quizQuestions.length) * 100}%` }}
                />
              </div>
              <span className="quiz-progress-text">Question {currentQuestion + 1} of {quizQuestions.length}</span>
            </div>

            {/* Question Card */}
            <div className="quiz-question-card">
              <h4 className="quiz-q-title">Question {currentQuestion + 1}:</h4>
              <p className="quiz-q-text">{quizQuestions[currentQuestion].text}</p>

              <div className="quiz-options">
                {quizQuestions[currentQuestion].options.map((opt, idx) => (
                  <label
                    key={idx}
                    className={`quiz-option ${selectedAnswers[currentQuestion] === idx ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`q-${currentQuestion}`}
                      checked={selectedAnswers[currentQuestion] === idx}
                      onChange={() => handleSelectAnswer(currentQuestion, idx)}
                    />
                    <span className="quiz-option-radio" />
                    <span>{String.fromCharCode(65 + idx)}) {opt}</span>
                  </label>
                ))}
              </div>

              {/* Nav Buttons */}
              <div className="quiz-nav-row">
                <button
                  className="quiz-nav-btn prev"
                  onClick={handlePrevQuestion}
                  disabled={currentQuestion === 0}
                >
                  ← Previous
                </button>
                <button
                  className="quiz-nav-btn next"
                  onClick={handleNextQuestion}
                  disabled={currentQuestion === quizQuestions.length - 1}
                >
                  Next →
                </button>
              </div>
            </div>

            {/* Physical Answer Sheet */}
            <div className="quiz-upload-section">
              <h4 className="quiz-upload-title">📷 Or submit physical answer sheet</h4>
              <p className="quiz-upload-desc">Solve on paper, take a photo, upload — ScanMine will auto-grade</p>
              <div
                className="quiz-upload-drop"
                onClick={() => answerSheetRef.current.click()}
              >
                <input
                  type="file"
                  ref={answerSheetRef}
                  accept=".png,.jpg,.jpeg,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files[0]) setAnswerSheetFile(e.target.files[0]); }}
                />
                📎 {answerSheetFile ? answerSheetFile.name : 'Click or drag to upload answer sheet image'}
              </div>
            </div>

            {/* Submit */}
            <div className="modal-footer">
              <button className="quiz-submit-btn" onClick={handleSubmitExam}>
                Submit Exam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SectionDetails;