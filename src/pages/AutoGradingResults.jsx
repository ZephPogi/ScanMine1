import imageCompression from 'browser-image-compression';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Camera, Eye, Trash2, Edit, X, CheckCircle, Clock, FileText } from 'lucide-react';
import './AutoGradingResults.css';
import Sidebar from './Sidebar';

const AutoGradingResults = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Try to get section from location state, fallback to localStorage
  const [section] = useState(() => {
    if (location.state?.section) {
      localStorage.setItem('currentSection', JSON.stringify(location.state.section));
      return location.state.section;
    }
    const saved = localStorage.getItem('currentSection');
    return saved ? JSON.parse(saved) : null;
  });

  const [showScanModal, setShowScanModal] = useState(false);
  
  // Selection state
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedExamId, setSelectedExamId] = useState('');
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);

  const [scanFile, setScanFile] = useState(null);
  const scanFileRef = useRef(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [manualAnswers, setManualAnswers] = useState('');
  const [inputMode, setInputMode] = useState('scan'); // 'scan' or 'manual'
  const [showFeedback, setShowFeedback] = useState(null); // stores feedback string
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [capturedImage, setCapturedImage] = useState(null);

  const [studentResults, setStudentResults] = useState([]);

  const fetchSubmissions = useCallback(async () => {
    try {
      const response = await fetch(`/api/submissions/${section.id}`);
      if (response.ok) {
        const data = await response.json();
        const formatted = data.map(sub => ({
          id: sub.id,
          name: sub.student_name,
          exam: sub.exam_title,
          submittedBy: 'System',
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
    setIsCameraOpen(true);
    setScanFile(null);
    setCapturedImage(null);
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
        setCapturedImage(blob);
        stopCamera();
      }, 'image/jpeg');
    }
  };

const handleScanRecord = async () => {
    if (!selectedStudentId || !selectedExamId) {
      alert('Please select a student and an exam first.');
      return;
    }
    
    // Get whichever file the user provided
    let imageToUpload = scanFile;

    // THE FIX: If using the webcam, convert the raw Blob into a true File object
    if (capturedImage) {
      imageToUpload = new File([capturedImage], 'captured_paper.jpg', { type: 'image/jpeg' });
    }
    
    if (!imageToUpload) {
      alert('Please capture a photo or upload an image.');
      return;
    }

    setIsScanning(true);
    try {
      // --- AUTOMATIC COMPRESSION LOGIC START ---
      console.log(`Original file size: ${(imageToUpload.size / 1024 / 1024).toFixed(2)} MB`);
      
      const compressionOptions = {
        maxSizeMB: 4.5, // Safely under OCR.space's 5MB limit
        maxWidthOrHeight: 1920, // Keeps enough resolution for Engine 3 to read handwriting
        useWebWorker: true // Keeps the UI from freezing while compressing
      };

      try {
        imageToUpload = await imageCompression(imageToUpload, compressionOptions);
        console.log(`Compressed file size: ${(imageToUpload.size / 1024 / 1024).toFixed(2)} MB`);
      } catch (compressionError) {
        console.error("Compression failed:", compressionError);
        throw new Error("Failed to compress the image before uploading.");
      }
      // --- AUTOMATIC COMPRESSION LOGIC END ---

      const formData = new FormData();
      formData.append('studentId', selectedStudentId);
      formData.append('examId', selectedExamId);
      
      // Append the newly compressed image!
      formData.append('studentPaper', imageToUpload, 'captured_paper.jpg');

      const response = await fetch('/api/upload-paper', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to grade paper');

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
        submittedBy: 'Teacher (Scan)',
        method: 'AI Grading',
        score: `${totalScore} / ${maxScore}`,
        status: percentage >= 50 ? 'Pass' : 'Fail',
        feedback: data.result.feedback || '',
        image_url: data.result.image_url
      };

      setStudentResults(prev => [newResult, ...prev.filter(r => !(r.name === studentName && r.exam === examTitle))]);

      alert("Score recorded successfully!");
      
      setShowScanModal(false);
      setScanFile(null);
      setCapturedImage(null);
      /*
      if (typeof fetchSubmissions === 'function') {
        await fetchSubmissions(selectedExamId); 
      }
      */
    } catch (error) {
      console.error("Error grading:", error);
      alert("Error during scanning: " + error.message);
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
        submittedBy: 'Teacher (Manual)',
        score: `${data.result.totalScore} / ${data.result.maxScore}`,
        status: percentage >= 50 ? 'Pass' : 'Fail',
        feedback: data.result.feedback || '',
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
    setScanFile(null);
    setCapturedImage(null);
    stopCamera();
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
                  <th>Submitted By</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {studentResults.map((s) => (
                  <tr key={s.id}>
                    <td className="student-name-cell">{s.name}</td>
                    <td>{s.exam}</td>
                    <td>{s.submittedBy}</td>
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
            <div className="scan-title-banner">
              <FileText size={20} />
              <span>{showFeedback.name} — {showFeedback.exam}</span>
              <button className="scan-close-btn" onClick={() => setShowFeedback(null)}><X size={20} /></button>
            </div>
            <div style={{padding: '20px'}}>
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
                const isCorrect = line.includes('Correct');
                // Extract only "Q1: Student answered 'X'"
                const displayLine = line.split('|')[0].trim();
                
                return (
                  <div key={i} className={`feedback-row ${isCorrect ? 'correct' : 'wrong'}`}>
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
                  {!isCameraOpen && !capturedImage && (
                    <div className="scan-capture-options">
                      <button className="scan-record-btn" style={{marginBottom: '10px', width: '100%'}} onClick={startCamera}>
                        <Camera size={18} />
                        <span>Open Camera</span>
                      </button>
                      <div className="scan-capture-zone" onClick={() => scanFileRef.current.click()}>
                        <input
                          type="file"
                          ref={scanFileRef}
                          style={{ display: 'none' }}
                          onChange={(e) => { if (e.target.files[0]) { setScanFile(e.target.files[0]); setCapturedImage(null); } }}
                        />
                        <p className="scan-capture-title">{scanFile ? scanFile.name : 'Or Upload Image'}</p>
                      </div>
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

                  {capturedImage && (
                    <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'}}>
                      <img src={URL.createObjectURL(capturedImage)} alt="Captured" style={{width: '100%', maxHeight: '250px', objectFit: 'contain'}} />
                      <button className="scan-record-btn" onClick={() => setCapturedImage(null)} style={{background: '#ef4444', width: '100%'}}>
                        <Trash2 size={18} />
                        <span>Retake</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {inputMode === 'scan' && (
              <div className="scan-modal-footer">
                <button
                  className="scan-record-btn"
                  onClick={handleScanRecord}
                  disabled={isScanning || !selectedStudentId || !selectedExamId || (!scanFile && !capturedImage)}
                  style={{ opacity: (isScanning || !selectedStudentId || !selectedExamId || (!scanFile && !capturedImage)) ? 0.6 : 1 }}
                >
                  {isScanning ? <><Clock size={16} /><span>Scanning...</span></> : <><CheckCircle size={16} /><span>Scan & Record Score</span></>}
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
