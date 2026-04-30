import Sidebar from './Sidebar';
import './TeacherDashboard.css';

const TeacherDashboard = () => {
  return (
    <div className="main-layout">
      <Sidebar />
      
      <main className="main-content">
        <header className="content-header">
          <div className="header-info">
            <h1>Teacher Dashboard</h1>
            <p>Here's your overview as of today.</p>
          </div>
          <div className="header-profile">
            <div className="avatar">JS</div>
          </div>
        </header>

        {/* Floating Cards (KPI) */}
        <section className="stats-container">
          <div className="stat-card">
            <div className="card-header">
              <span className="label">Total Students</span>
              <div className="icon-box blue">&#128101;</div>
            </div>
            <h2 className="value">1,250</h2>
          </div>

          <div className="stat-card">
            <div className="card-header">
              <span className="label">Quizzes Checked</span>
              <div className="icon-box green">&#9989;</div>
            </div>
            <h2 className="value">48</h2>
          </div>

          <div className="stat-card primary-card">
            <div className="card-header">
              <span className="label">Class Average</span>
              <div className="icon-box orange">&#128200;</div>
            </div>
            <h2 className="value">85.4%</h2>
          </div>
        </section>

        {/* Activity Table */}
        <section className="table-container">
          <div className="table-header">
            <h3>Recent Quiz Performance</h3>
            <button className="btn-view-all">View All</button>
          </div>
          <table className="performance-table">
            <thead>
              <tr>
                <th>Student Name</th>
                <th>Subject</th>
                <th>Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>jon zeph Glodoviza</td>
                <td>History 101</td>
                <td>98/100</td>
                <td><span className="badge pass">Passed</span></td>
              </tr>
              <tr>
                <td>Jutine Laguatan</td>
                <td>Science</td>
                <td>85/100</td>
                <td><span className="badge pass">Passed</span></td>
              </tr>
              <tr>
                <td>ako budoy</td>
                <td>Arts</td>
                <td>72/100</td>
                <td><span className="badge warn">Retake</span></td>
              </tr>
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
};

export default TeacherDashboard;