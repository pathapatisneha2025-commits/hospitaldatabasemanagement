// routes/employee.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// Register new employee
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, password, department, role, dob, image } = req.body;

    const result = await pool.query(
      `INSERT INTO employees
        (full_name, email, password, department, role, dob, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [fullName, email, password, department, role, dob, image]
    );

    res.status(201).json({ success: true, employee: result.rows[0] });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
