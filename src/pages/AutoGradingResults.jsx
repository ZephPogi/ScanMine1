import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './AutoGradingResults.css';
import Sidebar from './Sidebar';

const AutoGradingResults = () => {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('all');

  // Scan modal state
  const [showScanModal, setShowScanModal] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [scanFile, setScanFile] = useState(null);
  const scanFileRef = useRef(null);

  // Mock exam info
  const examInfo = {
    title: 'Introduction to Algebra - Midterm Exam',
    className: 'Class 1',
  };

  // Mock stats
  const stats = {
    totalStudents: 24,
    graded: 24,
    classAverage: 84,
    examMethod: 'AI Grading',
  };

  // Mock student results
  const studentResults = [
    { id: 1, name: 'Sarah Johnson', submittedBy: 'Student', method: 'Photo', score: '18/20 (90%)', status: 'Pass' },
    { id: 2, name: 'Mike Chen', submittedBy: 'Teacher (Print Scan)', method: 'Photo', score: '16/20 (80%)', status: 'Pass' },
    { id: 3, name: 'Emma Davis', submittedBy: 'Student', method: 'Photo', score: '17/20 (85%)', status: 'Pass' },
    { id: 4, name: 'James Wilson', submittedBy: 'Teacher (Print Scan)', method: 'Photo', score: '10/20 (50%)', status: 'Fail' },
  ];

  const filteredResults = activeFilter === 'all'
    ? studentResults
    : studentResults.filter(s =>
        activeFilter === 'student'
          ? s.submittedBy === 'Student'
          : s.submittedBy.includes('Teacher')
      );

  const handleScanRecord = () => {
    console.log('Student:', studentSearch);
    console.log('Scan file:', scanFile);
    setShowScanModal(false);
    setStudentSearch('');
    setScanFile(null);
  };

  const closeScanModal = () => {
    setShowScanModal(false);
    setStudentSearch('');
    setScanFile(null);
  };

  return (
    <div className="page-layout">
      <Sidebar />
      <div className="grading-container">
        {/* Header */}
        <header className="grading-header">
          <div>
            <h1>Auto-Grading Results</h1>
            <p className="grading-subtitle">{examInfo.className} • {examInfo.title}</p>
          </div>
          <button className="grading-edit-btn" onClick={() => navigate('/section-details')}>
            ✏️
          </button>
        </header>

        {/* Stats Cards */}
        <div className="stats-row">
          <div className="stat-card">
            <span className="stat-label">Total Students</span>
            <span className="stat-value">{stats.totalStudents}</span>
          </div>
          <div className="stat-card stat-highlight">
            <span className="stat-label">Graded</span>
            <span className="stat-value">{stats.graded}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Class Average</span>
            <span className="stat-value stat-percent">{stats.classAverage}%</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Exam Method</span>
            <span className="stat-method">🤖 {stats.examMethod}</span>
          </div>
        </div>

        {/* Results Table */}
        <section className="results-section">
          <h3 className="results-title">Student Results</h3>
          <div className="results-table-wrapper">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Submitted By</th>
                  <th>Exam Method</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((s) => (
                  <tr key={s.id}>
                    <td className="student-name-cell">{s.name}</td>
                    <td>{s.submittedBy}</td>
                    <td>
                      <span className="method-badge">📷 {s.method}</span>
                    </td>
                    <td className="score-cell">{s.score}</td>
                    <td>
                      <span className={`status-badge ${s.status.toLowerCase()}`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Footer: Filter + Actions */}
        <div className="grading-footer">
          <div className="filter-section">
            <span className="filter-label">📊 Exam Method</span>
            <div className="filter-tabs">
              <button
                className={`filter-tab ${activeFilter === 'student' ? 'active' : ''}`}
                onClick={() => setActiveFilter(activeFilter === 'student' ? 'all' : 'student')}
              >
                Student
              </button>
              <button
                className={`filter-tab ${activeFilter === 'teacher' ? 'active' : ''}`}
                onClick={() => setActiveFilter(activeFilter === 'teacher' ? 'all' : 'teacher')}
              >
                Teacher
              </button>
            </div>
          </div>

          <div className="action-buttons">
            <button className="scan-btn" onClick={() => setShowScanModal(true)}>📷 Start Scanning</button>
            <button className="export-btn">Export CSV</button>
          </div>
        </div>
      </div>

      {/* ===== SCAN STUDENT PAPER MODAL ===== */}
      {showScanModal && (
        <div className="scan-modal-overlay" onClick={closeScanModal}>
          <div className="scan-modal-content" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="scan-modal-header">
              <span className="scan-prof-label">profesor</span>
            </div>

            <div className="scan-title-banner">
              <span>📷 Scan Student Paper</span>
              <button className="scan-close-btn" onClick={closeScanModal}>×</button>
            </div>

            {/* Step 1 */}
            <div className="scan-step">
              <h4 className="scan-step-title">Step 1: Select Student</h4>
              <div className="scan-search-row">
                <input
                  type="text"
                  className="scan-search-input"
                  placeholder="Search or select student..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
                <button className="scan-browse-btn">Browse</button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="scan-step">
              <h4 className="scan-step-title">Step 2: Select Exam</h4>
              <input
                type="text"
                className="scan-exam-input"
                value="Algebra Midterm Exam"
                readOnly
              />
            </div>

            {/* Step 3 */}
            <div className="scan-step">
              <h4 className="scan-step-title">Step 3: Capture Answer Sheet</h4>
              <div
                className="scan-capture-zone"
                onClick={() => scanFileRef.current.click()}
              >
                <input
                  type="file"
                  ref={scanFileRef}
                  accept=".png,.jpg,.jpeg,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files[0]) setScanFile(e.target.files[0]); }}
                />
                <div className="scan-camera-icon">📷</div>
                <p className="scan-capture-title">
                  {scanFile ? scanFile.name : "Take Photo of Student's Paper"}
                </p>
                <p className="scan-capture-sub">or 📁 Upload from device</p>
              </div>
            </div>

            {/* Auto-detect info */}
            <div className="scan-autodetect">
              🔍 ScanMine will auto-detect:<br />
              Student name • Answers • Score
            </div>

            {/* Scan Button */}
            <div className="scan-modal-footer">
              <button className="scan-record-btn" onClick={handleScanRecord}>
                📎 Scan & Record Score
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AutoGradingResults;
