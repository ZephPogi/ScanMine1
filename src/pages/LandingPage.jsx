import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useInView } from 'framer-motion';
import { useRef } from 'react';
import {
  ScanLine,
  FileText,
  BarChart2,
  CheckCircle,
  ArrowRight,
  Zap,
  Users,
  ShieldCheck,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
} from 'lucide-react';
import './LandingPage.css';

/* ─── Reusable scroll-trigger wrapper ────────────────────────── */
function FadeInView({ children, delay = 0, direction = 'up', className = '' }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });

  const variants = {
    hidden: {
      opacity: 0,
      y: direction === 'up' ? 40 : direction === 'down' ? -40 : 0,
      x: direction === 'left' ? 40 : direction === 'right' ? -40 : 0,
    },
    visible: {
      opacity: 1,
      y: 0,
      x: 0,
      transition: { duration: 0.75, ease: [0.22, 1, 0.36, 1], delay },
    },
  };

  return (
    <motion.div
      ref={ref}
      variants={variants}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ─── SECTION 1 GRAPHIC: Document → Quiz Cards ───────────────── */
function GenerateGraphic() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-60px' });

  const docVariants = {
    hidden: { opacity: 0, scale: 0.85 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: 'easeOut' } },
  };

  const arrowVariants = {
    hidden: { opacity: 0, scaleY: 0 },
    visible: { opacity: 1, scaleY: 1, transition: { duration: 0.4, delay: 0.5, ease: 'easeOut' } },
  };

  const cardVariants = (i) => ({
    hidden: { opacity: 0, y: 30, scale: 0.8 },
    visible: {
      opacity: 1, y: 0, scale: 1,
      transition: { duration: 0.5, delay: 0.75 + i * 0.15, ease: [0.22, 1, 0.36, 1] },
    },
  });

  const cardColors = [
    { bg: 'rgba(124,58,237,0.1)', color: '#7c3aed' },
    { bg: 'rgba(37,99,235,0.1)', color: '#2563eb' },
    { bg: 'rgba(5,150,105,0.1)', color: '#059669' },
  ];

  const cardIcons = [
    <FileText size={14} />,
    <ClipboardList size={14} />,
    <CheckCircle size={14} />,
  ];

  return (
    <div ref={ref} className="lp-graphic-stage">
      <div className="s1-stage">
        {/* Source Document */}
        <motion.div
          className="s1-source-doc"
          variants={docVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          <FileText size={36} className="s1-doc-icon" />
          <div className="s1-doc-lines">
            <div className="s1-doc-line" />
            <div className="s1-doc-line" />
            <div className="s1-doc-line" />
          </div>
          <div style={{ position: 'absolute', top: 8, right: 8, fontSize: '0.55rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>
            MODULE 1.PDF
          </div>
        </motion.div>

        {/* Arrow Down */}
        <motion.div
          className="s1-arrow-down"
          variants={arrowVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          style={{ transformOrigin: 'top' }}
        >
          <ChevronRight
            size={20}
            style={{ transform: 'rotate(90deg)', color: '#94a3b8' }}
          />
        </motion.div>

        {/* Quiz Cards */}
        <div className="s1-quiz-cards">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="s1-quiz-card"
              variants={cardVariants(i)}
              initial="hidden"
              animate={isInView ? 'visible' : 'hidden'}
              whileHover={{ y: -6, boxShadow: '0 10px 28px rgba(0,0,0,0.12)' }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              <div
                className="s1-quiz-card-icon"
                style={{ background: cardColors[i].bg, color: cardColors[i].color }}
              >
                {cardIcons[i]}
              </div>
              <div className="s1-quiz-card-lines">
                <div className="s1-quiz-card-line" />
                <div className="s1-quiz-card-line" />
                <div className="s1-quiz-card-line" />
              </div>
              <div style={{ fontSize: '0.5rem', fontWeight: 600, color: '#94a3b8' }}>
                QUIZ {i + 1}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── SECTION 2 GRAPHIC: Left-Margin OCR Scan ───────────────── */
function ScanGraphic() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: '-60px' });

  // Each row: the handwritten answer in the left margin + question preview text
  const paperRows = [
    { answer: 'A',       question: '1. What is the primary...', badgeLabel: 'Correct' },
    { answer: 'C',       question: '2. Which element is found...', badgeLabel: '100%' },
    { answer: 'B',       question: '3. The process by which...', badgeLabel: 'Correct' },
    { answer: 'Nucleus', question: '4. Identify the organelle...', badgeLabel: 'Correct' },
    { answer: 'A',       question: '5. Which law states that...', badgeLabel: '100%' },
  ];

  // Beam cycles: 3s sweep + 1s pause
  const CYCLE = 3.6;

  return (
    <div ref={ref} className="lp-graphic-stage">
      <div className="s2-stage">
        <div className="s2-paper-wrap">
          {/* Paper */}
          <div className="s2-paper">
            <div className="s2-paper-header">QUIZ — Answer Sheet</div>

            {/* Column divider label */}
            <div className="s2-col-labels">
              <span className="s2-col-label-ans">Answer</span>
              <span className="s2-col-label-q">Question</span>
            </div>

            {paperRows.map((row, i) => (
              <div key={i} className="s2-paper-row">
                {/* Left margin — handwritten answer */}
                <div className="s2-margin-col">
                  <motion.span
                    className="s2-handwritten"
                    animate={isInView ? {
                      backgroundColor: [
                        'rgba(37,99,235,0)',
                        'rgba(37,99,235,0.18)',
                        'rgba(37,99,235,0)',
                      ],
                    } : { backgroundColor: 'rgba(37,99,235,0)' }}
                    transition={{
                      duration: 0.55,
                      delay: 0.55 + i * (CYCLE / paperRows.length),
                      repeat: Infinity,
                      repeatDelay: CYCLE - 0.55,
                      ease: 'easeInOut',
                    }}
                  >
                    {row.answer}
                  </motion.span>
                </div>

                {/* Divider line */}
                <div className="s2-margin-divider" />

                {/* Right — question text */}
                <div className="s2-question-col">
                  <span className="s2-question-text">{row.question}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Scanning Beam */}
          {isInView && (
            <motion.div
              className="s2-beam"
              initial={{ top: '18%' }}
              animate={{ top: '92%' }}
              transition={{
                duration: CYCLE * 0.8,
                ease: 'easeInOut',
                repeat: Infinity,
                repeatDelay: CYCLE * 0.2,
                repeatType: 'loop',
              }}
            />
          )}

          {/* Badges that pop up after beam passes each row */}
          {paperRows.map((row, i) =>
            isInView ? (
              <motion.div
                key={i}
                className="s2-badge"
                style={{ top: `${24 + i * 14}%` }}
                initial={{ opacity: 0, scale: 0.5, x: 10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                transition={{
                  duration: 0.35,
                  delay: 0.7 + i * (CYCLE / paperRows.length),
                  ease: [0.22, 1, 0.36, 1],
                  repeat: Infinity,
                  repeatDelay: CYCLE - 0.35,
                  repeatType: 'loop',
                }}
              >
                <div className="s2-badge-check">
                  <CheckCircle size={6} strokeWidth={3} />
                </div>
                {row.badgeLabel}
              </motion.div>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── SECTION 3 GRAPHIC: Teacher → Student Sync ─────────────── */
function SyncGraphic() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: '-60px' });

  const barHeights = [55, 70, 40, 85, 60, 75];

  return (
    <div ref={ref} className="lp-graphic-stage">
      <div className="s3-stage">
        {/* Teacher Dashboard */}
        <motion.div
          className="s3-dashboard"
          initial={{ opacity: 0, x: -30 }}
          animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="s3-dash-header">
            <div className="s3-dash-header-icon">
              <LayoutDashboard size={10} />
            </div>
            Teacher Dashboard
          </div>

          <div className="s3-stat-row">
            <div className="s3-stat-box">
              <div className="s3-stat-label">Students</div>
              <div className="s3-stat-value">42</div>
            </div>
            <div className="s3-stat-box">
              <div className="s3-stat-label">Avg Score</div>
              <div className="s3-stat-value" style={{ color: '#2563eb' }}>87%</div>
            </div>
          </div>

          <div className="s3-chart-bar-row">
            {barHeights.map((h, i) => (
              <motion.div
                key={i}
                className={`s3-chart-bar${i === 3 ? ' active' : ''}`}
                initial={{ height: 0 }}
                animate={isInView ? { height: `${h}%` } : { height: 0 }}
                transition={{ duration: 0.6, delay: 0.2 + i * 0.08, ease: 'easeOut' }}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </motion.div>

        {/* Data Stream */}
        <div className="s3-stream">
          <span className="s3-stream-label">syncing</span>

          {/* Line + animated packet */}
          <div className="s3-stream-line">
            {isInView && (
              <motion.div
                className="s3-packet"
                initial={{ left: '0%' }}
                animate={{ left: '100%' }}
                transition={{
                  duration: 1.2,
                  ease: 'easeInOut',
                  repeat: Infinity,
                  repeatDelay: 0.8,
                }}
              />
            )}
          </div>

          <span className="s3-stream-label">secure</span>
        </div>

        {/* Student Phone */}
        <motion.div
          className="s3-phone"
          initial={{ opacity: 0, x: 30 }}
          animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="s3-phone-notch" />
          <div className="s3-phone-screen">
            <div className="s3-phone-top-bar">ScanMine</div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="s3-phone-row">
                <div className="s3-phone-avatar">
                  <Users size={7} color="#2563eb" />
                </div>
                <div className="s3-phone-name-stack">
                  <div className={`s3-phone-name-line wide`} />
                  <div className={`s3-phone-name-line mid`} />
                </div>
                <span className="s3-phone-score">{[92, 85, 97][i]}%</span>
              </div>
            ))}
          </div>

          {/* Notification badge */}
          {isInView && (
            <motion.div
              className="s3-notification"
              initial={{ opacity: 0, scale: 0 }}
              animate={{
                opacity: [0, 1, 1, 1, 0],
                scale: [0, 1.2, 1, 1, 0],
              }}
              transition={{
                duration: 1.8,
                delay: 1.6,
                repeat: Infinity,
                repeatDelay: 1.2,
                times: [0, 0.15, 0.3, 0.85, 1],
              }}
            >
              1
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

/* ─── Main Landing Page ──────────────────────────────────────── */
export default function LandingPage() {

  return (
    <div className="lp-root">

      {/* ── Nav ── */}
      <nav className="lp-nav">
        <div className="lp-nav-logo">
          <div className="lp-nav-logo-icon">
            <ScanLine size={16} />
          </div>
          ScanMine
        </div>
        <div className="lp-nav-actions">
          <Link to="/login" className="lp-nav-link">Sign In</Link>
          <Link to="/login" className="lp-nav-cta">Get Started</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          {/* Badge */}
          <motion.div
            className="lp-hero-badge"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Zap size={11} />
            Powered by Computer Vision
          </motion.div>

          {/* Headline */}
          <motion.h1
            className="lp-hero-headline"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
          >
            Automate Grading.<br />
            <span>Empower Students.</span>
          </motion.h1>

          {/* Sub */}
          <motion.p
            className="lp-hero-sub"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.45 }}
          >
            ScanMine turns your materials into structured quizzes, grades
            handwritten answer sheets instantly, and delivers live analytics
            directly to every student.
          </motion.p>

          {/* CTAs */}
          <motion.div
            className="lp-hero-actions"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.6 }}
          >
            <Link to="/login" className="lp-btn-primary">
              Get Started
              <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="lp-btn-secondary">
              Sign In
            </Link>
          </motion.div>

          {/* Mini trust cards */}
          <motion.div
            className="lp-hero-cards"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.9 }}
          >
            {[
              { icon: <Zap size={14} />, label: 'Instant Grading', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
              { icon: <ShieldCheck size={14} />, label: 'Secure & Private', color: '#059669', bg: 'rgba(5,150,105,0.1)' },
              { icon: <Users size={14} />, label: 'Multi-Role Access', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
              { icon: <BarChart2 size={14} />, label: 'Live Analytics', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
            ].map((c, i) => (
              <motion.div
                key={i}
                className="lp-mini-card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.0 + i * 0.08, duration: 0.4 }}
                whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}
              >
                <div className="lp-mini-card-icon" style={{ background: c.bg, color: c.color }}>
                  {c.icon}
                </div>
                {c.label}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <div className="lp-divider" />

      {/* ══════════════════════════════════════════════════
          SECTION 1 — GENERATE
          ══════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <FadeInView delay={0} direction="right">
            <span className="lp-section-label s1-label">
              <FileText size={11} />
              Generate
            </span>
            <h2 className="lp-section-heading">
              Instantly convert your materials into structured assessments.
            </h2>
            <p className="lp-section-body">
              Upload any PDF or document and let ScanMine's AI engine extract key
              concepts, build multiple-choice questions, and produce a print-ready
              quiz  in seconds, not hours.
            </p>
            <ul className="lp-section-bullets">
              {[
                'PDF, DOCX, and plain-text support',
                'Multiple question types: MC, identification, true/false',
                'Editable answer key before printing',
              ].map((b, i) => (
                <li key={i}>
                  <div className="lp-bullet-dot s1-bullet-dot">
                    <CheckCircle size={12} />
                  </div>
                  {b}
                </li>
              ))}
            </ul>
          </FadeInView>

          <FadeInView delay={0.15} direction="left">
            <GenerateGraphic />
          </FadeInView>
        </div>
      </section>

      <div className="lp-divider" />

      {/* ══════════════════════════════════════════════════
          SECTION 2 — SCAN
          ══════════════════════════════════════════════════ */}
      <section className="lp-section s2-bg">
        <div className="lp-section-inner reverse">
          <FadeInView delay={0} direction="left">
            <span className="lp-section-label s2-label">
              <ScanLine size={11} />
              Scan
            </span>
            <h2 className="lp-section-heading">
              Grade handwritten papers in seconds with Computer Vision.
            </h2>
            <p className="lp-section-body">
              Point your camera at any filled-out answer sheet. ScanMine's OCR instantly
              extracts handwritten letters and words from the left margin, matches them
              against your custom answer key, and computes scores automatically.
            </p>
            <ul className="lp-section-bullets">
              {[
                'Advanced OCR for handwritten letters and text',
                'Supports both Multiple Choice and Identification exams',
                'Handles poor lighting and slight skew from mobile captures',
              ].map((b, i) => (
                <li key={i}>
                  <div className="lp-bullet-dot s2-bullet-dot">
                    <CheckCircle size={12} />
                  </div>
                  {b}
                </li>
              ))}
            </ul>
          </FadeInView>

          <FadeInView delay={0.15} direction="right">
            <ScanGraphic />
          </FadeInView>
        </div>
      </section>

      <div className="lp-divider" />

      {/* ══════════════════════════════════════════════════
          SECTION 3 — SYNC
          ══════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <FadeInView delay={0} direction="right">
            <span className="lp-section-label s3-label">
              <BarChart2 size={11} />
              Sync
            </span>
            <h2 className="lp-section-heading">
              Instant analytics and secure student sync.
            </h2>
            <p className="lp-section-body">
              The moment grading is complete, every student's score syncs to their
              personal dashboard. Teachers see class-wide distributions; students
              see their individual performance  all in real time.
            </p>
            <ul className="lp-section-bullets">
              {[
                'Live grade distribution charts',
                'Per-student score history and trends',
                'Role-based access: teachers vs. students',
              ].map((b, i) => (
                <li key={i}>
                  <div className="lp-bullet-dot s3-bullet-dot">
                    <CheckCircle size={12} />
                  </div>
                  {b}
                </li>
              ))}
            </ul>
          </FadeInView>

          <FadeInView delay={0.15} direction="left">
            <SyncGraphic />
          </FadeInView>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          SECTION 4 — ACKNOWLEDGMENTS
          ══════════════════════════════════════════════════ */}
      <section className="lp-section advisers-bg">
        <div className="lp-section-inner-full">
          <FadeInView delay={0.1} direction="up" className="lp-section-header-center">
            <span className="lp-section-label advisers-label">
              <Users size={11} />
              Acknowledgments
            </span>
            <h2 className="lp-section-heading">Project Advisers</h2>
            <p className="lp-section-body">
              Special thanks to the mentors and partners who guided the development of ScanMine.
            </p>
          </FadeInView>

          <div className="lp-advisers-grid">
            {[
              { role: 'Research Adviser', name: 'Ms. Armilyn Martinez' },
              { role: 'Thesis Adviser', name: 'Kenneth V. Bautista' },
              { role: 'Technical Adviser', name: 'Chris Allen Pineda' },
              { role: 'Beneficiary', name: 'Sir Heal Ryan G. Banaylo' },
            ].map((adv, i) => (
              <FadeInView key={i} delay={0.2 + i * 0.1} direction="up">
                <div className="lp-adviser-card">
                  <span className="lp-adviser-role">{adv.role}</span>
                  <h3 className="lp-adviser-name">{adv.name}</h3>
                </div>
              </FadeInView>
            ))}
          </div>
        </div>
      </section>

      <div className="lp-divider" />

      {/* ══════════════════════════════════════════════════
          SECTION 5 — MEET THE DEVELOPERS
          ══════════════════════════════════════════════════ */}
      <section className="lp-section devs-bg">
        <div className="lp-section-inner-full">
          <FadeInView delay={0.1} direction="up" className="lp-section-header-center">
            <span className="lp-section-label devs-label">
              <Zap size={11} />
              System Architects
            </span>
            <h2 className="lp-section-heading">Meet the Developers</h2>
          </FadeInView>

          <div className="lp-devs-container">
            {[
              {
                name: 'Jon Zeph Glodoviza',
                role: 'Lead Developer / System Architect',
                image: 'JZ',
              },
              {
                name: 'Justin Laguatan',
                role: 'Developer / UI/UX',
                image: 'JL',
              },
            ].map((dev, i) => (
              <FadeInView key={i} delay={0.3 + i * 0.15} direction="up" className="lp-dev-card-wrapper">
                <div className="lp-dev-card">
                  <div className="lp-dev-card-inner">
                    <div className="lp-dev-avatar">
                      {dev.image}
                    </div>
                    <div className="lp-dev-info">
                      <span className="lp-dev-role">{dev.role}</span>
                      <h3 className="lp-dev-name">{dev.name}</h3>
                    </div>
                  </div>
                  <div className="lp-dev-card-glow" />
                </div>
              </FadeInView>
            ))}
          </div>
        </div>
      </section>

      <div className="lp-divider" />

      {/* ── CTA Banner ── */}

      <section className="lp-cta-section">
        <motion.h2
          className="lp-cta-heading"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          Ready to transform your classroom?
        </motion.h2>
        <motion.p
          className="lp-cta-sub"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          Join teachers already saving hours every week with ScanMine.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <Link to="/login" className="lp-cta-btn">
            Get Started Free
            <ArrowRight size={16} />
          </Link>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <span className="lp-footer-brand">ScanMine</span>
        <span className="lp-footer-copy">
          &copy; {new Date().getFullYear()} ScanMine. Automated Answer Sheet
          Checking &amp; Quiz Generator.
        </span>
      </footer>
    </div>
  );
}
