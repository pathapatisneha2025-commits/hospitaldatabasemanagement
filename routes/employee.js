const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary");

router.get('/', (req, res) => {
  res.send('Employee API is working!');
});

// Register new employee


// Create upload directory if it doesn't exist
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "employee", // Optional folder name in Cloudinary
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => Date.now() + "-" + file.originalname,
  },
});

const upload = multer({ storage });

router.post('/register', upload.single('image'), async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      confirmPassword,
      department,
      role,
      dob
    } = req.body;

    const imageFile = req.file; // ✅ Corrected

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password and Confirm Password do not match",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const imageUrl = imageFile?.path || null; // ✅ Corrected

    const result = await pool.query(
      `INSERT INTO employees 
        (full_name, email, password, department, role, dob, image)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [fullName, email, hashedPassword, department, role, dob, imageUrl]
    );

    res.status(201).json({ success: true, employee: result.rows[0] });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});


// Employee login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Check if employee exists
    const result = await pool.query(
      `SELECT * FROM employees WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const employee = result.rows[0];

    // 2. Compare hashed password
    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // 3. Success response (you can add token later if needed)
    res.status(200).json({
      success: true,
      message: "Login successful",
      employee: {
        id: employee.id,
        fullName: employee.full_name,
        email: employee.email,
        department: employee.department,
        role: employee.role,
        dob: employee.dob,
        image: employee.image
      }
    });

  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Fetch all employees
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, full_name, email, department, role, dob, image FROM employees');
    res.status(200).json({ success: true, employees: result.rows });
  } catch (error) {
    console.error('Error fetching employees:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});


module.exports = router;
