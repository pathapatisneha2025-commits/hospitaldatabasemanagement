// routes/doctorRoutes.js
const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");

const router = express.Router();


// -------------------
// Doctor Registration
// -------------------
router.post("/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      confirmPassword,
      phoneNumber,
      department,
      role,
      gender,
      experience,
      description,
      scheduleIn,
      scheduleOut
    } = req.body;

    // Validation
    if (
      !name ||
      !email ||
      !password ||
      !confirmPassword ||
      !phoneNumber ||
      !department ||
      !role ||
      !gender ||
      !experience ||
      !description ||
      !scheduleIn ||
      !scheduleOut
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    // Check existing doctor
    const existingDoctor = await db.query(
      "SELECT * FROM doctors WHERE email=$1",
      [email]
    );

    if (existingDoctor.rows.length > 0) {
      return res.status(400).json({ error: "Doctor with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // INSERT with STATUS (default = pending)
    const newDoctor = await db.query(
      `INSERT INTO doctors 
        (name, email, password, phone_number, department, role, gender, experience, description, schedule_in, schedule_out, status)
       VALUES 
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
       RETURNING 
        id, name, email, phone_number, department, role, gender, experience, description, schedule_in, schedule_out, status`,
      [
        name,
        email,
        hashedPassword,
        phoneNumber,
        department,
        role,
        gender,
        experience,
        description,
        scheduleIn,
        scheduleOut
      ]
    );

    res.status(201).json({
      message: "Doctor registered successfully",
      doctor: newDoctor.rows[0],
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Doctor Login
// -------------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const doctor = await db.query("SELECT * FROM doctors WHERE email=$1", [email]);

    if (doctor.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const validPassword = await bcrypt.compare(password, doctor.rows[0].password);
    if (!validPassword) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    res.json({
      message: "Login successful",
      doctor: {
        id: doctor.rows[0].id,
        name: doctor.rows[0].name,
        email: doctor.rows[0].email,
        phoneNumber: doctor.rows[0].phone_number,
        department: doctor.rows[0].department,
        role: doctor.rows[0].role,
        gender: doctor.rows[0].gender,
        experience: doctor.rows[0].experience,
        description: doctor.rows[0].description,
        scheduleIn: doctor.rows[0].schedule_in,
        scheduleOut: doctor.rows[0].schedule_out,
        status:doctor.rows[0].status,
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Forgot Password
// -------------------
router.post("/forgot-password", async (req, res) => {
  try {
    const { email, newPassword, confirmNewPassword } = req.body;

    if (!email || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    const doctor = await db.query("SELECT * FROM doctors WHERE email=$1", [email]);

    if (doctor.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found with this email" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      "UPDATE doctors SET password=$1 WHERE email=$2",
      [hashedPassword, email]
    );

    res.json({ message: "Password updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Get All Doctors
// -------------------
router.get("/all", async (req, res) => {
  try {
    const doctors = await db.query(
      `SELECT 
        id, name, email, phone_number, department, role, gender, 
        experience, description, schedule_in, schedule_out,status
       FROM doctors`
    );

    res.json(doctors.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Get Doctor by ID
// -------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const doctor = await db.query(
      `SELECT 
        id, name, email, phone_number, department, role, gender, 
        experience, description, schedule_in, schedule_out 
       FROM doctors WHERE id=$1`,
      [id]
    );

    if (doctor.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    res.json(doctor.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Update Doctor
// -------------------
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      email,
      phoneNumber,
      department,
      role,
      gender,
      experience,
      description,
      scheduleIn,
      scheduleOut,
      password
    } = req.body;

    const doctor = await db.query("SELECT * FROM doctors WHERE id=$1", [id]);

    if (doctor.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    let hashedPassword = doctor.rows[0].password;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const updatedDoctor = await db.query(
      `UPDATE doctors SET 
        name=$1, email=$2, phone_number=$3, department=$4, role=$5, gender=$6,
        experience=$7, description=$8, schedule_in=$9, schedule_out=$10, password=$11
       WHERE id=$12
       RETURNING 
        id, name, email, phone_number, department, role, gender, 
        experience, description, schedule_in, schedule_out`,
      [
        name,
        email,
        phoneNumber,
        department,
        role,
        gender,
        experience,
        description,
        scheduleIn,
        scheduleOut,
        hashedPassword,
        id
      ]
    );

    res.json({
      message: "Doctor updated successfully",
      doctor: updatedDoctor.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Delete Doctor
// -------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const doctor = await db.query("SELECT * FROM doctors WHERE id=$1", [id]);
    if (doctor.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    await db.query("DELETE FROM doctors WHERE id=$1", [id]);

    res.json({ message: "Doctor deleted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------------------
// Appointment Summary (Daily/Weekly/Monthly)
// -------------------------------
router.get("/appointments/summary/:doctorId", async (req, res) => {
  try {
    const { doctorId } = req.params;

    const query = `
      SELECT
        (
          SELECT COUNT(*) 
          FROM (
            SELECT appointment_date AS appt_date 
            FROM doctorbooking WHERE doctor_id::text = $1
            UNION ALL
            SELECT date AS appt_date 
            FROM appointments WHERE doctorid::text = $1
          ) all_appointments
          WHERE all_appointments.appt_date >= date_trunc('week', CURRENT_DATE)
        ) AS weekly_appointments,

        (
          SELECT COUNT(*) 
          FROM (
            SELECT appointment_date AS appt_date 
            FROM doctorbooking WHERE doctor_id::text = $1
            UNION ALL
            SELECT date AS appt_date 
            FROM appointments WHERE doctorid::text = $1
          ) all_appointments
          WHERE all_appointments.appt_date >= date_trunc('month', CURRENT_DATE)
        ) AS monthly_appointments,

        (
          SELECT COUNT(*) 
          FROM (
            SELECT appointment_date AS appt_date 
            FROM doctorbooking WHERE doctor_id::text = $1
            UNION ALL
            SELECT date AS appt_date 
            FROM appointments WHERE doctorid::text = $1
          ) all_appointments
        ) AS total_appointments
    `;

    const result = await db.query(query, [doctorId]);

    res.json({
      success: true,
      doctorId,
      summary: result.rows[0],
    });

  } catch (error) {
    console.error("Error fetching doctor summary:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/assign-doctor", async (req, res) => {
  const { nurseId, doctorIds } = req.body;

  if (!nurseId || !doctorIds || !Array.isArray(doctorIds) || doctorIds.length === 0) {
    return res.status(400).json({ message: "Missing nurseId or doctorIds" });
  }

  try {
    const result = await db.query(
      `UPDATE employees
       SET assigned_doctor = $1
       WHERE id = $2 AND role = 'pune'
       RETURNING *`,
      [doctorIds, nurseId] // doctorIds is an array
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Nurse not found or not a nurse" });
    }

    res.json({
      success: true,
      message: "Doctors assigned successfully",
      nurse: result.rows[0],
    });
  } catch (error) {
    console.error("Assign Doctor Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});



// GET NURSE → ASSIGNED DOCTOR DETAILS
router.get("/nurse/assigned-doctor/:id", async (req, res) => {
  const nurseId = req.params.id;

  try {
    // First get the nurse and assigned_doctor array
    const nurseResult = await db.query(
      `SELECT id, full_name, assigned_doctor
       FROM employees
       WHERE id = $1 AND role = 'pune'`,
      [nurseId]
    );

    if (nurseResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Nurse not found" });
    }

    const nurse = nurseResult.rows[0];

    if (!nurse.assigned_doctor || nurse.assigned_doctor.length === 0) {
      return res.json({ success: false, message: "No doctors assigned" });
    }

    // Get doctor details for all assigned doctor IDs
    const doctorsResult = await db.query(
      `SELECT id, name, department, phone_number, email
       FROM doctors
       WHERE id = ANY($1)`,
      [nurse.assigned_doctor]
    );

    return res.json({
      success: true,
      nurse: { id: nurse.id, name: nurse.full_name },
      doctors: doctorsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.get("/employees/nurses", async (req, res) => {
  const result = await db.query(
    "SELECT id, full_name FROM employees WHERE role = 'pune'"
  );
  res.json(result.rows);
});
router.get("/employees/doctors", async (req, res) => {
  const result = await db.query(
    "SELECT id, name, department FROM doctors"
  );
  res.json(result.rows);
});

router.put("/update-status/:id", async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  try {
    // Validate status
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const query = `UPDATE doctors SET status = $1 WHERE id = $2 RETURNING *`;
    const result = await db.query(query, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    res.json({
      message: `Doctor ${status} successfully`,
      doctor: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;
