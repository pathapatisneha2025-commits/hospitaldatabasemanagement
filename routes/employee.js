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
      mobile,
      familyNumber,
      age,
      experience,
      bloodGroup,
      aadhar,
      pan,
      esiNumber,
      reportingManager,
      department,
      role,
      dob,
      scheduleIn,
      scheduleOut,
      breakTime,
      monthlySalary,
      jobDescription,
      employmentType,
      category,
      ifsc,
      branchName,
      bankName,
      accountNumber,
      temporaryAddresses,
      permanentAddresses,
      dateOfJoining
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

    // store the uploaded image as 'image'
    const image = file.path;

    // safely handle JSON fields
    const tempAddresses = temporaryAddresses 
      ? JSON.stringify(JSON.parse(temporaryAddresses)) 
      : null;

    const permAddresses = permanentAddresses 
      ? JSON.stringify(JSON.parse(permanentAddresses)) 
      : null;

    const result = await pool.query(
      `INSERT INTO employees (
        full_name, email, password, mobile, family_number,
        age, experience, blood_group, aadhar, pan, esi_number,
        reporting_manager, department, role, dob, schedule_in, schedule_out, break_time,
        monthly_salary, job_description, employment_type, category,
        ifsc, branch_name, bank_name, account_number,
        image, temporary_addresses, permanent_addresses, date_of_joining,
        status
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22,
        $23, $24, $25, $26,
        $27, $28, $29, $30,
        $31
      )
      RETURNING *`,
      [
        fullName,
        email,
        hashedPassword,
        mobile,
        familyNumber,
        age,
        experience,
        bloodGroup,
        aadhar,
        pan,
        esiNumber,
        reportingManager,
        department,
        role,
        dob,
        scheduleIn,
        scheduleOut,
        breakTime,
        monthlySalary,
        jobDescription,
        employmentType,
        category,
        ifsc,
        branchName,
        bankName,
        accountNumber,
        image,       // uploaded image
        tempAddresses,
        permAddresses,
        dateOfJoining,
        "pending"
      ]
    );

    res.status(201).json({ success: true, employee: result.rows[0] });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});


