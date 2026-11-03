import imageCompression from 'browser-image-compression';
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Camera, X, CheckCircle, Clock } from 'lucide-react';
import { supabase } from '../supabaseClient';
import './StudentViewClass.css';
import './SectionDetails.css';

const isExamSubmissionOpen = (exam, now) => {
  const deadline = exam?.submission_deadline ? new Date(exam.submission_deadline).getTime() : null;
  return Boolean(exam?.is_submission_open) && (deadline === null || now <= deadline);
};

const formatSubmissionCountdown = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}h ${minutes}m ${seconds}s`
    : `${minutes}m ${seconds}s`;
};

const StudentViewClass = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const section = location.state?.section || JSON.parse(localStorage.getItem('currentSection') || '{}');
  
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [dialog, setDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
    confirmText: 'OK',
    cancelText: 'Cancel',
    onConfirm: null
  });
  const [exams, setExams] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [loadingGrades, setLoadingGrades] = useState(true);
  const [submissionClockNow, setSubmissionClockNow] = useState(Date.now());
  
  // Scan Modal State
  const [showScanModal, setShowScanModal] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [scanFile, setScanFile] = useState(null);
  const [scanError, setScanError] = useState('');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  
  const scanFileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const selectedExam = exams.find(exam => String(exam.id) === String(selectedExamId));
  const selectedExamIsOpen = selectedExam ? isExamSubmissionOpen(selectedExam, submissionClockNow) : false;

  const showConfirm = (title, message, onConfirmCallback, confirmText = 'Confirm', cancelText = 'Cancel') => {
    setDialog({ isOpen: true, title, message, type: 'confirm', confirmText, cancelText, onConfirm: onConfirmCallback });
  };

  const showAlert = (title, message, type = 'info', onConfirm = null) => {
    if (type === 'confirm') {
      showConfirm(title, message, onConfirm);
      return;
    }
    setDialog({ isOpen: true, title, message, type, confirmText: 'OK', cancelText: 'Cancel', onConfirm });
  };

  const closeDialog = () => {
    setDialog(current => ({ ...current, isOpen: false, onConfirm: null }));
  };

  const handleDialogConfirm = () => {
    const onConfirm = dialog.onConfirm;
    closeDialog();
    if (onConfirm) onConfirm();
  };

  useEffect(() => {
    if (section?.id) {
      localStorage.setItem('currentSection', JSON.stringify(section));
      fetchExams();
      fetchGrades();
    }
  }, [section]);

  useEffect(() => {
    const intervalId = setInterval(() => setSubmissionClockNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const fetchGrades = async () => {
    if (!user.id || !section?.id) return;
    try {
      const res = await fetch(`/api/student/${user.id}/grades/${section.id}`);
      if (res.ok) {
        const data = await res.json();
        setAssessments(data);
      }
    } catch (err) {
      console.error('Error fetching grades:', err);
    } finally {
      setLoadingGrades(false);
    }
  };

  const fetchExams = async () => {
    try {
      const response = await fetch(`/api/exams?classId=${section.id}`);
      if (response.ok) {
        const data = await response.json();
        setExams(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching exams:', error);
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
      showAlert('Camera unavailable', 'Could not access camera. Please check permissions.', 'error');
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

  const closeScanModal = () => {
    setShowScanModal(false);
    setScanFile(null);
    setCapturedImage(null);
    stopCamera();
  };

  const handleScanRecord = async () => {
    if (!selectedExamId) {
      showAlert('Quiz required', 'Please select a quiz first.', 'warning');
      return;
    }
    if (!selectedExamIsOpen) {
      setScanError('Submission window is closed for this exam.');
      return;
    }
    
    let imageToUpload = scanFile;
    if (capturedImage) {
      imageToUpload = new File([capturedImage], 'captured_paper.jpg', { type: 'image/jpeg' });
    }
    
    if (!imageToUpload) {
      showAlert('Paper required', 'Please capture a photo or upload an image.', 'warning');
      return;
    }

    setScanError('');
    setIsScanning(true);
    try {
      const compressionOptions = {
        maxSizeMB: 4.5,
        maxWidthOrHeight: 1920,
        useWebWorker: true
      };

      try {
        imageToUpload = await imageCompression(imageToUpload, compressionOptions);
      } catch (compressionError) {
        console.error("Compression failed:", compressionError);
        throw new Error("Failed to compress the image before uploading.");
      }

      const formData = new FormData();
      formData.append('studentId', user.id);
      formData.append('examId', selectedExamId);
      formData.append('role', user?.role || '');
      formData.append('studentName', user?.name || user?.fullName || '');
      formData.append('studentPaper', imageToUpload, 'captured_paper.jpg');

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');

      const response = await fetch('/api/upload-paper', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.message || data.error || 'Failed to grade paper');
        error.code = data.code;
        throw error;
      }

      const totalScore = data.result.totalScore || 0;
      const maxScore = data.result.maxScore || 1;
      const percentage = ((totalScore / maxScore) * 100).toFixed(0);

      closeScanModal();
      showAlert(
        'Submission recorded',
        `Score recorded successfully! You got ${percentage}%.`,
        'success',
        () => navigate(`/student/grades/${section.id}`, { state: { section } })
      );
    } catch (error) {
      console.error("Error grading:", error);
      if (error.code === 'NAME_MISMATCH') {
        setScanError('❌ Name Mismatch: You can only scan your own paper.');
      } else {
        setScanError(error.message || 'Error during scanning. Please try again.');
      }
    } finally {
      setIsScanning(false);
    }
  };

  if (!section || !section.id) return (
        <div className="section-container student-view-container">
            <header className="minimal-header">
                <button className="back-btn" onClick={() => navigate('/student-classes')}>← Back to Classes</button>
            </header>
            <p>No class selected.</p>
        </div>
  );

  return (
    <>
      <div className="section-container student-view-container">
        <header className="minimal-header">
          <button className="back-btn" onClick={() => navigate('/student-classes')}>← Back to Classes</button>
          <div className="subject-title">
            <span className="student-portal-badge">Student Portal</span>
            <h1>{section?.subject || 'No Subject'}</h1>
            <p>{section?.name || 'No Section'} • Professor: {section?.professor || 'Unknown'}</p>
          </div>
        </header>

        <div className="section-grid student-view-grid">
          <aside className="actions-sidebar">
            <div className="action-card student-actions-panel">
              <div className="student-actions-card">
                <h4>Student Actions</h4>
                <div className="submission-exam-list">
                  {exams.length === 0 ? (
                    <p className="submission-exam-empty">No exams are assigned to this class yet.</p>
                  ) : exams.map(exam => {
                    const isOpen = isExamSubmissionOpen(exam, submissionClockNow);
                    const deadlineTime = exam.submission_deadline
                      ? new Date(exam.submission_deadline).getTime()
                      : null;
                    return (
                      <div className="student-quiz-card" key={exam.id}>
                        <div className="student-quiz-info">
                          <h5 className="quiz-title">{exam.title}</h5>
                          {isOpen ? (
                            deadlineTime ? (
                              <span className="status-badge open">
                                <span className="status-dot" aria-hidden="true" />
                                ⏱️ Closes in {formatSubmissionCountdown(deadlineTime - submissionClockNow)}
                              </span>
                            ) : (
                              <span className="status-badge open">
                                <span className="status-dot" aria-hidden="true" />
                                Submissions Open
                              </span>
                            )
                          ) : (
                            <span className="status-badge closed">Submission Closed</span>
                          )}
                        </div>
                        <div className="student-quiz-actions">
                          <button
                            type="button"
                            className="student-scan-btn"
                            disabled={!isOpen}
                            onClick={() => {
                              setSelectedExamId(String(exam.id));
                              setScanError('');
                              setShowScanModal(true);
                            }}
                          >
                            <Camera size={17} />
                            Scan / Upload Paper
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="smg-table-card student-assessment-card">
                <h3 className="smg-table-title">Detailed Assessment Results</h3>
                <div className="table-responsive-wrapper">
                  <table className="smg-table student-assessment-table">
                    <thead>
                      <tr>
                        <th>Assessment</th>
                        <th>Date Submitted</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingGrades ? (
                        <tr>
                          <td colSpan="3" className="student-assessment-empty">
                            Loading grades...
                          </td>
                        </tr>
                      ) : assessments.length === 0 ? (
                        <tr>
                          <td colSpan="3" className="student-assessment-empty">
                            No submissions found for this class.
                          </td>
                        </tr>
                      ) : (
                        assessments.map(a => (
                          <tr key={a.id}>
                            <td className="student-assessment-name">{a.exam_title}</td>
                            <td className="student-assessment-date">{new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                            <td>
                              <span className="student-score-badge">
                                {a.points_earned ?? a.score ?? 0} / {a.total_items ?? a.total_questions ?? '?'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {showScanModal && (
        <div className="modal-overlay" onClick={closeScanModal}>
          <div className="modal-content attach-modal student-scan-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <span className="modal-prof-label">ScanMine Student Console</span>
              <button className="modal-close-btn" onClick={closeScanModal}><X size={20} /></button>
            </div>

            <div className="modal-title-banner">
              <Camera size={20} />
              <span>Scan My Quiz Paper</span>
            </div>

            {scanError && (
              <div className="student-scan-error" role="alert">
                {scanError}
              </div>
            )}

            <div className="upload-section student-scan-step">
              <label className="upload-label student-step-label">Step 1: Select Quiz</label>
              <select 
                className="create-input" 
                value={selectedExamId} 
                onChange={(e) => setSelectedExamId(e.target.value)}
              >
                <option value="">-- Choose Quiz --</option>
                {exams.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.title}{isExamSubmissionOpen(e, submissionClockNow) ? '' : ' (Submission Closed)'}
                  </option>
                ))}
              </select>
              {selectedExamId && !selectedExamIsOpen && (
                <p className="submission-closed-notice" role="status">Submission Closed</p>
              )}
              {selectedExamIsOpen && selectedExam?.submission_deadline && (
                <p className="submission-countdown-notice" role="status">
                  ⏱️ Closes in {formatSubmissionCountdown(new Date(selectedExam.submission_deadline).getTime() - submissionClockNow)}
                </p>
              )}
            </div>

            <div className="upload-section student-scan-step student-scan-capture-step">
              <label className="upload-label student-step-label">Step 2: Capture or Upload Paper</label>
              
              {!isCameraOpen && !capturedImage && (
                <div className="student-scan-options">
                  <button className="scan-option-button" onClick={startCamera} disabled={!selectedExamIsOpen}>
                    <Camera size={18} /> Open Camera
                  </button>
                  <div className={`scan-option-button scan-upload-option${selectedExamIsOpen ? '' : ' is-disabled'}`} onClick={() => {
                    if (selectedExamIsOpen) scanFileRef.current.click();
                  }}>
                    <input
                      type="file"
                      ref={scanFileRef}
                      style={{ display: 'none' }}
                      accept=".jpg,.jpeg,.png,.pdf"
                      onChange={(e) => { if (e.target.files[0]) { setScanFile(e.target.files[0]); setCapturedImage(null); } }}
                    />
                    <span className="upload-placeholder">
                      {scanFile ? scanFile.name : 'Upload File'}
                    </span>
                  </div>
                </div>
              )}

              {isCameraOpen && (
                <div className="student-camera-preview">
                  <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxHeight: '300px', backgroundColor: '#000', borderRadius: '12px' }} />
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  <div className="student-camera-actions">
                    <button className="save-assign-btn" onClick={capturePhoto}>
                      <Camera size={18} /> Capture Photo
                    </button>
                    <button className="browse-btn" onClick={stopCamera}>Cancel</button>
                  </div>
                </div>
              )}

              {capturedImage && (
                <div className="student-camera-preview">
                  <img className="student-captured-image" src={URL.createObjectURL(capturedImage)} alt="Captured" />
                  <button className="browse-btn student-retake-button" onClick={() => setCapturedImage(null)}>
                    Retake Photo
                  </button>
                </div>
              )}
            </div>

            <div className="modal-footer student-scan-footer">
              <button
                className="save-assign-btn student-submit-button"
                onClick={handleScanRecord}
                disabled={isScanning || !selectedExamId || !selectedExamIsOpen || (!scanFile && !capturedImage)}
              >
                {isScanning ? <><Clock size={20} /><span>Grading Your Paper...</span></> : <><CheckCircle size={20} /><span>Submit for Auto-Grading</span></>}
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog.isOpen && (
        <div className="custom-dialog-overlay" onClick={closeDialog}>
          <div
            className="custom-dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-dialog-title"
            onClick={event => event.stopPropagation()}
          >
            <h2 id="custom-dialog-title" className="custom-dialog-title">{dialog.title}</h2>
            <p className="custom-dialog-message">{dialog.message}</p>
            <div className="custom-dialog-actions">
              {dialog.type === 'confirm' && (
                <button type="button" className="custom-dialog-cancel" onClick={closeDialog}>
                  {dialog.cancelText}
                </button>
              )}
              <button type="button" className="custom-dialog-confirm" onClick={handleDialogConfirm}>
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StudentViewClass;
