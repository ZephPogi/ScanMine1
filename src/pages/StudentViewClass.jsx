import imageCompression from 'browser-image-compression';
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Camera, X, CheckCircle, Clock } from 'lucide-react';
import './StudentViewClass.css';

const StudentViewClass = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const section = location.state?.section || JSON.parse(localStorage.getItem('currentSection') || '{}');
  
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [exams, setExams] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [loadingGrades, setLoadingGrades] = useState(true);
  
  // Scan Modal State
  const [showScanModal, setShowScanModal] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [scanFile, setScanFile] = useState(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  
  const scanFileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (section?.id) {
      localStorage.setItem('currentSection', JSON.stringify(section));
      fetchExams();
      fetchGrades();
    }
  }, [section]);

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

  const closeScanModal = () => {
    setShowScanModal(false);
    setScanFile(null);
    setCapturedImage(null);
    stopCamera();
  };

  const handleScanRecord = async () => {
    if (!selectedExamId) {
      alert('Please select an exam first.');
      return;
    }
    
    let imageToUpload = scanFile;
    if (capturedImage) {
      imageToUpload = new File([capturedImage], 'captured_paper.jpg', { type: 'image/jpeg' });
    }
    
    if (!imageToUpload) {
      alert('Please capture a photo or upload an image.');
      return;
    }

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
      formData.append('studentPaper', imageToUpload, 'captured_paper.jpg');

      const response = await fetch('/api/upload-paper', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to grade paper');

      const totalScore = data.result.totalScore || 0;
      const maxScore = data.result.maxScore || 1;
      const percentage = ((totalScore / maxScore) * 100).toFixed(0);

      alert(`Score recorded successfully! You got ${percentage}%`);
      closeScanModal();
      
      navigate(`/student/grades/${section.id}`, { state: { section } });
    } catch (error) {
      console.error("Error grading:", error);
      alert("Error during scanning: " + error.message);
    } finally {
      setIsScanning(false);
    }
  };

  if (!section || !section.id) return (
        <div className="section-container">
            <header className="minimal-header">
                <button className="back-btn" onClick={() => navigate('/student-classes')}>← Back to Classes</button>
            </header>
            <p>No class selected.</p>
        </div>
  );

  return (
    <>
      <div className="section-container">
        <header className="minimal-header">
          <button className="back-btn" onClick={() => navigate('/student-classes')}>← Back to Classes</button>
          <div className="subject-title">
            <h1>{section?.subject || 'No Subject'}</h1>
            <p>{section?.name || 'No Section'} • Professor: {section?.professor || 'Unknown'}</p>
          </div>
        </header>

        <div className="section-grid" style={{ gridTemplateColumns: '1fr', maxWidth: '800px', margin: '0 auto' }}>
          <aside className="actions-sidebar">
            <div className="action-card" style={{ padding: '40px 30px', textAlign: 'center', background: 'white', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
              <h4 style={{ fontSize: '1.4rem', marginBottom: '25px', color: '#1e293b' }}>Student Actions</h4>
              
              <button 
                className="btn-action primary" 
                style={{ padding: '18px', fontSize: '1.15rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', width: '100%', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)', marginBottom: '30px' }}
                onClick={() => setShowScanModal(true)}
              >
                <Camera size={20} />
                Scan / Upload My Answer Sheet
              </button>

              <div className="smg-table-card" style={{ marginTop: '30px', textAlign: 'left' }}>
                <h3 className="smg-table-title" style={{ fontSize: '1.2rem', marginBottom: '15px', color: '#1e293b', fontWeight: '700' }}>Detailed Assessment Results</h3>
                <div className="table-responsive-wrapper">
                  <table className="smg-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                        <th style={{ padding: '12px', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase' }}>Assessment</th>
                        <th style={{ padding: '12px', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase' }}>Date Submitted</th>
                        <th style={{ padding: '12px', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase' }}>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingGrades ? (
                        <tr>
                          <td colSpan="3" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                            Loading grades...
                          </td>
                        </tr>
                      ) : assessments.length === 0 ? (
                        <tr>
                          <td colSpan="3" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                            No submissions found for this class.
                          </td>
                        </tr>
                      ) : (
                        assessments.map(a => (
                          <tr key={a.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                            <td style={{ padding: '12px', fontWeight: '600', color: '#1e293b' }}>{a.exam_title}</td>
                            <td style={{ padding: '12px', color: '#64748b', fontSize: '0.88rem' }}>{new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                            <td style={{ padding: '12px', fontWeight: '700', color: '#334155' }}>
                              {a.points_earned ?? a.score ?? 0} / {a.total_items ?? a.total_questions ?? '?'}
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
          <div className="modal-content attach-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <span className="modal-prof-label">ScanMine Student Console</span>
              <button className="modal-close-btn" onClick={closeScanModal}><X size={20} /></button>
            </div>

            <div className="modal-title-banner" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.3)' }}>
              <Camera size={20} style={{ display: 'inline', marginRight: '10px', verticalAlign: 'middle' }} />
              <span style={{ verticalAlign: 'middle' }}>Scan My Answer Sheet</span>
            </div>

            <div className="upload-section" style={{ padding: '20px 32px' }}>
              <label className="upload-label">Step 1: Select Exam</label>
              <select 
                className="create-input" 
                value={selectedExamId} 
                onChange={(e) => setSelectedExamId(e.target.value)}
              >
                <option value="">-- Choose Exam --</option>
                {exams.map(e => (
                  <option key={e.id} value={e.id}>{e.title}</option>
                ))}
              </select>
            </div>

            <div className="upload-section" style={{ padding: '10px 32px 30px' }}>
              <label className="upload-label">Step 2: Capture or Upload</label>
              
              {!isCameraOpen && !capturedImage && (
                <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
                  <button className="browse-btn exam-browse" style={{ flex: 1, padding: '14px', fontSize: '1rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer' }} onClick={startCamera}>
                    <Camera size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Open Camera
                  </button>
                  <div className="upload-row" style={{ flex: 1, margin: 0, border: '2px dashed #cbd5e1', borderRadius: '10px', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#f8fafc' }} onClick={() => scanFileRef.current.click()}>
                    <input
                      type="file"
                      ref={scanFileRef}
                      style={{ display: 'none' }}
                      accept=".jpg,.jpeg,.png,.pdf"
                      onChange={(e) => { if (e.target.files[0]) { setScanFile(e.target.files[0]); setCapturedImage(null); } }}
                    />
                    <span className="upload-placeholder" style={{ textAlign: 'center', width: '100%', color: '#64748b', fontWeight: '500' }}>
                      {scanFile ? scanFile.name : 'Upload File'}
                    </span>
                  </div>
                </div>
              )}

              {isCameraOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', marginTop: '10px' }}>
                  <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxHeight: '300px', backgroundColor: '#000', borderRadius: '12px' }} />
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  <div style={{ display: 'flex', gap: '15px', width: '100%' }}>
                    <button className="save-assign-btn" style={{ flex: 1, padding: '12px', background: '#10b981', color: 'white', border: 'none', borderRadius: '50px', fontWeight: 'bold', cursor: 'pointer' }} onClick={capturePhoto}>
                      <Camera size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Capture Photo
                    </button>
                    <button className="browse-btn" style={{ flex: 1, background: '#ef4444', border: 'none', color: 'white', borderRadius: '50px', fontWeight: 'bold', cursor: 'pointer' }} onClick={stopCamera}>Cancel</button>
                  </div>
                </div>
              )}

              {capturedImage && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', marginTop: '10px' }}>
                  <img src={URL.createObjectURL(capturedImage)} alt="Captured" style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '12px', border: '2px solid #e2e8f0' }} />
                  <button className="browse-btn" onClick={() => setCapturedImage(null)} style={{ background: '#ef4444', width: '100%', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Retake Photo
                  </button>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ padding: '20px 32px 32px' }}>
              <button
                className="save-assign-btn"
                onClick={handleScanRecord}
                disabled={isScanning || !selectedExamId || (!scanFile && !capturedImage)}
                style={{ 
                  opacity: (isScanning || !selectedExamId || (!scanFile && !capturedImage)) ? 0.6 : 1,
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '16px',
                  borderRadius: '50px',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.3)'
                }}
              >
                {isScanning ? <><Clock size={20} /><span>Grading Your Paper...</span></> : <><CheckCircle size={20} /><span>Submit for Auto-Grading</span></>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StudentViewClass;
