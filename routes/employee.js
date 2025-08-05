const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer local storage config with file filter
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // uploads/ folder
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported image type'));
  }
};

const upload = multer({ storage, fileFilter });

// ✅ Register new employee
router.post('/register', (req, res, next) => {
  upload.single('image')(req, res, function (err) {
    if (err instanceof multer.MulterError || err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
}, async (req, res) => {
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

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;

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

// ✅ Employee login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      `SELECT * FROM employees WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const employee = result.rows[0];

    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

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

// ✅ Fetch all employees
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, department, role, dob, image FROM employees'
    );
    res.status(200).json({ success: true, employees: result.rows });
  } catch (error) {
    console.error('Error fetching employees:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
