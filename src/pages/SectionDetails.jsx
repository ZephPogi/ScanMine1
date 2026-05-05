import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Eye } from 'lucide-react';
import './SectionDetails.css';
import Sidebar from './Sidebar';

const SectionDetails = ({ section, onBack }) => {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [allStudents, setAllStudents] = useState([]);
  
  // Attach Exam modal state
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [showExamDetails, setShowExamDetails] = useState(null);
  const [examQuestions, setExamQuestions] = useState({ manual: [], generated: [] });
  const [examFile, setExamFile] = useState(null);
  const [manualAnswers, setManualAnswers] = useState('');
  const [examTitle, setExamTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [answerKeyImage, setAnswerKeyImage] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  const examInputRef = useRef(null);
  const [extractedOCRText, setExtractedOCRText] = useState('');
  // eslint-disable-next-line no-unused-vars
  const answerKeyInputRef = useRef(null);

  // Add Student modal state
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const fetchStudents = useCallback(async () => {
    try {
      const response = await fetch(`/api/classes/${section?.id}/students`);
      if (response.ok) {
        const data = await response.json();
        setStudents(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  }, [section?.id]);

  const fetchExams = useCallback(async () => {
    try {
      const response = await fetch(`/api/exams?classId=${section?.id}`);
      if (response.ok) {
        const data = await response.json();
        setExams(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching exams:', error);
    }
  }, [section?.id]);

  useEffect(() => {
    if (section?.id) {
      fetchStudents();
      fetchExams();
    }
  }, [section?.id, fetchStudents, fetchExams]);

  if (!section) return null;

  const handleViewExam = async (exam) => {
    setShowExamDetails(exam);
    try {
      const response = await fetch(`/api/exams/${exam.id}/questions`);
      if (response.ok) {
        const data = await response.json();
        setExamQuestions(data);
      }
    } catch (error) {
      console.error('Error fetching exam questions:', error);
    }
  };

  const handleDeleteExam = async (e, examId) => {
    e.stopPropagation(); // prevent opening details
    if (!window.confirm('Are you sure you want to delete this exam? All student results for this exam will also be deleted.')) return;
    
    try {
      const response = await fetch(`/api/exams/${examId}`, { method: 'DELETE' });
      if (response.ok) {
        fetchExams();
      }
    } catch (error) {
      console.error('Error deleting exam:', error);
    }
  };

  const fetchAllStudents = async () => {
    try {
      const response = await fetch(`/api/all-students`);
      if (response.ok) {
        const data = await response.json();
        setAllStudents(Array.isArray(data) ? data : []);
        setShowAddStudentModal(true);
      }
    } catch (error) {
      console.error('Error fetching all students:', error);
    }
  };

  const handleAddStudentToClass = async (student) => {
  try {
    // We send the email so the backend can find the corresponding User ID
    const response = await fetch(`/api/students`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email: student.email, // Send the email string, not the ID
        classId: section.id 
      }),
    });

    if (response.ok) {
      fetchStudents(); // Refresh the class roster table
      setShowAddStudentModal(false);
    } else {
      const errorData = await response.json();
      alert("Error: " + errorData.error);
    }
  } catch (error) {
    console.error('Error adding student:', error);
  }
};

  const handleExamFileChange = (e) => {
    if (e.target.files[0]) setExamFile(e.target.files[0]);
  };

  // eslint-disable-next-line no-unused-vars
  const handleAnswerKeyImageChange = (e) => {
    if (e.target.files[0]) setAnswerKeyImage(e.target.files[0]);
  };

  // eslint-disable-next-line no-unused-vars
  const handleProcessOCR = async (examId) => {
    if (!answerKeyImage) return alert('Please select an answer key image first');

    setIsProcessingOCR(true);
    try {
      const formData = new FormData();
      formData.append('image', answerKeyImage);
      formData.append('examId', examId);

      const response = await fetch('/api/test-ocr', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (response.ok) {
        alert(`OCR processed successfully! Extracted ${data.answersCount} answers.`);
        setExtractedOCRText(data.text);
        setManualAnswers(data.text);
        setAnswerKeyImage(null);
        // Re-fetch exam questions to update the UI
        if (showExamDetails) {
          const questionsResponse = await fetch(`/api/exams/${showExamDetails.id}/questions`);
          if (questionsResponse.ok) {
            const questionsData = await questionsResponse.json();
            setExamQuestions(questionsData);
          }
        }
      } else {
        alert('OCR processing failed: ' + data.error);
      }
    } catch (error) {
      console.error('OCR error:', error);
      alert('Error processing OCR: ' + error.message);
    } finally {
      setIsProcessingOCR(false);
    }
  };

  const handleSaveOCRToDatabase = async () => {
    if (!extractedOCRText || !showExamDetails?.id) return alert('No OCR text or exam ID available');

    try {
      const response = await fetch('/api/upload-answer-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examId: showExamDetails.id,
          answers: extractedOCRText
        })
      });

      if (response.ok) {
        alert('Answer key saved successfully to the database!');
        
        // Re-fetch exam questions to update the UI
        const questionsResponse = await fetch(`/api/exams/${showExamDetails.id}/questions`);
        if (questionsResponse.ok) {
          const questionsData = await questionsResponse.json();
          setExamQuestions(questionsData);
        }
        
        // Notice I removed the line that hides the box so it stays on screen!
        
      } else {
        const errorData = await response.json();
        alert('Failed to save answer key: ' + errorData.error);
      }
    } catch (error) {
      console.error('Error saving OCR to database:', error);
      alert('Error saving answer key: ' + error.message);
    }
  };
  
  const handleSaveAndAssign = async () => {
    if (!examTitle) return alert('Please enter an exam title');
    
    setIsSaving(true);
    try {
      // 1. Save Exam first
      const formData = new FormData();
      formData.append('teacherId', user.id);
      formData.append('classId', section?.id);
      formData.append('title', examTitle);
      if (examFile) formData.append('lessonFile', examFile); 
      
      const examResponse = await fetch('/api/generate-quiz', {
        method: 'POST',
        body: formData
      });
      
      const examData = await examResponse.json();
      
      if (!examResponse.ok) {
        throw new Error(examData.error || 'Failed to save exam');
      }

      const examId = examData.examId;

      // 2. Save Answer Key
      if (examId && manualAnswers) {
        await fetch('/api/upload-answer-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            examId: examId,
            answers: manualAnswers 
          })
        });
      }
      
      alert('Exam and Key saved successfully!');
      fetchExams();
      setShowAttachModal(false);
      setExamTitle('');
      setManualAnswers('');
      setExamFile(null);
    } catch (error) {
      console.error('Error saving exam/key:', error);
      alert('Save failed: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const closeModal = () => {
    if (isSaving) return;
    setShowAttachModal(false);
    setExamFile(null);
    setManualAnswers('');
    setAnswerKeyImage(null);
  };

  return (
    <div className="page-layout">
      <Sidebar />
      <div className="section-container">
        <header className="minimal-header">
          <button className="back-btn" onClick={onBack}>
            ← Back to Classes
          </button>
          <div className="subject-title">
            <h1>{section?.name}</h1>
            <p>{section?.subject}</p>
          </div>
        </header>

        <div className="section-grid">
          <section className="roster-section">
            <div className="card-header">
              <h3>👥 Student Roster</h3>
              <button className="add-btn" onClick={fetchAllStudents}>+ Add Student</button>
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

          <aside className="actions-sidebar">
            <div className="action-card">
              <h4>Exam Management</h4>
              <button className="btn-action primary" onClick={() => setShowAttachModal(true)}>
                Attach Exam & Key
              </button>
              <button className="btn-action success" onClick={() => navigate('/auto-grading-results', { state: { section } })}>Auto-Grading Results</button>
            </div>

            <div className="action-card">
              <h4>Exams In Class</h4>
              <div className="exam-list">
                {exams.map((exam) => (
                  <div key={exam.id} className="exam-card" onClick={() => handleViewExam(exam)}>
                    <div className="exam-icon">📄</div>
                    <div className="exam-info">
                      <h4>{exam.title}</h4>
                      <p>{new Date(exam.created_at).toLocaleDateString()}</p>
                    </div>
                    <button
                      className="delete-exam-btn"
                      onClick={(e) => handleDeleteExam(e, exam.id)}
                      title="Delete Exam"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {showAddStudentModal && (
        <div className="modal-overlay" onClick={() => setShowAddStudentModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Add Student to Class</h3>
            <div className="student-select-list">
              {allStudents.map(s => (
                <div key={s.id} className="student-select-item">
                  <span>{s.name} ({s.email})</span>
                  <button onClick={() => handleAddStudentToClass(s)}>Add</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAttachModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content attach-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <span className="modal-prof-label">ScanMine Professor Console</span>
              <button className="modal-close-btn" onClick={closeModal}>×</button>
            </div>

            <div className="modal-title-banner">
              Attach Exam with Answer Key
            </div>

            <div className="upload-section">
              <label className="upload-label">Exam Title</label>
              <input 
                type="text" 
                className="create-input" 
                placeholder="e.g. Algebra Midterm" 
                value={examTitle}
                onChange={(e) => setExamTitle(e.target.value)}
              />
            </div>

            <div className="upload-section">
              <label className="upload-label">📄 Exam Questions File (Optional)</label>
              <div className="upload-row" onClick={() => examInputRef.current.click()}>
                <span className="upload-placeholder">
                  {examFile ? examFile.name : 'Upload PDF / Word / Image'}
                </span>
                <input
                  type="file"
                  ref={examInputRef}
                  style={{ display: 'none' }}
                  onChange={handleExamFileChange}
                />
                <button className="browse-btn exam-browse">
                  Browse
                </button>
              </div>
            </div>

            <div className="manual-section">
              <p className="manual-divider">Define Answer Key (Optional - Space or Comma separated)</p>
              <textarea
                className="manual-textarea"
                placeholder="e.g. A, B, C, Newton, 10.5..."
                value={manualAnswers}
                onChange={(e) => setManualAnswers(e.target.value)}
              />
              <p className="manual-hint">The system will use this sequence to grade student submissions.</p>
            </div>

            <div className="manual-section">
              <p className="manual-divider">Or Upload Answer Key Image for OCR Extraction</p>
              <div className="upload-row" onClick={() => answerKeyInputRef.current.click()}>
                <span className="upload-placeholder">
                  {answerKeyImage ? answerKeyImage.name : 'Upload Answer Key Image'}
                </span>
                <input
                  type="file"
                  ref={answerKeyInputRef}
                  style={{ display: 'none' }}
                  accept=".jpg,.jpeg,.png,.pdf"
                  onChange={handleAnswerKeyImageChange}
                />
                <button className="browse-btn exam-browse">
                  Browse
                </button>
              </div>
              <p className="manual-hint">Upload an image with answers marked (e.g., "A 1.", "B 2.", etc.)</p>
            </div>

            <div className="modal-footer">
              <button 
                className="save-assign-btn" 
                onClick={handleSaveAndAssign}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save & Link Key'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Exam Details Modal */}
      {showExamDetails && (
        <div className="modal-overlay" onClick={() => setShowExamDetails(null)}>
          <div className="modal-content details-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Exam Details: {showExamDetails.title}</h2>
              <div style={{display: 'flex', gap: '10px'}}>
                {showExamDetails.file_path && (
                  <a
                    href={showExamDetails.file_path}
                    target="_blank"
                    rel="noreferrer"
                    className="view-pdf-link"
                  >
                    <Eye size={16} />
                    <span>View Original PDF</span>
                  </a>
                )}
                <button className="close-btn" onClick={() => setShowExamDetails(null)}>×</button>
              </div>
            </div>
            <div className="modal-body">
  <div className="details-section">
    <h4>AI Generated Questions ({examQuestions?.generated?.length || 0})</h4>
    <div className="questions-list">
      {examQuestions?.generated?.map((q, idx) => (
        <div key={q.id} className="question-item">
          <p><strong>{idx + 1}. {q.question_text}</strong></p>
          <p className="ans-text">Answer: {q.correct_answer}</p>
        </div>
      ))}
      {!examQuestions?.generated?.length && <p>No questions generated by AI.</p>}
    </div>
  </div>
  <div className="details-section">
    <h4>Manual Answer Key ({examQuestions?.manual?.length || 0})</h4>
    <div className="questions-list">
      {examQuestions?.manual?.map((a, idx) => (
        <div key={a.id} className="question-item">
          <p><strong>{idx + 1}. {a.question_text || 'Question text not available'}</strong></p>
          <p className="ans-text">Answer: {a.correct_answer}</p>
        </div>
      ))}
      {!examQuestions?.manual?.length && <p>No manual answers defined.</p>}
    </div>
  </div>
              <div className="details-section">
                <h4>OCR Answer Key Extraction</h4>
                <div className="upload-row" onClick={() => answerKeyInputRef.current.click()}>
                  <span className="upload-placeholder">
                    {answerKeyImage ? answerKeyImage.name : 'Upload Answer Key Image'}
                  </span>
                  <input
                    type="file"
                    ref={answerKeyInputRef}
                    style={{ display: 'none' }}
                    accept=".jpg,.jpeg,.png,.pdf"
                    onChange={handleAnswerKeyImageChange}
                  />
                  <button className="browse-btn exam-browse">
                    Browse
                  </button>
                </div>
                <button 
                  className="save-assign-btn" 
                  onClick={() => handleProcessOCR(showExamDetails.id)}
                  disabled={isProcessingOCR || !answerKeyImage}
                  style={{ marginTop: '10px', width: '100%' }}
                >
                  {isProcessingOCR ? 'Processing OCR...' : 'Extract Answers via OCR'}
                </button>
                <p className="manual-hint">Upload an image with answers marked (e.g., "A 1.", "B 2.", etc.)</p>

                {/* --- ADD THIS NEW DISPLAY BOX --- */}
                {extractedOCRText && (
                  <div style={{ marginTop: '15px', padding: '15px', background: '#f8f9fa', border: '1px solid #ddd', borderRadius: '8px' }}>
                    <h5 style={{ margin: '0 0 10px 0', color: '#333' }}>Raw OCR Extraction Result:</h5>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '13px', margin: '0 0 15px 0', color: '#555', fontFamily: 'monospace' }}>
                      {extractedOCRText}
                    </pre>
                    <button
                      onClick={handleSaveOCRToDatabase}
                      style={{
                        padding: '8px 16px',
                        background: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                    >
                      Save as Official Answer Key
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SectionDetails;