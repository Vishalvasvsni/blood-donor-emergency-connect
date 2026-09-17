require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

require('./config/db'); // initializes schema on startup

const authRoutes = require('./routes/auth');
const donorRoutes = require('./routes/donors');
const requestRoutes = require('./routes/requests');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/donors', donorRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Blood Donor Emergency Connect' }));

// Fallback to index.html for any non-API route (simple SPA-style routing not
// required here since we use static multi-page HTML, but this keeps deep
// links to unknown paths friendly)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(`🩸 Blood Donor Emergency Connect running at http://localhost:${PORT}`);
});
