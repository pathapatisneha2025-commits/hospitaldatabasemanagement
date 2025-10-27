const express = require("express");
const pool = require("../../db");
const router = express.Router();


router.post("/add", async (req, res) => {
  try {
    const {
      employeeId,
      doctorId,
      patientId,
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
      paymentType,
      doctorConsultantFee,
      doctorEmail, // 👈 include doctorEmail in the request body
    } = req.body;

    // ✅ Validate required fields
    if (
      !employeeId ||
      !doctorId ||
      !patientId ||
      !patientName ||
      !doctorName ||
      !appointmentDate ||
      !appointmentTime ||
      !doctorEmail
    ) {
      return res.status(400).json({ error: "Required fields missing" });
    }

    // ✅ Prevent duplicate booking for same doctor/date/time
    const existingAppointment = await pool.query(
      `SELECT * FROM doctorbooking 
       WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3`,
      [doctorId, appointmentDate, appointmentTime]
    );

    if (existingAppointment.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "Doctor is already booked for this time slot" });
    }

    // ✅ Get doctor's max visits for the day from doctor_visits
    const visitData = await pool.query(
      `SELECT number_of_visits_per_day 
       FROM doctor_visits 
       WHERE doctor_email = $1 AND visit_date = $2
       LIMIT 1`,
      [doctorEmail, appointmentDate]
    );

    if (visitData.rows.length === 0) {
      return res.status(400).json({
        error: `No visit limit set for Dr. ${doctorName} on ${appointmentDate}`,
      });
    }

    const MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY =
      parseInt(visitData.rows[0].number_of_visits_per_day, 10);

    // ✅ Find last daily_id for that doctor on that date
    const lastAppointment = await pool.query(
      `SELECT daily_id FROM doctorbooking 
       WHERE doctor_id = $1 AND appointment_date = $2
       ORDER BY daily_id DESC 
       LIMIT 1`,
      [doctorId, appointmentDate]
    );

    let nextDailyId = 1; // start from 1 for each doctor per day
    if (lastAppointment.rows.length > 0) {
      nextDailyId = parseInt(lastAppointment.rows[0].daily_id, 10) + 1;
    }

    // ✅ Enforce doctor-specific limit
    if (nextDailyId > MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY) {
      return res.status(400).json({
        error: `Dr. ${doctorName} has reached the daily limit of ${MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY} appointments for ${appointmentDate}`,
      });
    }

    // ✅ Insert appointment
    const result = await pool.query(
      `INSERT INTO doctorbooking (
        daily_id, employee_id, doctor_id, patient_id,
        patient_name, patient_age, patient_phone,
        doctor_name, specialization, experience, rating,
        available_days, available_time, doctor_description,
        appointment_date, appointment_time, payment_type, doctor_consultant_fee,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending')
      RETURNING *`,
      [
        nextDailyId,
        employeeId,
        doctorId,
        patientId,
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
        doctorConsultantFee,
      ]
    );

    res.json({
      message: `Appointment created successfully for Dr. ${doctorName}`,
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
router.get("/patient/:patientId", async (req, res) => {
  try {
    const { patientId } = req.params;
    const result = await pool.query(
      "SELECT * FROM doctorbooking WHERE patient_id = $1 ORDER BY created_at DESC",
      [patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching patient appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/doctor/:doctorId", async (req, res) => {
  try {
    const { doctorId } = req.params;
    const result = await pool.query(
      "SELECT * FROM doctorbooking WHERE doctor_id = $1 ORDER BY created_at DESC",
      [doctorId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching doctor appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
    4️⃣ GET SINGLE APPOINTMENT BY DATABASE ID
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
      paymentType,
      doctorConsultantFee
    } = req.body;

    const result = await pool.query(
      `UPDATE doctorbooking
       SET patient_name = $1, patient_age = $2, patient_phone = $3,
           doctor_name = $4, specialization = $5, experience = $6,
           rating = $7, available_days = $8, available_time = $9,
           doctor_description = $10,
           appointment_date = $11, appointment_time = $12,
           payment_type = $13, doctor_consultant_fee = $14
       WHERE id = $15
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
        doctorConsultantFee,
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
    7️⃣ UPDATE STATUS
========================================================= */
router.put("/update-status", async (req, res) => {
  try {
    const { id, status } = req.body;

    // ✅ Validate both fields
    if (!id) return res.status(400).json({ error: "ID is required" });
    if (!status) return res.status(400).json({ error: "Status is required" });

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
