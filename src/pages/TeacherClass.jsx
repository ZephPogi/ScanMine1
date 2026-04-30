import { useState } from 'react';
import SectionDetails from './SectionDetails'; // I-import natin yung bagong view
import Sidebar from './Sidebar';
import './TeacherClass.css';

const TeacherClass = () => {
  const [selectedSection, setSelectedSection] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newClass, setNewClass] = useState({ name: '', subject: '', students: '' });

  const classes = [
    { id: 1, name: "Grade 10 - Rizal", students: 45, subject: "History" },
    { id: 2, name: "Grade 11 - Bonifacio", students: 38, subject: "PolSci" },
    { id: 3, name: "Grade 12 - Mabini", students: 42, subject: "Social Science" },
    { id: 4, name: "Grade 10 - Luna", students: 40, subject: "Arts" },
  ];

  const handleCreateClass = () => {
    // TODO: Implement create class logic
    console.log('New class:', newClass);
    setShowCreateModal(false);
    setNewClass({ name: '', subject: '', students: '' });
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewClass({ name: '', subject: '', students: '' });
  };

  // Kung may napiling section, ipakita ang SectionDetails view
  if (selectedSection) {
    return <SectionDetails section={selectedSection} onBack={() => setSelectedSection(null)} />;
  }

  return (
    <div className="page-layout">
      <Sidebar />
      <div className="main-content">
        <header className="page-header">
          <h2>My Classes</h2>
          <button className="add-btn" onClick={() => setShowCreateModal(true)}>+ Create Class</button>
        </header>

        <div className="class-grid">
          {classes.map((item) => (
            <div key={item.id} className="class-card">
              <div className="card-top">
                <span className="subject-label">{item.subject}</span>
              </div>
              <div className="card-info">
                <h3>{item.name}</h3>
                <p>👤 {item.students} Students</p>
              </div>
              {/* Pag click dito, ise-set ang state para magpalit ng view */}
              <button className="view-btn" onClick={() => setSelectedSection(item)}>
                View Section
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ===== CREATE CLASS MODAL ===== */}
      {showCreateModal && (
        <div className="create-modal-overlay" onClick={closeCreateModal}>
          <div className="create-modal-content" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="create-modal-header">
              <span className="create-prof-label">prof</span>
              <button className="create-close-btn" onClick={closeCreateModal}>×</button>
            </div>

            <div className="create-title-banner">
              📚 Create New Class
            </div>

            {/* Form Fields */}
            <div className="create-form">
              <div className="create-field">
                <label className="create-label">Class / Section Name</label>
                <input
                  type="text"
                  className="create-input"
                  placeholder="e.g. Grade 10 - Rizal"
                  value={newClass.name}
                  onChange={(e) => setNewClass({ ...newClass, name: e.target.value })}
                />
              </div>

              <div className="create-field">
                <label className="create-label">Subject</label>
                <input
                  type="text"
                  className="create-input"
                  placeholder="e.g. Philippine History"
                  value={newClass.subject}
                  onChange={(e) => setNewClass({ ...newClass, subject: e.target.value })}
                />
              </div>

              <div className="create-field">
                <label className="create-label">Number of Students</label>
                <input
                  type="number"
                  className="create-input"
                  placeholder="e.g. 45"
                  value={newClass.students}
                  onChange={(e) => setNewClass({ ...newClass, students: e.target.value })}
                />
              </div>
            </div>

            {/* Create Button */}
            <div className="create-modal-footer">
              <button className="create-submit-btn" onClick={handleCreateClass}>
                Create Class
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherClass;