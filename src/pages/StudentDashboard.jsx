import { useState, useEffect } from 'react';
import { Clock, FileText, TrendingUp, Award } from 'lucide-react';
import StudentSidebar from './StudentSidebar';
import './StudentDashboard.css';

const StudentDashboard = () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const student = { name: user.name || 'Student', avatar: (user.name || 'S').substring(0, 2).toUpperCase() };

  const [pendingExams, setPendingExams] = useState([]);

  useEffect(() => {
    fetchPendingExams();
  }, []);

  const fetchPendingExams = async () => {
    try {
      const response = await fetch('/api/exams'); 
      if (response.ok) {
        const data = await response.json();
        setPendingExams(data.map(e => ({
          id: e.id,
          title: e.title,
          subject: 'Enrolled Class',
          due: 'Active',
          status: 'Pending',
          statusClass: 'status-pending'
        })));
      }
    } catch (error) {
      console.error('Error fetching exams:', error);
    }
  };

  const stats = [
    { id: 1, label: "Active Classes", value: "4", icon: FileText, trend: "" },
    { id: 2, label: "Pending Exams", value: pendingExams.length.toString(), icon: Clock, trend: pendingExams.length > 0 ? "Action Required" : "" },
    { id: 3, label: "Average Grade", value: "92%", icon: TrendingUp, trend: "+2% this month" },
    { id: 4, label: "Class Rank", value: "Top 10%", icon: Award, trend: "" },
  ];

  const getStatusBadge = (status) => {
    if (status === 'Pending') {
      return <span className="badge warning">Pending</span>;
    }
    return <span className="badge success">Completed</span>;
  };

  return (
    <div className="page-layout">
      <StudentSidebar />
      <main className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <h1>Welcome back, {student.name}!</h1>
            <p>Here's what's happening with your classes today.</p>
          </div>
          <div className="student-avatar-circle" style={{background: '#3b82f6', color: 'white', width: '45px', height: '45px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontWeight: 'bold', fontSize: '1.2rem'}}>{student.avatar}</div>
        </header>

        {/* Stats Grid */}
        <section className="stats-grid">
          {stats.map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.id} className="stat-card">
                <div className="stat-icon"><Icon size={24} /></div>
                <div className="stat-info">
                  <span className="stat-label">{stat.label}</span>
                  <h2 className="stat-value">{stat.value}</h2>
                  <span className={`stat-trend ${stat.trend.includes('+') ? 'positive' : 'neutral'}`}>
                    {stat.trend}
                  </span>
                </div>
              </div>
            );
          })}
        </section>

        {/* Main Section */}
        <div className="dashboard-main-grid">
          {/* Pending Exams Table */}
          <section className="dashboard-card table-container">
            <div className="card-header">
              <h3>Pending Quizzes & Exams</h3>
              <button className="text-link">View All</button>
            </div>
            <div className="table-responsive-wrapper">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Exam Title</th>
                    <th>Class</th>
                    <th>Status</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingExams.length === 0 ? (
                    <tr><td colSpan="4" style={{textAlign: 'center', padding: '20px'}}>No pending exams.</td></tr>
                  ) : (
                    pendingExams.map((exam, index) => (
                      <tr key={index}>
                        <td>{exam.title}</td>
                        <td>{exam.subject}</td>
                        <td>{getStatusBadge(exam.status)}</td>
                        <td>{exam.due}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Leaderboard or Shortcuts */}
          <section className="dashboard-card shortcuts">
            <h3>Leaderboard Rank</h3>
            <div className="shortcut-list" style={{padding: '10px 0'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', padding: '12px 10px', borderBottom: '1px solid #f1f5f9'}}>
                    <span>🥇 Mike Chen</span>
                    <span style={{fontWeight: 'bold', color: '#16a34a'}}>96%</span>
                </div>
                <div style={{display: 'flex', justifyContent: 'space-between', padding: '12px 10px', borderBottom: '1px solid #f1f5f9', background: '#eef2ff', borderRadius: '8px'}}>
                    <span style={{fontWeight: 'bold', color: '#4338ca'}}>🥈 {student.name} (You)</span>
                    <span style={{fontWeight: 'bold', color: '#4338ca'}}>92%</span>
                </div>
                <div style={{display: 'flex', justifyContent: 'space-between', padding: '12px 10px', borderBottom: '1px solid #f1f5f9'}}>
                    <span>🥉 Emma Davis</span>
                    <span style={{fontWeight: 'bold', color: '#16a34a'}}>88%</span>
                </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default StudentDashboard;
