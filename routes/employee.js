const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db');

router.get('/', (req, res) => {
  res.send('Employee API is working!');
});

// Register new employee
router.post('/register', async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      confirmPassword,
      department,
      role,
      dob,
      image
    } = req.body;

    // ✅ Check if password and confirmPassword match
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password and Confirm Password do not match",
      });
    }

    // ✅ Hash the password using bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // ✅ Insert employee with hashed password
    const result = await pool.query(
      `INSERT INTO employees
        (full_name, email, password, department, role, dob, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [fullName, email, hashedPassword, department, role, dob, image]
    );

    res.status(201).json({ success: true, employee: result.rows[0] });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
