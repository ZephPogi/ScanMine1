import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Monitor } from 'lucide-react';
import './StudentUpcomingExams.css';

const StudentUpcomingExams = () => {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('All Classes');

  const filters = ['All Classes', 'Algebra', 'History', 'Biology'];

  const exams = [
    {
      id: 1, title: 'Algebra Midterm Exam', class: 'Algebra 101',
      due: 'Due: Tomorrow, 11:59 PM', dueBadge: 'Urgent', dueBadgeClass: 'badge-urgent',
      questions: 20, timeLimit: 60, submitted: false, category: 'Algebra',
    },
    {
      id: 2, title: 'Algebra Weekly Quiz 5', class: 'Algebra 101',
      due: 'Due: Friday, 11:59 PM', dueBadge: 'Due Soon', dueBadgeClass: 'badge-soon',
      questions: 10, timeLimit: 30, submitted: false, category: 'Algebra',
    },
    {
      id: 3, title: 'World History - Chapter 5 Ex', class: 'World History',
      due: 'Due: Next Tuesday, 11:59 PM', dueBadge: 'Next Week', dueBadgeClass: 'badge-next',
      questions: 25, timeLimit: 90, submitted: false, category: 'History',
    },
    {
      id: 4, title: 'Biology Quiz 2', class: 'Biology Basics',
      due: 'Submitted: Mar 10, 2025', dueBadge: 'Submitted', dueBadgeClass: 'badge-submitted',
      questions: null, timeLimit: null, submitted: true, category: 'Biology',
    },
  ];

  const filtered = activeFilter === 'All Classes'
    ? exams
    : exams.filter(e => e.category === activeFilter);

  return (
      <div className="student-main">
        {/* Header */}
        <header className="sue-header">
          <div>
            <p className="sue-label">Student upcoming exams</p>
            <h1>📋 Upcoming Exams</h1>
            <button className="sue-back-btn" onClick={() => navigate('/student-classes')}>
              ← Back to Algebra 101
            </button>
          </div>
          <div className="student-avatar-circle">SJ</div>
        </header>

        {/* Filter Tabs */}
        <div className="sue-filters">
          {filters.map(f => (
            <button
              key={f}
              className={`sue-filter-tab ${activeFilter === f ? 'active' : ''}`}
              onClick={() => setActiveFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Exam Cards */}
        <div className="sue-exam-list">
          {filtered.map(exam => (
            <div className="sue-exam-card" key={exam.id}>
              <div className="sue-exam-left">
                <div className="sue-exam-title-row">
                  <span className="sue-exam-title">{exam.title}</span>
                  <span className={`sue-due-badge ${exam.dueBadgeClass}`}>{exam.dueBadge}</span>
                </div>
                <p className="sue-class-name">Class: {exam.class}</p>
                <p className={`sue-due-text ${exam.submitted ? '' : 'due-highlight'}`}>
                  🏁 {exam.due}
                </p>
                {!exam.submitted && (
                  <p className="sue-meta">
                    Questions: {exam.questions} | Time Limit: {exam.timeLimit} min
                  </p>
                )}
              </div>
              <div className="sue-exam-actions">
                {exam.submitted
                  ? <button className="sue-btn view-results">View Results</button>
                  : <>
                      <button className="sue-btn take-exam"><Monitor size={16} /> Take Exam</button>
                      <button className="sue-btn upload-paper"><Camera size={16} /> Upload Paper</button>
                    </>
                }
              </div>
            </div>
          ))}
        </div>
      </div>
  );
};

export default StudentUpcomingExams;
