const express = require("express");
const pool = require("../../db");
const router = express.Router();

/* =========================================================
    1️⃣ BOOK NEW APPOINTMENT
========================================================= */
router.post("/add", async (req, res) => {
  try {
    const {
      employeeId,
      patientName,
      patientAge,
      patientPhone,
      doctorName,
      specialization,
      experience,
      rating,
      availableDays,
      availableTime,
      appointmentDate,
      appointmentTime,
      doctorDescription,
      paymentType
    } = req.body;

    if (!employeeId || !patientName || !doctorName || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ error: "Required fields missing" });
    }

    // ✅ Check if doctor is already booked for the given date and time
    const existingAppointment = await pool.query(
      `SELECT * FROM doctorbooking 
       WHERE doctor_name = $1 AND appointment_date = $2 AND appointment_time = $3`,
      [doctorName, appointmentDate, appointmentTime]
    );

    if (existingAppointment.rows.length > 0) {
      return res.status(400).json({ error: "Doctor is already booked for this time slot" });
    }

    // ✅ If not booked, insert new appointment
    const result = await pool.query(
      `INSERT INTO doctorbooking (
        employee_id, patient_name, patient_age, patient_phone,
        doctor_name, specialization, experience, rating,
        available_days, available_time, doctor_description,
        appointment_date, appointment_time, payment_type
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        employeeId,
        patientName,
        patientAge,
        patientPhone,
        doctorName,
        specialization,
        experience,
        rating,
        availableDays,
        availableTime,
        doctorDescription,
        appointmentDate,
        appointmentTime,
        paymentType
      ]
    );

    res.json({
      message: "Appointment created successfully",
      appointment: result.rows[0],
    });

  } catch (err) {
    console.error("Error booking appointment:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
    2️⃣ GET ALL APPOINTMENTS
========================================================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM doctorbooking ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
    3️⃣ GET APPOINTMENTS BY EMPLOYEE ID
========================================================= */
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const result = await pool.query(
      "SELECT * FROM doctorbooking WHERE employee_id = $1 ORDER BY created_at DESC",
      [employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching employee appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
    4️⃣ GET SINGLE APPOINTMENT BY ID
========================================================= */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM doctorbooking WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Appointment not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching appointment:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
    5️⃣ UPDATE APPOINTMENT DETAILS
========================================================= */
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      patientName,
      patientAge,
      patientPhone,
      doctorName,
      specialization,
      experience,
      rating,
      availableDays,
      availableTime,
      appointmentDate,
      appointmentTime,
      doctorDescription,
      paymentType
    } = req.body;

    const result = await pool.query(
      `UPDATE doctorbooking
       SET patient_name = $1, patient_age = $2, patient_phone = $3,
           doctor_name = $4, specialization = $5, experience = $6,
           rating = $7, available_days = $8, available_time = $9,
           doctor_description = $10,
           appointment_date = $11, appointment_time = $12,
           payment_type = $13
       WHERE id = $14
       RETURNING *`,
      [
        patientName,
        patientAge,
        patientPhone,
        doctorName,
        specialization,
        experience,
        rating,
        availableDays,
        availableTime,
        doctorDescription,
        appointmentDate,
        appointmentTime,
        paymentType,
        id
      ]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Appointment not found" });

    res.json({
      message: "Appointment updated successfully",
      appointment: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating appointment:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
    6️⃣ DELETE APPOINTMENT
========================================================= */
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM doctorbooking WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Appointment not found" });

    res.json({ message: "Appointment deleted successfully" });
  } catch (err) {
    console.error("Error deleting appointment:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
    7️⃣ UPDATE STATUS (PENDING → CONFIRMED / COMPLETED / CANCELLED)
========================================================= */
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) return res.status(400).json({ error: "Status required" });

    const result = await pool.query(
      "UPDATE doctorbooking SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Appointment not found" });

    res.json({
      message: "Status updated successfully",
      appointment: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating status:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
