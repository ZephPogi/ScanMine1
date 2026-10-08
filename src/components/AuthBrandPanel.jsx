import { ScanLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import './AuthBrandPanel.css';

const AuthBrandPanel = () => (
  <aside className="auth-brand-panel" aria-label="ScanMine product information">
    <div className="auth-brand-glow auth-brand-glow-one" />
    <div className="auth-brand-glow auth-brand-glow-two" />
    <div className="auth-brand-content">
      <Link className="auth-brand-logo" to="/" aria-label="ScanMine home">
        <span className="auth-brand-logo-mark"><ScanLine size={23} /></span>
        <span>ScanMine</span>
      </Link>
      <div className="auth-brand-copy">
        <p className="auth-brand-eyebrow">Smart assessment workspace</p>
        <h1>Automated Answer Sheet Checking &amp; Quiz Generator System</h1>
        <p className="auth-brand-subtitle">
          Create assessments, scan student answers, and review results with confidence.
        </p>
        <div className="auth-feature-badges" aria-label="ScanMine features">
          <span>Automated grading</span>
          <span>Optical scanning</span>
          <span>AI quiz generation</span>
        </div>
      </div>

      <div className="auth-scanner-scene" aria-hidden="true">
        <div className="auth-status-pill auth-status-accuracy">98.5% Accuracy</div>
        <div className="auth-status-pill auth-status-ocr">Instant OCR</div>
        <div className="auth-status-pill auth-status-engine"><span />AI Engine Active</div>
        <div className="auth-paper">
          <div className="auth-paper-heading">
            <span className="auth-paper-symbol"><ScanLine size={12} /></span>
            <span>ANSWER SHEET</span>
            <span className="auth-paper-number">01</span>
          </div>
          <div className="auth-paper-rule" />
          <div className="auth-paper-meta">
            <span>STUDENT</span><i />
            <span>CLASS</span><i />
          </div>
          <div className="auth-paper-rule auth-paper-rule-short" />
          <div className="auth-answer-list">
            {['A', 'B', 'C', 'D'].map((answer, questionIndex) => (
              <div className="auth-answer-row" key={answer}>
                <span className="auth-question-number">0{questionIndex + 1}</span>
                {['A', 'B', 'C', 'D'].map(choice => (
                  <span
                    className={`auth-answer-bubble${choice === answer ? ' is-selected' : ''}`}
                    key={choice}
                  >
                    {choice}
                  </span>
                ))}
                {questionIndex < 2 && <span className="auth-answer-check">✓</span>}
              </div>
            ))}
          </div>
          <div className="auth-paper-footer">
            <span>SCANMINE OPTICAL READER</span>
            <span>FORM A</span>
          </div>
          <div className="auth-paper-corner auth-paper-corner-tl" />
          <div className="auth-paper-corner auth-paper-corner-tr" />
          <div className="auth-paper-corner auth-paper-corner-bl" />
          <div className="auth-paper-corner auth-paper-corner-br" />
          <div className="auth-scan-sweep" />
          <div className="auth-scan-line" />
        </div>
      </div>
      <p className="auth-brand-footnote">Built for clearer, faster classroom assessment.</p>
    </div>
  </aside>
);

export default AuthBrandPanel;
