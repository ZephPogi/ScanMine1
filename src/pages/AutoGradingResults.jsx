import imageCompression from 'browser-image-compression';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Camera, Eye, Trash2, Edit, X, CheckCircle, Clock, FileText } from 'lucide-react';
import './AutoGradingResults.css';
import Sidebar from './Sidebar';

const AutoGradingResults = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  // Try to get section from location state, fallback to localStorage
  const [section] = useState(() => {
    if (location.state?.section) {
      localStorage.setItem('currentSection', JSON.stringify(location.state.section));
      return location.state.section;
    }
    const saved = localStorage.getItem('currentSection');
    return saved ? JSON.parse(saved) : null;
  });

  const [showScanModal, setShowScanModal] = useState(() => !!location.state?.openScanModal);
  
  // Selection state
  const [selectedStudentId, setSelectedStudentId] = useState(() => location.state?.studentId ? String(location.state.studentId) : '');
  const [selectedExamId, setSelectedExamId] = useState(() => location.state?.examId ? String(location.state.examId) : '');
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);

  const [scannedPages, setScannedPages] = useState([]);
  const [scanError, setScanError] = useState('');
  const scanFileRef = useRef(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [manualAnswers, setManualAnswers] = useState('');
  const [inputMode, setInputMode] = useState('scan'); // 'scan' or 'manual'
  const [showFeedback, setShowFeedback] = useState(null); // stores feedback string
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [studentResults, setStudentResults] = useState([]);

  const fetchSubmissions = useCallback(async () => {
    try {
      const response = await fetch(`/api/submissions/${section.id}`);
      if (response.ok) {
        const data = await response.json();
        const formatted = data.map(sub => ({
          id: sub.id,
          name: sub.student_name,
          is_verified: sub.is_verified,
          exam: sub.exam_title,
          method: 'AI Grading',
          score: sub.points_earned !== null ? `${sub.points_earned} / ${sub.total_items}` : `${Math.round(sub.score)}%`,
          status: sub.score >= 50 ? 'Pass' : 'Fail',
          feedback: sub.feedback || '',
          image_url: sub.image_url
        }));
        setStudentResults(formatted);
      }
    } catch (error) {
      console.error('Error fetching submissions:', error);
    }
  }, [section?.id]);

const fetchStudents = useCallback(async () => {
  try {
    const response = await fetch(`/api/classes/${section.id}/students`);
    if (response.ok) {
      const data = await response.json();
      // Force the student ID to be the user_id (6 or 7)
      const mapped = data.map(s => ({
        ...s,
        id: s.user_id 
      }));
      setStudents(Array.isArray(mapped) ? mapped : []);
    }
  } catch (error) {
    console.error('Error fetching students:', error);
  }
}, [section?.id]);

  const fetchExams = useCallback(async () => {
    try {
      const response = await fetch(`/api/exams?classId=${section.id}`);
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
      fetchSubmissions();
    }
  }, [section?.id, fetchStudents, fetchExams, fetchSubmissions]);

  if (!section) {
    return (
      <div className="grading-container">
        <div className="no-section-error">
          <h2>No Section Selected</h2>
          <button onClick={() => navigate('/teacher')}>Go Back to Dashboard</button>
        </div>
      </div>
    );
  }

  const handleDeleteSubmission = async (submissionId) => {
    if (!window.confirm('Are you sure you want to delete this submission?')) return;
    try {
      const res = await fetch(`/api/submissions/${submissionId}`, { method: 'DELETE' });
      if (res.ok) {
        setStudentResults(prev => prev.filter(item => item.id !== submissionId));
      }
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const startCamera = async () => {
    if (scannedPages.length >= 3) return;
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Could not access camera. Please check permissions.");
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const page = new File([blob], `scanned_page_${scannedPages.length + 1}.jpg`, { type: 'image/jpeg' });
          addScannedPage(page);
        }
        stopCamera();
      }, 'image/jpeg');
    }
  };

