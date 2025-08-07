const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary");
// Create uploads directory if it doesn't exist
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "employee",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => {
      const nameWithoutExt = path.parse(file.originalname).name;
      return Date.now() + "-" + nameWithoutExt;
    },
  },
});

const upload = multer({ storage });

// Register new employee
router.post('/register', upload.single('image'), async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      confirmPassword,
      department,
      role,
      dob,
    } = req.body;

    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and Confirm Password do not match',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const imageUrl =file.path;// Local image path to be served

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

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    // 1. Check if user exists
    const user = await pool.query('SELECT * FROM employees WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // 2. Generate a secure token and expiry time
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    // 3. Store token and expiry in database
    await pool.query(
      'UPDATE employees SET reset_token = $1, reset_token_expires = $2 WHERE email = $3',
      [token, expiresAt, email]
    );

    // 4. Construct the reset password link
    const resetLink = `http://localhost:3000/reset-password?token=${token}`;

    // 5. Configure the email transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });
    // 6. Send the reset email
    await transporter.sendMail({
      to: email,
      subject: 'Password Reset',
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password. This link is valid for 1 hour.</p>`,
    });

    // 7. Respond to client
    res.json({ message: 'Password reset email sent' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Internal server error' });
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
