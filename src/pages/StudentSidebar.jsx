import { Link, useLocation, useNavigate } from 'react-router-dom';
import './StudentSidebar.css';

const StudentSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="student-sidebar">
      <div className="student-sidebar-brand">
        <div className="student-brand-logo">S</div>
        <h2>ScanMine</h2>
      </div>

      <nav className="student-sidebar-nav">
        <ul>
          <Link to="/student-dashboard" style={{ textDecoration: 'none' }}>
            <li className={`student-nav-item ${location.pathname === '/student-dashboard' ? 'active' : ''}`}>
              <span className="student-icon">&#8962;</span> Dashboard
            </li>
          </Link>

          <Link to="/student-classes" style={{ textDecoration: 'none' }}>
            <li className={`student-nav-item ${location.pathname === '/student-classes' ? 'active' : ''}`}>
              <span className="student-icon">&#128218;</span> My Classes
            </li>
          </Link>

          <Link to="/student-profile" style={{ textDecoration: 'none' }}>
            <li className={`student-nav-item ${location.pathname === '/student-profile' ? 'active' : ''}`}>
              <span className="student-icon">&#128100;</span> Profile
            </li>
          </Link>
        </ul>
      </nav>

      <div className="student-sidebar-footer">
        <div className="student-nav-item student-logout" onClick={() => navigate('/login')}>
          <span className="student-icon">&#128682;</span> Log Out
        </div>
      </div>
    </aside>
  );
};

export default StudentSidebar;