const handleScanRecord = async () => {
    if (!selectedStudentId || !selectedExamId) {
      alert('Please select a student and an exam first.');
      return;
    }
    
    if (scannedPages.length === 0) {
      alert('Please capture a photo or upload an image.');
      return;
    }

    setScanError('');
    setIsScanning(true);
    try {
      const compressionOptions = {
        maxSizeMB: 4.5, // Safely under OCR.space's 5MB limit
        maxWidthOrHeight: 1920, // Keeps enough resolution for Engine 3 to read handwriting
        useWebWorker: true // Keeps the UI from freezing while compressing
      };

      const compressedPages = [];
      for (const page of scannedPages) {
        try {
          compressedPages.push(await imageCompression(page.file, compressionOptions));
        } catch (compressionError) {
          console.error("Compression failed:", compressionError);
          throw new Error(`Failed to compress page ${compressedPages.length + 1} before uploading.`);
        }
      }

      const formData = new FormData();
      formData.append('studentId', selectedStudentId);
      formData.append('examId', selectedExamId);
      formData.append('role', location.state?.role || currentUser.role || '');
      formData.append('studentName', location.state?.studentName || currentUser.name || currentUser.fullName || '');
      
      compressedPages.forEach((page, index) => {
        formData.append('pages', page, page.name || `scanned_page_${index + 1}.jpg`);
      });

      const response = await fetch('/api/upload-paper', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.message || data.error || 'Failed to grade paper');
        error.code = data.code;
        throw error;
      }

      // Optimistic UI Update
      const studentName = students.find(s => s.id === parseInt(selectedStudentId))?.name || 'Student';
      const examTitle = exams.find(e => e.id === parseInt(selectedExamId))?.title || 'Exam';

      const totalScore = data.result.totalScore || 0;
      const maxScore = data.result.maxScore || 1;
      const percentage = ((totalScore / maxScore) * 100).toFixed(0);

      const newResult = {
        id: data.result.submission_id || Date.now(),
        name: studentName,
        exam: examTitle,
        method: 'AI Grading',
        score: `${totalScore} / ${maxScore}`,
        status: percentage >= 50 ? 'Pass' : 'Fail',
        feedback: data.result.feedback || '',
        is_verified: data.result.is_verified !== false,
        image_url: data.result.image_url
      };

      setStudentResults(prev => [newResult, ...prev.filter(r => !(r.name === studentName && r.exam === examTitle))]);

      alert("Score recorded successfully!");
      
      closeScanModal();
      /*
      if (typeof fetchSubmissions === 'function') {
        await fetchSubmissions(selectedExamId); 
      }
      */
    } catch (error) {
      console.error("Error grading:", error);
      if (error.code === 'NAME_MISMATCH') {
        setScanError('❌ Name Mismatch: You can only scan your own paper.');
      } else {
        alert("Error during scanning: " + error.message);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleManualGrade = async () => {
    if (!selectedStudentId || !selectedExamId) {
      alert('Please select a student and an exam first.');
      return;
    }
    if (!manualAnswers.trim()) {
      alert('Please enter the student answers.');
      return;
    }
    setIsScanning(true);
    try {
      const response = await fetch('/api/grade-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: selectedStudentId,
          examId: selectedExamId,
          answers: manualAnswers
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to grade');
      
      const studentName = students.find(s => s.id === parseInt(selectedStudentId))?.name || 'Student';
      const examTitle = exams.find(e => e.id === parseInt(selectedExamId))?.title || 'Exam';
      const percentage = data.result.maxScore > 0
        ? ((data.result.totalScore / data.result.maxScore) * 100).toFixed(0)
        : 0;

      setStudentResults(prev => [{
        id: data.result.submission_id || Date.now(),
        name: studentName, exam: examTitle,
        score: `${data.result.totalScore} / ${data.result.maxScore}`,
        status: percentage >= 50 ? 'Pass' : 'Fail',
        feedback: data.result.feedback || '',
        is_verified: true,
        image_url: null
      }, ...prev.filter(r => !(r.name === studentName && r.exam === examTitle))]);
      
      setShowScanModal(false);
      setManualAnswers('');
      fetchSubmissions();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setIsScanning(false);
    }
  };

  const closeScanModal = () => {
    setShowScanModal(false);
    scannedPages.forEach(page => URL.revokeObjectURL(page.previewUrl));
    setScannedPages([]);
    setScanError('');
    stopCamera();
  };

  const addScannedPage = (file) => {
    if (!file) return;
    if (scannedPages.length >= 3) {
      setScanError('You can scan up to 3 pages per paper.');
      return;
    }
    setScanError('');
    setScannedPages([...scannedPages, { file, previewUrl: URL.createObjectURL(file) }]);
  };

  const removeScannedPage = (index) => {
    const page = scannedPages[index];
    if (page) URL.revokeObjectURL(page.previewUrl);
    setScannedPages(pages => pages.filter((_, pageIndex) => pageIndex !== index));
  };

  return (
    <div className="page-layout">
      <Sidebar />
      <div className="grading-container">
        <header className="grading-header">
          <div>
            <h1>Auto-Grading Results</h1>
            <p className="grading-subtitle">{section?.name} • Class Results</p>
          </div>
          <button className="grading-edit-btn" onClick={() => navigate('/section-details')}>
            <Edit size={18} />
          </button>
        </header>

        <section className="results-section">
          <h3 className="results-title">Student Results</h3>
          <div className="table-responsive-wrapper">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Exam</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {studentResults.map((s) => (
                  <tr key={s.id}>
                    <td className="student-name-cell">
                      <span>{s.name}</span>
                      {s.is_verified !== false && (
                        <span className="verified-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <svg className="w-3 h-3 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                          Verified
                        </span>
                      )}
                    </td>
                    <td>{s.exam}</td>
                    <td className="score-cell">{s.score}</td>
                    <td>
                      <span className={`status-badge ${s.status.toLowerCase()}`}>
                        {s.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="view-feedback-btn"
                        onClick={() => setShowFeedback(s)}
                        title="View answer breakdown"
                      >
                        <Eye size={16} />
                        <span>View</span>
                      </button>
                      <button
                        className="delete-sub-btn"
                        onClick={() => handleDeleteSubmission(s.id)}
                        title="Delete this result"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {studentResults.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{textAlign: 'center', padding: '20px'}}>No results scanned yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grading-footer">
          <div className="action-buttons">
            <button className="scan-btn" onClick={() => setShowScanModal(true)}>
              <Camera size={18} />
              <span>Start Scanning</span>
            </button>
          </div>
        </div>
      </div>

      {/* FEEDBACK MODAL */}
      {showFeedback && (
        <div className="scan-modal-overlay" onClick={() => setShowFeedback(null)}>
          <div className="scan-modal-content" style={{maxHeight: '80vh', overflowY: 'auto'}} onClick={e => e.stopPropagation()}>
            <div className="scan-title-banner feedback-title-banner">
              <FileText size={20} />
              <span>{showFeedback.name} — {showFeedback.exam}</span>
              <button className="scan-close-btn" onClick={() => setShowFeedback(null)}><X size={20} /></button>
            </div>
            <div className="feedback-modal-body">
              {showFeedback?.image_url && (
                <img 
                  src={showFeedback.image_url} 
                  alt="Student Scan" 
                  className="proof-image"
                />
              )}
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'16px'}}>
                <span style={{fontSize:'1.5rem', fontWeight:'800'}}>{showFeedback.score}</span>
                <span className={`status-badge ${showFeedback.status.toLowerCase()}`}>{showFeedback.status}</span>
              </div>
              {showFeedback.feedback ? showFeedback.feedback.split('\n').filter(Boolean).map((line, i) => {
                const isWrong = line.includes('Wrong') || line.includes('❌');
                const displayLine = line
                  .split('|')[0]
                  .trim()
                  .replace(/:\s*Student answered\s+/i, ': ')
                  .replace(/^(\s*Q\d+:\s*)"([^"]+)"$/, '$1$2');
                
                return (
                  <div key={i} className={`feedback-row ${isWrong ? 'wrong' : 'correct'}`}>
                    {displayLine}
                  </div>
                );
              }) : <p style={{color:'#94a3b8'}}>No detailed feedback. Re-scan this student to generate feedback.</p>}
            </div>
          </div>
        </div>
      )}

      {showScanModal && (
        <div className="scan-modal-overlay" onClick={closeScanModal}>
          <div className="scan-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="scan-title-banner">
              <Camera size={20} />
              <span>Scan Student Paper</span>
              <button className="scan-close-btn" onClick={closeScanModal}><X size={20} /></button>
            </div>

            {scanError && (
              <div role="alert" style={{ margin: '12px 20px', padding: '12px 14px', border: '1px solid #fecaca', borderRadius: '6px', background: '#fef2f2', color: '#b91c1c', fontSize: '14px', fontWeight: '600' }}>
                {scanError}
              </div>
            )}

            <div className="scan-step">
              <h4 className="scan-step-title">Step 1: Select Student</h4>
              <select 
                className="scan-search-input" 
                value={selectedStudentId} 
                onChange={(e) => setSelectedStudentId(e.target.value)}
              >
                <option value="">-- Select Student --</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                ))}
              </select>
            </div>

            <div className="scan-step">
              <h4 className="scan-step-title">Step 2: Select Exam</h4>
              <select 
                className="scan-search-input" 
                value={selectedExamId} 
                onChange={(e) => setSelectedExamId(e.target.value)}
              >
                <option value="">-- Select Exam --</option>
                {exams.map(e => (
                  <option key={e.id} value={e.id}>{e.title}</option>
                ))}
              </select>
            </div>

            <div className="scan-step">
              <h4 className="scan-step-title">Step 3: Enter Answers</h4>

              {/* Mode Toggle */}
              <div className="mode-toggle">
                <button className={`mode-btn ${inputMode === 'scan' ? 'active' : ''}`} onClick={() => setInputMode('scan')}>
                  <Camera size={16} />
                  <span>Scan Photo</span>
                </button>
                <button className={`mode-btn ${inputMode === 'manual' ? 'active' : ''}`} onClick={() => setInputMode('manual')}>
                  <Edit size={16} />
                  <span>Type Manually</span>
                </button>
              </div>

              {inputMode === 'manual' && (
                <div className="manual-grade-area">
                  <p className="manual-hint-text">
                    Type each answer separated by commas. Works for letters <strong>AND</strong> words.<br/>
                    Example: <strong>C, B, Paris, Oxygen, Pacific Ocean</strong>
                  </p>
                  <input
                    type="text"
                    className="scan-search-input"
                    placeholder="e.g. C, B, A, D or Paris, Oxygen, 7..."
                    value={manualAnswers}
                    onChange={(e) => setManualAnswers(e.target.value)}
                    style={{marginBottom: '12px'}}
                  />
                  <button
                    className="scan-record-btn"
                    style={{width: '100%'}}
                    onClick={handleManualGrade}
                    disabled={isScanning}
                  >
                    {isScanning ? <><Clock size={16} /><span>Grading...</span></> : <><CheckCircle size={16} /><span>Grade Now</span></>}
                  </button>
                </div>
              )}

              {inputMode === 'scan' && (
                <>
                  {scannedPages.length > 0 && (
                    <div className="scan-pages-strip" aria-label="Captured paper pages">
                      {scannedPages.map((page, index) => (
                        <div className="scan-page-thumbnail" key={`${page.file.name}-${index}`}>
                          <img src={page.previewUrl} alt={`Page ${index + 1}`} />
                          <span>{`Page ${index + 1} - ${index === 0 ? 'Front' : index === 1 ? 'Back' : `Page ${index + 1}`}`}</span>
                          <button
                            type="button"
                            className="scan-page-remove"
                            onClick={() => removeScannedPage(index)}
                            aria-label={`Delete page ${index + 1}`}
                            disabled={isScanning}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {!isCameraOpen && scannedPages.length < 3 && (
                    <div className="scan-capture-options">
                      <button
                        className="scan-record-btn"
                        style={{marginBottom: '10px', width: '100%'}}
                        onClick={startCamera}
                        disabled={isScanning}
                      >
                        <Camera size={18} />
                        <span>{scannedPages.length ? '➕ Add Another Page / Back Side' : 'Open Camera'}</span>
                      </button>
                      <input
                        type="file"
                        ref={scanFileRef}
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          addScannedPage(e.target.files[0]);
                          e.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        className="browse-btn"
                        style={{width: '100%'}}
                        onClick={() => scanFileRef.current?.click()}
                        disabled={isScanning}
                      >
                        <span>{scannedPages.length ? 'Upload Another Page' : 'Or Upload Image'}</span>
                      </button>
                    </div>
                  )}

                  {isCameraOpen && (
                    <div className="camera-container" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'}}>
                      <video ref={videoRef} autoPlay playsInline style={{width: '100%', maxHeight: '250px', backgroundColor: '#000', borderRadius: '8px'}} />
                      <canvas ref={canvasRef} style={{display: 'none'}} />
                      <div style={{display: 'flex', gap: '10px', width: '100%'}}>
                        <button className="scan-record-btn" style={{flex: 1}} onClick={capturePhoto}>
                          <Camera size={18} />
                          <span>Capture</span>
                        </button>
                        <button className="browse-btn" style={{flex: 1}} onClick={stopCamera}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {scannedPages.length === 3 && (
                    <p className="scan-page-limit">Maximum of 3 pages reached.</p>
                  )}
                </>
              )}
            </div>

            {inputMode === 'scan' && (
              <div className="scan-modal-footer">
                <button
                  className="scan-record-btn"
                  onClick={handleScanRecord}
                  disabled={isScanning || !selectedStudentId || !selectedExamId || scannedPages.length === 0}
                  style={{ opacity: (isScanning || !selectedStudentId || !selectedExamId || scannedPages.length === 0) ? 0.6 : 1 }}
                >
                  {isScanning
                    ? <><Clock size={16} /><span>Scanning...</span></>
                    : <><CheckCircle size={16} /><span>Grade Exam ({scannedPages.length} {scannedPages.length === 1 ? 'Page' : 'Pages'})</span></>}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AutoGradingResults;
