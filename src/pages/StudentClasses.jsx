import { useNavigate } from 'react-router-dom';
import StudentSidebar from './StudentSidebar';
import './StudentClasses.css';

const StudentClasses = () => {
  const navigate = useNavigate();
  const student = { avatar: 'SJ' };

  const classes = [
    {
      id: 1,
      icon: '📐',
      title: 'Algebra 101',
      status: 'Active',
      professor: 'Dr. Sarah Johnson',
      schedule: 'Mon/Wed 10:00 AM – 11:30 AM',
      progress: 65,
      progressLabel: '65% completed',
      finished: false,
    },
    {
      id: 2,
      icon: '🌍',
      title: 'World History',
      status: 'Active',
      professor: 'Dr. Michael Chen',
      schedule: 'Tue/Thu 1:00 PM – 2:30 PM',
      progress: 40,
      progressLabel: '40% completed',
      finished: false,
    },
    {
      id: 3,
      icon: '🔬',
      title: 'Biology Basics',
      status: 'Grade: A',
      statusClass: 'status-grade',
      professor: 'Dr. Emily Rodriguez',
      schedule: 'Mon/Wed 3:00 PM – 4:30 PM',
      progress: 100,
      progressLabel: 'Final Grade: 92% (A)',
      finished: true,
    },
  ];

  return (
    <div className="student-page-layout">
      <StudentSidebar />
      <div className="student-main">
        {/* Header */}
        <header className="student-classes-header">
          <div>
            <h1>My Classes</h1>
            <p className="student-classes-sub">Spring Semester 2025</p>
          </div>
          <div className="student-avatar-circle">{student.avatar}</div>
        </header>

        {/* Class Cards */}
        <div className="classes-list">
          {classes.map(cls => (
            <div className="class-card-student" key={cls.id}>
              {/* Card Header */}
              <div className="class-card-top">
                <div className="class-card-title-row">
                  <span className="class-icon">{cls.icon}</span>
                  <span className="class-name">{cls.title}</span>
                </div>
                <span className={`class-status-badge ${cls.statusClass || (cls.status === 'Active' ? 'status-active' : '')}`}>
                  {cls.status}
                </span>
              </div>

              {/* Card Body */}
              <div className="class-card-body">
                <div className="class-meta">
                  <p>Professor: {cls.professor}</p>
                  <p>Schedule: {cls.schedule}</p>
                  <div className="class-progress-bar">
                    <div
                      className={`class-progress-fill ${cls.finished ? 'fill-green' : 'fill-blue'}`}
                      style={{ width: `${cls.progress}%` }}
                    />
                  </div>
                  <p className="class-progress-label">{cls.progressLabel}</p>
                </div>

                <div className="class-card-actions">
                  {!cls.finished ? (
                    <>
                      <button className="cls-btn view" onClick={() => navigate('/student-view-class')}>View Class</button>
                      <button className="cls-btn upcoming" onClick={() => navigate('/student-upcoming-exams')}>Upcoming Exams</button>
                      <button className="cls-btn grades" onClick={() => navigate('/student-my-grades')}>My Grades</button>
                    </>
                  ) : (
                    <button className="cls-btn grades">My Grades</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StudentClasses;