router.post("/update-status", async (req, res) => {
  try {
    const { id, status } = req.body;

    if (!id || !status) {
      return res.status(400).json({ error: "Employee ID and status are required" });
    }

    const result = await pool.query(
      "UPDATE employees SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json({ message: `Employee ${status}`, employee: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// Employee login
// routes/auth.js
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await pool.query("SELECT * FROM employees WHERE email = $1", [email]);

    if (user.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const employee = user.rows[0];

    // ✅ check approval status
    if (employee.status !== "approved") {
      return res.status(403).json({ error: "Account not approved yet" });
    }

    // 🔑 check hashed password
    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // ✅ login success
    res.json({ message: "Login successful", employee });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});



router.post('/forgot-password', async (req, res) => {
  const { employeeId, email, newPassword, confirmNewPassword } = req.body;

  try {
    // 1. Validate input
    if (!employeeId || !email || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    // 2. Check if user exists with matching employee ID and email
    const userResult = await pool.query(
      'SELECT * FROM employees WHERE id = $1 AND email = $2',
      [employeeId, email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found with provided Employee ID and Email' });
    }

    // 3. Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 4. Update password in database
    await pool.query(
      'UPDATE employees SET password = $1 WHERE id = $2 AND email = $3',
      [hashedPassword, employeeId, email]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error resetting password:', error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;




// Fetch all employees
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM employees`);

    const employees = result.rows.map(emp => ({
      ...emp,
      temporary_addresses: emp.temporary_addresses
        ? typeof emp.temporary_addresses === 'string'
          ? JSON.parse(emp.temporary_addresses)
          : emp.temporary_addresses
        : [],
      permanent_addresses: emp.permanent_addresses
        ? typeof emp.permanent_addresses === 'string'
          ? JSON.parse(emp.permanent_addresses)
          : emp.permanent_addresses
        : []
    }));

    res.status(200).json({ success: true, employees });
  } catch (error) {
    console.error('Error fetching employees:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});


// Fetch employee by ID
// Fetch employee by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM employees WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const emp = result.rows[0];

    // Parse addresses just like in /all route
    const employee = {
      ...emp,
      temporary_addresses: emp.temporary_addresses
        ? typeof emp.temporary_addresses === 'string'
          ? JSON.parse(emp.temporary_addresses)
          : emp.temporary_addresses
        : [],
      permanent_addresses: emp.permanent_addresses
        ? typeof emp.permanent_addresses === 'string'
          ? JSON.parse(emp.permanent_addresses)
          : emp.permanent_addresses
        : []
    };

    res.status(200).json({ success: true, employee });
  } catch (error) {
    console.error('Error fetching employee by ID:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});


router.put('/update/:id', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const {
    fullName,
    email,
    password,
    confirmPassword,
    mobile,
    familyNumber,
    age,
    experience,
    bloodGroup,
    aadhar,
    pan,
    esiNumber,
    reportingManager,
    department,
    role,
    dob,
    scheduleIn,
    scheduleOut,
    breakTime,
    monthlySalary,
    jobDescription,
    employmentType,
    category,
    ifsc,
    branchName,
    bankName,
    accountNumber,
    temporaryAddresses,
    permanentAddresses,
    dateOfJoining
  } = req.body;

  const file = req.file;

  try {
    // Fetch existing employee
    const existingRes = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    const existingEmployee = existingRes.rows[0];

    // Handle image
    const imageUrl = file ? file.path : existingEmployee.image;

    // Handle password
    let hashedPassword = existingEmployee.password;
    if (password && confirmPassword) {
      if (password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Password and Confirm Password do not match' });
      }
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Handle addresses safely (string or object)
    const tempAddresses = temporaryAddresses
      ? typeof temporaryAddresses === 'string'
        ? JSON.stringify(JSON.parse(temporaryAddresses))
        : JSON.stringify(temporaryAddresses)
      : existingEmployee.temporary_addresses;

    const permAddresses = permanentAddresses
      ? typeof permanentAddresses === 'string'
        ? JSON.stringify(JSON.parse(permanentAddresses))
        : JSON.stringify(permanentAddresses)
      : existingEmployee.permanent_addresses;

    // Update employee
    const updateRes = await pool.query(
      `UPDATE employees
       SET full_name = $1,
           email = $2,
           password = $3,
           mobile = $4,
           family_number = $5,
           age = $6,
           experience = $7,
           blood_group = $8,
           aadhar = $9,
           pan = $10,
           esi_number = $11,
           reporting_manager = $12,
           department = $13,
           role = $14,
           dob = $15,
           schedule_in = $16,
           schedule_out = $17,
           break_time = $18,
           monthly_salary = $19,
           job_description = $20,
           employment_type = $21,
           category = $22,
           ifsc = $23,
           branch_name = $24,
           bank_name = $25,
           account_number = $26,
           image = $27,
           temporary_addresses = $28,
           permanent_addresses = $29,
           date_of_joining = $30
       WHERE id = $31
       RETURNING *`,
      [
        fullName || existingEmployee.full_name,
        email || existingEmployee.email,
        hashedPassword,
        mobile || existingEmployee.mobile,
        familyNumber || existingEmployee.family_number,
        age || existingEmployee.age,
        experience || existingEmployee.experience,
        bloodGroup || existingEmployee.blood_group,
        aadhar || existingEmployee.aadhar,
        pan || existingEmployee.pan,
        esiNumber || existingEmployee.esi_number,
        reportingManager || existingEmployee.reporting_manager,
        department || existingEmployee.department,
        role || existingEmployee.role,
        dob || existingEmployee.dob,
        scheduleIn || existingEmployee.schedule_in,
        scheduleOut || existingEmployee.schedule_out,
        breakTime || existingEmployee.break_time,
        monthlySalary || existingEmployee.monthly_salary,
        jobDescription || existingEmployee.job_description,
        employmentType || existingEmployee.employment_type,
        category || existingEmployee.category,
        ifsc || existingEmployee.ifsc,
        branchName || existingEmployee.branch_name,
        bankName || existingEmployee.bank_name,
        accountNumber || existingEmployee.account_number,
        imageUrl,
        tempAddresses,
        permAddresses,
        dateOfJoining || existingEmployee.date_of_joining,
        id
      ]
    );

    const updatedEmployee = updateRes.rows[0];

    // Parse addresses before returning
    updatedEmployee.temporary_addresses = updatedEmployee.temporary_addresses
      ? JSON.parse(updatedEmployee.temporary_addresses)
      : [];
    updatedEmployee.permanent_addresses = updatedEmployee.permanent_addresses
      ? JSON.parse(updatedEmployee.permanent_addresses)
      : [];

    res.json({ success: true, employee: updatedEmployee });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


// Delete employee by ID
router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Check if employee exists
    const existing = await pool.query("SELECT * FROM employees WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    // Delete employee
    await pool.query("DELETE FROM employees WHERE id = $1", [id]);

    res.json({ success: true, message: "Employee deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});



module.exports = router;
