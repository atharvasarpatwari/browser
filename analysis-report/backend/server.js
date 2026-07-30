const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 4567;

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..')));

app.use('/api', routes);

app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Analysis Report Server running at http://localhost:${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
});
