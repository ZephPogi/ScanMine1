import './Dashboard.css';
import Sidebar from './Sidebar';
import { Users, FileText, TrendingUp, Camera, Scan, Bot, FileDown } from 'lucide-react';

const TeacherDashboard = () => {
  const stats = [
    { id: 1, label: "Total Students", value: "165", icon: Users, trend: "+12%" },
    { id: 2, label: "Quizzes Generated", value: "24", icon: FileText, trend: "+5" },
    { id: 3, label: "Average Score", value: "82%", icon: TrendingUp, trend: "+3%" },
    { id: 4, label: "Pending Scans", value: "12", icon: Camera, trend: "Action Required" },
  ];

  return (
    <div className="page-layout">
      <Sidebar />
      <main className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <h1>Welcome back, Teacher Maria</h1>
            <p>Here's what's happening with your classes today.</p>
          </div>
          <button className="primary-action-btn">+ Create New Quiz</button>
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
          {/* Recent Activity Table */}
          <section className="dashboard-card table-container">
            <div className="card-header">
              <h3>Recent Quiz Results</h3>
              <button className="text-link">View All</button>
            </div>
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Quiz Title</th>
                  <th>Status</th>
                  <th>Avg. Score</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Grade 10 - Rizal</td>
                  <td>Midterm History</td>
                  <td><span className="badge success">Completed</span></td>
                  <td>88%</td>
                </tr>
                <tr>
                  <td>Grade 11 - Bonifacio</td>
                  <td>PolSci Quiz 1</td>
                  <td><span className="badge warning">Pending Scans</span></td>
                  <td>74%</td>
                </tr>
                <tr>
                  <td>Grade 12 - Mabini</td>
                  <td>Sociology Finals</td>
                  <td><span className="badge info">Ongoing</span></td>
                  <td>--</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* Quick Actions / Shortcuts */}
          <section className="dashboard-card shortcuts">
            <h3>Quick Actions</h3>
            <div className="shortcut-list">
              <button className="shortcut-item">
                <Scan size={18} />
                <span>Scan Answer Sheets</span>
              </button>
              <button className="shortcut-item">
                <Bot size={18} />
                <span>AI Quiz Generator</span>
              </button>
              <button className="shortcut-item">
                <FileDown size={18} />
                <span>Export Grade Reports</span>
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default TeacherDashboard;