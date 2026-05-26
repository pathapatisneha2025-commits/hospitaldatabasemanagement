const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config();
// const JWT_SECRET = process.env.JWT_SECRET;
// const authenticateJWT = require('../middleware/auth');
const { Parser } = require("json2csv");
const ExcelJS = require("exceljs");
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

router.get("/export", async (req, res) => {
  try {
    const query = `SELECT * FROM employees ORDER BY id ASC`;
    const result = await pool.query(query);
    const employees = result.rows;

    if (!employees || employees.length === 0) {
      return res.status(404).json({ success: false, message: "No employees found" });
    }
 const formatted = employees.map(emp => {
  // Excel-friendly date inside map
  const doj = emp.date_of_joining ? new Date(emp.date_of_joining) : null;
  const excelDate = doj
    ? `="${doj.getFullYear()}-${String(doj.getMonth() + 1).padStart(2, "0")}-${String(doj.getDate()).padStart(2, "0")}"`
    : "";

  return {
    id: emp.id,
    full_name: emp.full_name,
    email: emp.email,
    mobile: emp.mobile,
    family_number: emp.family_number,
    department: emp.department,
    role: emp.role,
    blood_group: emp.blood_group,
    age: emp.age,
    experience: emp.experience,
    monthly_salary: emp.monthly_salary,
    employment_type: emp.employment_type,
    category: emp.category,
    reporting_manager: emp.reporting_manager,
    aadhar: emp.aadhar,
    pan: emp.pan,
    esi_number: emp.esi_number,
    bank_name: emp.bank_name,
    account_number: emp.account_number,
    ifsc: emp.ifsc,
    branch_name: emp.branch_name,
    temporary_addresses: emp.temporary_addresses
      ? emp.temporary_addresses.map(a => `${a.street}, ${a.city}, ${a.state} - ${a.pincode}`).join(" | ")
      : "",
    permanent_addresses: emp.permanent_addresses
      ? emp.permanent_addresses.map(b => `${b.street}, ${b.city}, ${b.state} - ${b.pincode}`).join(" | ")
      : "",
    schedule_in: emp.schedule_in,
    schedule_out: emp.schedule_out,
    break_in: emp.break_in,
    break_out: emp.break_out,
    date_of_joining: excelDate, // ✅ use formatted Excel date
    status: emp.status,
  };
});


    const json2csvParser = new Parser();
    const csv = json2csvParser.parse(formatted);

    res.header("Content-Type", "text/csv");
    res.attachment("employees.csv");
    return res.send(csv);

  } catch (error) {
    console.error("CSV export error", error);
    return res.status(500).json({ success: false, error: "Failed to export employees" });
  }
});
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
     breakIn,      // renamed column
      breakOut,
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
        reporting_manager, department, role, dob, schedule_in, schedule_out, break_in, break_out,
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
        $31,$32
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
         breakIn,
        breakOut,
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
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await pool.query("SELECT * FROM employees WHERE email = $1", [email]);
    if (user.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const employee = user.rows[0];

    if (employee.status !== "approved") {
      return res.status(403).json({ error: "Account not approved yet" });
    }

    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // No JWT, just return employee details directly
    res.json({
      message: "Login successful",
      employee, // send employee data
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});




router.post('/forgot-password', async (req, res) => {
  const { email, newPassword, confirmNewPassword } = req.body;

  try {
    // 1. Validate input
    if (!email || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    // 2. Check if user exists
    const userResult = await pool.query(
      'SELECT * FROM employees WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found with provided email' });
    }

    // 3. Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 4. Update password in database
    await pool.query(
      'UPDATE employees SET password = $1 WHERE email = $2',
      [hashedPassword, email]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error resetting password:', error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});



// Get all employees with pending update
router.get("/pending_approve_update", async (req, res) => {
  try {
    // Fetch all employees with pending or approved updates
    const result = await pool.query(
      `SELECT id, full_name, email, department, role, pending_approve_update AS status
       FROM employees
       WHERE pending_approve_update IN ('pending', 'approved')
       ORDER BY full_name`
    );

    res.json({ success: true, employees: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});




// Fetch all employees
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM employees`);
    const employees = result.rows; // this contains all employees

    res.status(200).json({ success: true, employees });
  } catch (error) {
    console.error('Error fetching employees:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});



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
  console.log("FILE:", req.file);
  console.log("BODY:", req.body);
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
    breakIn,
    breakOut,
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
let imageUrl = existingEmployee.image;

if (req.file && req.file.path) {
  imageUrl = req.file.path;
}
    // Handle password
    let hashedPassword = existingEmployee.password;
    if (password && confirmPassword) {
      if (password !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Password and Confirm Password do not match' });
      }
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Handle addresses safely (as objects)
    const tempAddresses = temporaryAddresses 
      ? JSON.stringify(JSON.parse(temporaryAddresses)) 
      : null;

    const permAddresses = permanentAddresses 
      ? JSON.stringify(JSON.parse(permanentAddresses)) 
      : null;

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
           break_in = $18,
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
           date_of_joining = $30,
           break_out = $31
       WHERE id = $32
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
        breakIn|| existingEmployee.break_in,
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
        breakOut|| existingEmployee.break_out,

        id
      ]
    );

    const updatedEmployee = updateRes.rows[0];

    // No need to parse addresses; they are already objects
    res.json({ success: true, employee: updatedEmployee });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.put('/pending-update/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      "UPDATE employees SET pending_approve_update='pending' WHERE id=$1",
      [id]
    );
    res.json({ success: true, message: "Update request pending approval" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put('/approve-update/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      "UPDATE employees SET pending_approve_update='approved' WHERE id=$1",
      [id]
    );
    res.json({ success: true, message: "Update approved" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
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

router.post('/cashhandover/add', async (req, res) => {
  try {
    const { handedBy, receiver, receiverName, amount, date } = req.body;

    // Basic validation
    if (!handedBy || !receiver || !receiverName || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid data provided' });
    }

    const query = `
      INSERT INTO dailybookingscash_handover 
      (handed_by, receiver, receiver_name, amount, handover_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [handedBy, receiver, receiverName, amount, date || new Date()];

    const result = await pool.query(query, values);

    return res.status(201).json({ success: true, handover: result.rows[0] });
  } catch (err) {
    console.error('Cash handover error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
// GET /cashhandover - Fetch all handovers (for admin)
router.get('/cashhandover/all', async (req, res) => {
  try {
    const query = `
      SELECT * FROM dailybookingscash_handover
      ORDER BY handover_date DESC
    `;
    const result = await pool.query(query);
    return res.status(200).json({ success: true, handovers: result.rows });
  } catch (err) {
    console.error('Fetch cash handovers error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/cashhandover/:employeeId', async (req, res) => {
  const { employeeId } = req.params;

  try {
    const query = `
      SELECT 
        id,
        handed_by,
        receiver,
        amount,
        handover_date,
        receiver_name,
        status
      FROM dailybookingscash_handover
      WHERE handed_by = $1
      ORDER BY handover_date DESC
    `;

    const { rows } = await pool.query(query, [employeeId]);

    return res.json({
      success: true,
      handovers: rows,
    });
  } catch (err) {
    console.error('Error fetching handovers by employee:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.post('/complete/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Update the status to 'complete'
    const update = await pool.query(
      'UPDATE dailybookingscash_handover SET status = $1 WHERE id = $2 RETURNING *',
      ['complete', id]
    );

    if (update.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Handover not found' });
    }

    res.json({ success: true, message: 'Handover marked as complete', handover: update.rows[0] });
  } catch (err) {
    console.error('Error marking handover complete:', err);
    res.status(500).json({ success: false, message: 'Failed to update handover' });
  }
});
// ⭐ EXPORT EMPLOYEES AS CSV
  


module.exports = router;
