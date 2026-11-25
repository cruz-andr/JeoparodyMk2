import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { warmUp } from './services/api/jeopardyService';

// Wake the server, and fetch today's board, before any page asks for it.
warmUp();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
