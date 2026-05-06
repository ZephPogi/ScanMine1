/* eslint-disable */
import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import './SectionDetails.css';
import Sidebar from './Sidebar';

// --- THE SMART PARSER ---
const parseScanMineText = (rawText) => {
  if (!rawText) return [];
  const lines = rawText.split('\n').map(line => line.trim()).filter(line => line !== '');
  const parsedQuestions = [];
  let currentAnswer = '?';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // If it's a question (e.g. "1. ...")
    if (/^\d+\./.test(line)) {
      parsedQuestions.push({
        questionText: line,
        correctAnswer: currentAnswer // Use the last answer we found
      });
      currentAnswer = '?'; // Reset ONLY after assigning
    } 
    // If it's an answer (Not a question, not a header)
    else if (!/^[A-D]\)/i.test(line) && !line.toLowerCase().includes('part')) {
       // Only update if it looks like a real answer
       if (line.length > 0 && line.length < 50) currentAnswer = line;
    }
  }
  return parsedQuestions;
};

const SectionDetails = ({ section, onBack }) => {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [allStudents, setAllStudents] = useState([]);
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [showExamDetails, setShowExamDetails] = useState(null);
  const [examQuestions, setExamQuestions] = useState({ manual: [], generated: [] });
  const [examFile, setExamFile] = useState(null);
  const [manualAnswers, setManualAnswers] = useState('');
  const [examTitle, setExamTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [answerKeyImage, setAnswerKeyImage] = useState(null);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  
  const [parsedOCRData, setParsedOCRData] = useState(null);
  const [formattedAnswersToSave, setFormattedAnswersToSave] = useState('');

  const examInputRef = useRef(null);
  const answerKeyInputRef = useRef(null);

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
    if (!exam) return;
    setShowExamDetails(exam);
    setParsedOCRData(null);
    try {
      const response = await fetch(`/api/exams/${exam.id}/questions`);
      if (response.ok) {
        const data = await response.json();
        setExamQuestions(data || { manual: [], generated: [] });
      }
    } catch (error) {
      console.error('Error fetching exam questions:', error);
    }
  };

  const handleDeleteExam = async (e, examId) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this exam? All student results for this exam will also be deleted.')) return;
    
    try {
      const response = await fetch(`/api/exams/${examId}`, { method: 'DELETE' });
      if (response.ok) {
        fetchExams();
        if (showExamDetails?.id === examId) setShowExamDetails(null);
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
    if (!student?.email) return;
    try {
      const response = await fetch(`/api/students`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: student.email,
          classId: section.id 
        }),
      });

      if (response.ok) {
        fetchStudents();
        setShowAddStudentModal(false);
      } else {
        const errorData = await response.json();
        alert("Error: " + (errorData?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error adding student:', error);
    }
  };

  const handleExamFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setExamFile(e.target.files[0]);
  };

  const handleAnswerKeyImageChange = (e) => {
    if (e.target.files && e.target.files[0]) setAnswerKeyImage(e.target.files[0]);
  };

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
      if (response.ok && data?.text) {
        alert('OCR processed successfully!');

        const structuredData = parseScanMineText(data.text);
        setParsedOCRData(structuredData);

        const finalAnswersString = structuredData.map(q => q?.correctAnswer || '').join(', ');
        setFormattedAnswersToSave(finalAnswersString);

        // Keep answerKeyImage visible so user can preview the PDF/Image while reviewing answers
      } else {
        alert('OCR processing failed: ' + (data?.error || 'No text extracted.'));
      }
    } catch (error) {
      console.error('OCR error:', error);
      alert('Error processing OCR: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsProcessingOCR(false);
    }
  };

 const handleSaveOCRToDatabase = async () => {
    // CHANGE: Check for parsedOCRData instead of formattedAnswersToSave
    if (!parsedOCRData || parsedOCRData.length === 0 || !showExamDetails?.id) {
        return alert('No valid OCR data to save');
    }

    try {
      const response = await fetch('/api/upload-answer-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examId: showExamDetails.id,
          // CHANGE: Send the structured array directly!
          answers: parsedOCRData 
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(result.message); // Will now say "Successfully saved X answers!"
        
        // Refresh UI
        const questionsResponse = await fetch(`/api/exams/${showExamDetails.id}/questions`);
        if (questionsResponse.ok) {
          const questionsData = await questionsResponse.json();
          setExamQuestions(questionsData || { manual: [], generated: [] });
        }
        setParsedOCRData(null);
      } else {
        const errorData = await response.json();
        alert('Failed to save: ' + (errorData?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving OCR to database:', error);
      alert('Error saving answer key: ' + (error?.message || 'Unknown error'));
    }
  };

  const handleSaveAndAssign = async () => {
    if (!examTitle) return alert('Please enter an exam title');
    
    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append('teacherId', user?.id || '');
      formData.append('classId', section?.id || '');
      formData.append('title', examTitle);
      if (examFile) formData.append('lessonFile', examFile); 
      
      const examResponse = await fetch('/api/generate-quiz', {
        method: 'POST',
        body: formData
      });
      
      const examData = await examResponse.json();
      
      if (!examResponse.ok) {
        throw new Error(examData?.error || 'Failed to save exam');
      }

      if (examData?.examId && manualAnswers) {
        await fetch('/api/upload-answer-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            examId: examData.examId,
            answers: manualAnswers 
          })
        });
      }
      
      alert('Exam and Key saved successfully!');
      fetchExams();
      closeModal();
    } catch (error) {
      console.error('Error saving exam/key:', error);
      alert('Save failed: ' + (error?.message || 'Unknown error'));
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
          <button className="back-btn" onClick={onBack}>← Back to Classes</button>
          <div className="subject-title">
            <h1>{section?.name || 'Class Details'}</h1>
            <p>{section?.subject || ''}</p>
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
                  {students && students.length > 0 ? (
                    students.map((s, idx) => s ? (
                      <tr key={s.id || `student-${idx}`}>
                        <td>{s.id || 'N/A'}</td>
                        <td className="student-name">{s.name || 'Unknown'}</td>
                        <td>{s.email || 'N/A'}</td>
                      </tr>
                    ) : null)
                  ) : (
                    <tr><td colSpan="3">No students found.</td></tr>
                  )}
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
                {exams && exams.length > 0 ? (
                  exams.map((exam, idx) => exam ? (
                    <div key={exam.id || `exam-${idx}`} className="exam-card" onClick={() => handleViewExam(exam)}>
                      <div className="exam-icon">📄</div>
                      <div className="exam-info">
                        <h4>{exam.title || 'Untitled Exam'}</h4>
                        <p>{exam.created_at ? new Date(exam.created_at).toLocaleDateString() : 'No date'}</p>
                      </div>
                      <button
                        className="delete-exam-btn"
                        onClick={(e) => handleDeleteExam(e, exam.id)}
                        title="Delete Exam"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ) : null)
                ) : (
                  <p style={{fontSize: '14px', color: '#666'}}>No exams posted yet.</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* MODALS BELOW */}
      
      {showAddStudentModal && (
        <div className="modal-overlay" onClick={() => setShowAddStudentModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Add Student to Class</h3>
            <div className="student-select-list">
              {allStudents && allStudents.map((s, idx) => s ? (
                <div key={s.id || `allstudent-${idx}`} className="student-select-item">
                  <span>{s.name || 'Unknown'} ({s.email || 'No email'})</span>
                  <button onClick={() => handleAddStudentToClass(s)}>Add</button>
                </div>
              ) : null)}
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

            <div className="modal-title-banner">Attach Exam with Answer Key</div>

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
              <div className="upload-row" onClick={() => examInputRef.current && examInputRef.current.click()}>
                <span className="upload-placeholder">
                  {examFile?.name ? examFile.name : 'Upload PDF / Word / Image'}
                </span>
                <input
                  type="file"
                  ref={examInputRef}
                  style={{ display: 'none' }}
                  onChange={handleExamFileChange}
                />
                <button className="browse-btn exam-browse">Browse</button>
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

      {showExamDetails && (
        <div className="modal-overlay" onClick={() => setShowExamDetails(null)}>
          <div className="modal-content details-modal" style={{ pointerEvents: 'auto', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Exam Details: {showExamDetails?.title || 'Untitled'}</h2>
              <div style={{display: 'flex', gap: '10px'}}>
                <button className="close-btn" onClick={() => setShowExamDetails(null)}>×</button>
              </div>
            </div>
            
            <div className="modal-body">
              <div className="details-section">
                <h4>Manual Answer Key ({examQuestions?.manual?.length || 0})</h4>
                <div className="questions-list">
                  {examQuestions?.manual && examQuestions.manual.length > 0 ? (
                    examQuestions.manual.map((a, idx) => a ? (
                      <div key={a.id || `manual-${idx}`} className="question-item">
                        <p><strong>{idx + 1}. {a.question_text || `Question ${idx + 1}`}</strong></p>
                        <p className="ans-text" style={{ color: '#059669', fontWeight: 'bold' }}>Answer: {a.correct_answer || 'N/A'}</p>
                      </div>
                    ) : null)
                  ) : (
                    <p>No manual answers defined.</p>
                  )}
                </div>
              </div>

              <div className="details-section" style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 10px 0' }}>OCR Answer Key Extraction</h4>
                <div className="upload-row" onClick={() => answerKeyInputRef.current && answerKeyInputRef.current.click()} style={{ marginBottom: '10px' }}>
                  <span className="upload-placeholder">
                    {answerKeyImage?.name ? answerKeyImage.name : 'Upload Official Answer Key PDF/Image'}
                  </span>
                  <input
                    type="file"
                    ref={answerKeyInputRef}
                    style={{ display: 'none' }}
                    accept=".jpg,.jpeg,.png,.pdf"
                    onChange={handleAnswerKeyImageChange}
                  />
                  <button className="browse-btn exam-browse">Browse</button>
                </div>
                
                <button 
                  className="save-assign-btn" 
                  onClick={() => handleProcessOCR(showExamDetails.id)}
                  disabled={isProcessingOCR || !answerKeyImage}
                  style={{ width: '100%', marginBottom: '10px' }}
                >
                  {isProcessingOCR ? 'Scanning Document...' : 'Extract Answers via OCR'}
                </button>

                {parsedOCRData && parsedOCRData.length > 0 && (
                  <div style={{ marginTop: '15px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '15px' }}>
                    <h5 style={{ margin: '0 0 10px 0', color: '#334155' }}>Preview: {parsedOCRData.length} Answers Detected</h5>
                    <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '15px', padding: '10px', background: '#f1f5f9', borderRadius: '6px' }}>
                      {parsedOCRData.map((item, i) => item ? (
                        <div key={`parsed-${i}`} style={{ marginBottom: '8px', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#475569' }}>{item?.questionText ? item.questionText.substring(0, 30) : 'Question'}...</span>
                          <strong style={{ color: '#16a34a' }}>{item?.correctAnswer || '?'}</strong>
                        </div>
                      ) : null)}
                    </div>
                    
                    <button
                      onClick={handleSaveOCRToDatabase}
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        background: '#2563eb',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '600',
                        boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)'
                      }}
                    >
                      Save to Database
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