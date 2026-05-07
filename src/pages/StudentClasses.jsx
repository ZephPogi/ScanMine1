import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StudentSidebar from './StudentSidebar';
import { Users } from 'lucide-react';
import './StudentClasses.css';

const StudentClasses = () => {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const fetchClasses = useCallback(async () => {
    if (!user.id) return;
    try {
      const response = await fetch(`/api/student-classes?studentId=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setClasses(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching student classes:', error);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  const handleViewClass = (cls) => {
    navigate('/student-view-class', { state: { section: cls } });
  };

  return (
    <div className="page-layout">
      <StudentSidebar />
      <div className="main-content">
        <header className="page-header">
          <div>
            <h2>My Classes</h2>
            <p style={{color: '#64748b', marginTop: '5px'}}>View and access your enrolled classes.</p>
          </div>
        </header>

        {loading ? (
          <p>Loading classes...</p>
        ) : (
          <div className="class-grid">
            {classes.map((item) => (
              <div key={item.id} className="class-card">
                <div className="card-top">
                  <span className="subject-label">{item.subject || 'No Subject'}</span>
                </div>
                <div className="card-info">
                  <h3>{item.name}</h3>
                  <p><Users size={16} /> Professor: {item.professor || 'Unknown'}</p>
                </div>
                <button className="view-btn" onClick={() => handleViewClass(item)}>
                  View Class
                </button>
              </div>
            ))}
            {classes.length === 0 && <p>You are not enrolled in any classes yet.</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentClasses;
