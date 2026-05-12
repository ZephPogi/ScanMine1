/* eslint-disable */
import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Search, UserPlus, UserMinus, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import './SectionDetails.css';
import Sidebar from './Sidebar';

// --- THE SMART PARSER ---
const parseScanMineText = (rawText) => {
  if (!rawText) return [];
  let currentCandidate = null;
  const parsedQuestions = [];
  const lines = rawText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip Multiple Choice options and Headers
    if (line.match(/^[A-D]\)/) || line.startsWith('PART') || line.startsWith('Note:')) {
      continue;
    }

    // The Anchor Split: Hunt for the Number + Dot anywhere in the line
    const anchorMatch = line.match(/(\d+)\s*\.\s*(.*)/);

    if (anchorMatch) {
      const questionNum = parseInt(anchorMatch[1], 10);
      const questionText = anchorMatch[2].trim();
      const leftSideText = line.substring(0, anchorMatch.index).trim();

      parsedQuestions.push({
        questionText: questionText,
        correctAnswer: leftSideText ? leftSideText : (currentCandidate || "?")
      });

      currentCandidate = null;
      continue;
    }
    currentCandidate = line;
  }
  return parsedQuestions;
};

const SectionDetails = ({ section, onBack }) => {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
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

  const [showQuizGeneratorModal, setShowQuizGeneratorModal] = useState(false);
  const [quizLessonFile, setQuizLessonFile] = useState(null);
  const [numberOfQuestions, setNumberOfQuestions] = useState(10);
  const [generatedQuestions, setGeneratedQuestions] = useState([]);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [examSubmissions, setExamSubmissions] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentSubmissions, setStudentSubmissions] = useState([]);

  // ── Invite search state ────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  const examInputRef = useRef(null);
  const answerKeyInputRef = useRef(null);
  const quizFileRef = useRef(null);

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
    setExamSubmissions([]);
    try {
      // Fetch questions
      const qRes = await fetch(`/api/exams/${exam.id}/questions`);
      if (qRes.ok) {
        const qData = await qRes.json();
        setExamQuestions(qData || { manual: [], generated: [] });
      }

      // Fetch submissions for this exam
      const subRes = await fetch(`/api/exams/${exam.id}/submissions`);
      if (subRes.ok) {
        const subData = await subRes.json();
        setExamSubmissions(subData || []);
      }
    } catch (error) {
      console.error('Error fetching exam details:', error);
    }
  };

  const handleViewStudent = async (student) => {
    if (!student) return;
    setSelectedStudent(student);
    setStudentSubmissions([]);
    try {
      const response = await fetch(`/api/student/${student.user_id}/grades/${section.id}`);
      if (response.ok) {
        const data = await response.json();
        setStudentSubmissions(data || []);
      }
    } catch (error) {
      console.error('Error fetching student grades:', error);
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

  const handleSearchStudents = useCallback(async (query) => {
    if (query.trim().length < 2) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/students/search?q=${encodeURIComponent(query.trim())}&classId=${section?.id}`);
      if (res.ok) setSearchResults(await res.json());
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, [section?.id]);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => handleSearchStudents(val), 300);
  };

  const handleInviteStudent = async (student) => {
    try {
      const res = await fetch('/api/class/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: section.id, userId: student.id }),
      });
      if (res.ok) {
        setSearchQuery('');
        setSearchResults([]);
        fetchStudents();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to send invite');
      }
    } catch (err) {
      console.error('Invite error:', err);
    }
  };

  const handleKickStudent = async (student) => {
    if (!window.confirm(`Remove ${student.name} from this class?`)) return;
    try {
      const res = await fetch(`/api/class/decline-invite?classId=${section.id}&userId=${student.user_id}`, { method: 'DELETE' });
      if (res.ok) fetchStudents();
      else { const err = await res.json(); alert(err.error || 'Failed to remove student'); }
    } catch (err) {
      console.error('Kick error:', err);
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
      // Upload file to storage first to get the URL
      let pdfUrl = null;
      if (answerKeyImage) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', answerKeyImage);
        uploadFormData.append('examId', showExamDetails.id);

        const uploadResponse = await fetch('/api/upload-answer-key-file', {
          method: 'POST',
          body: uploadFormData
        });

        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          pdfUrl = uploadData.publicUrl;
        }
      }

      const response = await fetch('/api/upload-answer-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examId: showExamDetails.id,
          // CHANGE: Send the structured array directly!
          answers: parsedOCRData,
          pdfUrl: pdfUrl
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
        setAnswerKeyImage(null); // Clear file after successful save
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

  const handleQuizFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setQuizLessonFile(e.target.files[0]);
  };

  const handleGenerateQuiz = async () => {
    if (!quizLessonFile) return alert('Please select a lesson PDF file first');
    if (!examTitle) return alert('Please enter an exam title');

    setIsGeneratingQuiz(true);
    try {
      const formData = new FormData();
      formData.append('lessonFile', quizLessonFile);
      formData.append('teacherId', user?.id || '');
      formData.append('classId', section?.id || '');
      formData.append('title', examTitle);
      formData.append('numberOfQuestions', numberOfQuestions);

      const response = await fetch('/api/generate-quiz', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (response.ok && data?.questions) {
        setGeneratedQuestions(data.questions);
        alert('Quiz generated successfully!');
      } else {
        alert('Quiz generation failed: ' + (data?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Quiz generation error:', error);
      alert('Error generating quiz: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const handleDownloadAnswerKey = () => {
    if (generatedQuestions.length === 0) return alert('No questions to download');

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('ScanMine Answer Key', 105, 20, { align: 'center' });
    doc.setFontSize(12);

    let yPosition = 40;
    generatedQuestions.forEach((q, index) => {
      const line = `${q.answer_text.padEnd(15)} ${index + 1}. ${q.question_text}`;
      doc.text(line, 20, yPosition);
      yPosition += 10;

      if (yPosition > 280) {
        doc.addPage();
        yPosition = 20;
      }
    });

    doc.save('ScanMine-Answer-Key.pdf');
  };
  
  const handleExportExcel = () => {
    if (!showExamDetails || !students.length) return;

    const gradedStudents = students.filter(s => 
      s.status === 'enrolled' && 
      examSubmissions.some(sub => sub.student_id === s.user_id)
    );
    
    const pendingStudents = students.filter(s => 
      s.status === 'enrolled' && 
      !examSubmissions.some(sub => sub.student_id === s.user_id)
    );

    const excelData = [
      ...gradedStudents.map(s => {
        const sub = examSubmissions.find(sub => sub.student_id === s.user_id);
        return {
          'Subject': section.subject,
          'Section': section.name,
          'Exam Name': showExamDetails.title,
          'Student Name': s.name,
          'Status': 'Graded',
          'Points Earned': sub?.points_earned ?? 0,
          'Total Points': sub?.total_items ?? 0,
          'Formatted Score': `'${sub?.points_earned ?? 0}/${sub?.total_items ?? 0}`
        };
      }),
      ...pendingStudents.map(s => ({
        'Subject': section.subject,
        'Section': section.name,
        'Exam Name': showExamDetails.title,
        'Student Name': s.name,
        'Status': 'Pending',
        'Points Earned': 0,
        'Total Points': 0,
        'Formatted Score': 'Pending'
      }))
    ];

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Grades");
    
    // Auto-size columns (rough approximation)
    const maxWidths = excelData.reduce((acc, row) => {
      Object.keys(row).forEach((key, i) => {
        const val = String(row[key]);
        acc[i] = Math.max(acc[i] || 10, val.length, key.length);
      });
      return acc;
    }, []);
    worksheet['!cols'] = maxWidths.map(w => ({ wch: w + 2 }));

    XLSX.writeFile(workbook, `${section.name}_${showExamDetails.title}_Grades.xlsx`);
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
              <h3>Student Roster
                <span className="roster-count">{students.length}</span>
              </h3>
            </div>

            {/* ── Inline Search / Invite Bar ── */}
            <div className="invite-search-wrapper">
              <div className="invite-search-bar">
                <Search size={16} className="search-icon" />
                <input
                  type="text"
                  className="invite-search-input"
                  placeholder="Search students by name or email to invite…"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  autoComplete="off"
                />
                {searchQuery && (
                  <button className="search-clear-btn" onClick={() => { setSearchQuery(''); setSearchResults([]); }}>×</button>
                )}
              </div>
              {(searchResults.length > 0 || (isSearching && searchQuery.length >= 2)) && (
                <div className="search-results-dropdown">
                  {isSearching ? (
                    <div className="search-result-loading">Searching…</div>
                  ) : searchResults.length === 0 ? (
                    <div className="search-result-empty">No students found</div>
                  ) : (
                    searchResults.map(s => (
                      <div key={s.id} className="search-result-item">
                        <div className="search-result-info">
                          <span className="search-result-name">{s.name}</span>
                          <span className="search-result-email">{s.email}</span>
                        </div>
                        <button className="invite-btn" onClick={() => handleInviteStudent(s)}>
                          <UserPlus size={14} />
                          Invite
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="table-responsive-wrapper">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {students && students.length > 0 ? (
                    students.map((s, idx) => s ? (
                      <tr 
                        key={s.user_id || `student-${idx}`} 
                        onClick={() => handleViewStudent(s)}
                        style={{ cursor: 'pointer' }}
                        className="roster-row-hover"
                      >
                        <td className="student-name">{s.name || 'Unknown'}</td>
                        <td>{s.email || 'N/A'}</td>
                        <td>
                          <span className={`status-badge ${s.status === 'enrolled' ? 'badge-enrolled' : 'badge-pending'}`}>
                            {s.status === 'enrolled' ? 'Enrolled' : 'Pending'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="kick-btn"
                            title="Remove student"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleKickStudent(s);
                            }}
                          >
                            <UserMinus size={15} />
                          </button>
                        </td>
                      </tr>
                    ) : null)
                  ) : (
                    <tr><td colSpan="4" style={{textAlign:'center', color:'#94a3b8', padding:'20px'}}>No students yet. Use the search bar above to invite them.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="actions-sidebar">
            <div className="action-card exam-management">
              <h4>Exam Management</h4>
              <button className="btn-action primary" onClick={() => setShowAttachModal(true)}>
                Attach Exam & Key
              </button>
              <button className="btn-action success" onClick={() => setShowQuizGeneratorModal(true)}>
                Generate Quiz
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
      
      {/* Old Add-Student modal removed — replaced by inline search */}

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
          <div className="modal-content details-modal" style={{ pointerEvents: 'auto', maxHeight: '90vh', overflowY: 'auto', width: '95%', maxWidth: '1000px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Exam Details: {showExamDetails?.title || 'Untitled'}</h2>
              <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                {showExamDetails?.file_path && (
                  <button
                    className="btn-action success"
                    onClick={() => window.open(showExamDetails.file_path, '_blank')}
                    style={{ padding: '8px 16px', fontSize: '13px', whiteSpace: 'nowrap' }}
                  >
                    📄 View Answer Key Document
                  </button>
                )}
                <button className="close-btn" onClick={() => setShowExamDetails(null)}>×</button>
              </div>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', gap: '24px', padding: '20px' }}>
              {/* Left Column: Answer Keys & OCR */}
              <div style={{ flex: '1.2' }}>
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

              {/* Right Column: Student Progress */}
              <div style={{ flex: '1', background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#1e293b' }}>Student Progress</h3>
                  <button 
                    onClick={handleExportExcel}
                    className="btn-action success"
                    style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Download size={14} />
                    Export to Excel
                  </button>
                </div>
                
                <div style={{ marginBottom: '25px', flex: 1, overflowY: 'auto' }}>
                  <h5 style={{ color: '#059669', marginBottom: '10px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Graded ({students.filter(s => examSubmissions.some(sub => sub.student_id === s.user_id)).length})
                  </h5>
                  <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                    {students
                      .filter(s => s.status === 'enrolled')
                      .map(s => {
                        const sub = examSubmissions.find(sub => sub.student_id === s.user_id);
                        if (!sub) return null;
                        return (
                          <div key={s.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '14px', color: '#334155', fontWeight: '500' }}>{s.name}</span>
                            <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                              {sub.points_earned ?? sub.score ?? 0} / {sub.total_items ?? '?'}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>

                <div>
                  <h5 style={{ color: '#64748b', marginBottom: '10px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Pending ({students.filter(s => s.status === 'enrolled' && !examSubmissions.some(sub => sub.student_id === s.user_id)).length})
                  </h5>
                  <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                    {students
                      .filter(s => s.status === 'enrolled' && !examSubmissions.some(sub => sub.student_id === s.user_id))
                      .map(s => (
                        <div key={s.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                          <span style={{ fontSize: '14px', color: '#64748b' }}>{s.name}</span>
                          <span style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Not Submitted</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedStudent && (
        <div className="modal-overlay" onClick={() => setSelectedStudent(null)}>
          <div className="modal-content" style={{ maxWidth: '600px', width: '90%', pointerEvents: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '15px', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, color: '#1e293b' }}>Student Details: {selectedStudent.name}</h2>
              <button className="close-btn" onClick={() => setSelectedStudent(null)}>×</button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <h4 style={{ color: '#059669', marginBottom: '12px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Completed Assessments ({studentSubmissions.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {studentSubmissions.length > 0 ? (
                    studentSubmissions.map(sub => (
                      <div key={sub.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <span style={{ fontWeight: '600', color: '#334155' }}>{sub.exam_title}</span>
                        <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: '700' }}>
                          {sub.points_earned ?? sub.score ?? 0} / {sub.total_items ?? sub.total_questions ?? '?'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p style={{ color: '#94a3b8', fontSize: '14px', fontStyle: 'italic' }}>No completed assessments found.</p>
                  )}
                </div>
              </div>

              <div>
                <h4 style={{ color: '#64748b', marginBottom: '12px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Pending Assessments ({exams.filter(e => !studentSubmissions.some(sub => sub.exam_title === e.title)).length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {exams
                    .filter(e => !studentSubmissions.some(sub => sub.exam_title === e.title))
                    .map(e => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                        <span style={{ color: '#64748b' }}>{e.title}</span>
                        <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>Pending</span>
                      </div>
                    ))}
                  {exams.filter(e => !studentSubmissions.some(sub => sub.exam_title === e.title)).length === 0 && (
                    <p style={{ color: '#94a3b8', fontSize: '14px', fontStyle: 'italic' }}>All assigned assessments are complete.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showQuizGeneratorModal && (
        <div className="modal-overlay" onClick={() => setShowQuizGeneratorModal(false)}>
          <div className="modal-content attach-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <span className="modal-prof-label">ScanMine Professor Console</span>
              <button className="modal-close-btn" onClick={() => setShowQuizGeneratorModal(false)}>×</button>
            </div>

            <div className="modal-title-banner">Generate Quiz from Lesson</div>

            <div className="upload-section">
              <label className="upload-label">Exam Title</label>
              <input
                type="text"
                className="create-input"
                placeholder="e.g. Science Chapter 5 Quiz"
                value={examTitle}
                onChange={(e) => setExamTitle(e.target.value)}
              />
            </div>

            <div className="upload-section">
              <label className="upload-label">📄 Lesson PDF File</label>
              <div className="upload-row" onClick={() => quizFileRef.current && quizFileRef.current.click()}>
                <span className="upload-placeholder">
                  {quizLessonFile?.name ? quizLessonFile.name : 'Upload Lesson PDF'}
                </span>
                <input
                  type="file"
                  ref={quizFileRef}
                  style={{ display: 'none' }}
                  accept=".pdf"
                  onChange={handleQuizFileChange}
                />
                <button className="browse-btn exam-browse">Browse</button>
              </div>
            </div>

            <div className="upload-section">
              <label className="upload-label">Number of Questions</label>
              <input
                type="number"
                className="create-input"
                placeholder="10"
                value={numberOfQuestions}
                onChange={(e) => setNumberOfQuestions(parseInt(e.target.value) || 10)}
                min="1"
                max="50"
              />
            </div>

            <div className="modal-footer">
              <button
                className="save-assign-btn"
                onClick={handleGenerateQuiz}
                disabled={isGeneratingQuiz}
              >
                {isGeneratingQuiz ? 'Generating...' : 'Generate Quiz'}
              </button>
            </div>

            {generatedQuestions.length > 0 && (
              <div style={{ marginTop: '20px', background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 15px 0' }}>Generated Questions Preview ({generatedQuestions.length})</h4>
                <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '15px' }}>
                  {generatedQuestions.map((q, index) => (
                    <div key={index} style={{ marginBottom: '10px', padding: '10px', background: '#ffffff', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                      <p style={{ margin: '0 0 5px 0', fontWeight: 'bold', color: '#16a34a' }}>
                        Answer: {q.answer_text}
                      </p>
                      <p style={{ margin: 0, color: '#475569' }}>
                        {index + 1}. {q.question_text}
                      </p>
                    </div>
                  ))}
                </div>
                <button
                  className="save-assign-btn"
                  onClick={handleDownloadAnswerKey}
                  style={{ background: '#059669' }}
                >
                  Download ScanMine Answer Key
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SectionDetails;