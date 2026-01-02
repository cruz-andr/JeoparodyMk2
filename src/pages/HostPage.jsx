import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import './PlaceholderPage.css';

export default function HostPage() {
  const navigate = useNavigate();

  return (
    <div className="placeholder-page">
      <motion.div
        className="placeholder-content"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="placeholder-icon">🎓</span>
        <h1>Host Mode</h1>
        <p className="placeholder-description">
          Educator mode - create custom games with your own questions.
          <br />
          Perfect for classrooms and team building.
          <br />
          <br />
          <strong>Coming Soon!</strong>
          <br />
          This feature requires the multiplayer backend to be implemented.
        </p>
        <button onClick={() => navigate('/menu')} className="btn-primary">
          Back to Menu
        </button>
      </motion.div>
    </div>
  );
}
