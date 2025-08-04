// index.js
require('dotenv').config(); // Load env vars

const express = require('express');
const cors = require('cors');
const employeeRoutes = require('./routes/employee');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use('employee', employeeRoutes);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
