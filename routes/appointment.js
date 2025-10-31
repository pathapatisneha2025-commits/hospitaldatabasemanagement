const express = require('express');
const router = express.Router();
const db = require('../db'); // PostgreSQL client (from db.js)





// -------------------- CREATE (POST) --------------------
router.post("/add", async (req, res) => {
  const {
    doctorId,
    doctorName,
    experience,
    department,
    consultantFees,
    date,
    timeSlot,
    patientId,
    name,
    age,
    gender,
    bloodGroup,
    reason,
    patientPhone,
    doctorEmail, // 👈 include this to fetch visit limit
  } = req.body;

  try {
    // 🗓️ Normalize the date format (to YYYY-MM-DD)
    const formattedDate = date.includes("T") ? date.split("T")[0] : date;

    

    // ✅ Verify doctor exists
    const doctorCheckQuery = `SELECT id FROM doctor_fees WHERE id = $1`;
    const doctorCheck = await db.query(doctorCheckQuery, [doctorId]);
    if (doctorCheck.rows.length === 0) {
      return res.status(404).json({ error: "Doctor ID not found in doctor_fees" });
    }

    // ✅ Prevent double booking
    const existing = await db.query(
      `SELECT * FROM appointments 
       WHERE doctorid = $1 AND date = $2 AND timeslot = $3`,
      [doctorId, formattedDate, timeSlot]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: "This time slot is already booked for the selected doctor.",
      });
    }

   // ✅ Fetch doctor's static daily limit (applies every day)
const visitData = await db.query(
  `SELECT number_of_visits_per_day 
   FROM doctor_visits 
   WHERE LOWER(doctor_email) = LOWER($1)
   LIMIT 1`,
  [doctorEmail]
);

console.log("📊 Visit Limit Found:", visitData.rows);

if (visitData.rows.length === 0) {
  return res.status(400).json({
    error: `No visit limit set for Dr. ${doctorName}`,
  });
}

const MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY = parseInt(
  visitData.rows[0].number_of_visits_per_day,
  10
);


   const lastToken = await db.query(
  `
  SELECT MAX(tokenid) AS last_token
  FROM (
    SELECT tokenid 
    FROM appointments 
    WHERE doctorid = $1 AND date::date = TO_DATE($2, 'YYYY-MM-DD')
    
    UNION ALL
    
    SELECT daily_id AS tokenid 
    FROM doctorbooking 
    WHERE doctor_id::integer = $1 AND appointment_date::date = TO_DATE($2, 'YYYY-MM-DD')
  ) AS combined;
  `,
  [doctorId, formattedDate]
);


let nextTokenId = 1;
if (lastToken.rows[0].last_token) {
  nextTokenId = parseInt(lastToken.rows[0].last_token, 10) + 1;
}


    // ✅ Enforce daily limit
    if (nextTokenId > MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY) {
      return res.status(200).json({
        alert: true,
        message: `Dr. ${doctorName} has reached the daily appointment limit of ${MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY} for ${formattedDate}.`,
      });
    }

    // ✅ Insert appointment
    const insertQuery = `
      INSERT INTO appointments
      (tokenid, doctorid, doctorname, yearsofexperience, department, date, timeslot, consultantfees,
       paymentstatus, status, patientid, name, age, gender, bloodgroup, reason, patientphone, createdat)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'pending',
              $9, $10, $11, $12, $13, $14, $15, NOW())
      RETURNING *;
    `;

    const values = [
      nextTokenId,
      doctorId,
      doctorName,
      experience,
      department,
      formattedDate,
      timeSlot,
      consultantFees,
      patientId,
      name,
      age,
      gender,
      bloodGroup,
      reason,
      patientPhone,
    ];

    const result = await db.query(insertQuery, values);

    res.status(201).json({
      message: `Appointment booked successfully for Dr. ${doctorName}`,
      appointment: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error booking appointment:", err);
    res.status(500).json({ error: "Server error" });
  }
});





// -------------------- READ (GET) --------------------
// Get all appointments
router.get('/all', async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM appointments ORDER BY createdAt DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get appointments by patientId
// Get appointments by patientId
router.get('/patient/:patientId', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * 
       FROM appointments 
       WHERE patientId = $1 
       ORDER BY createdAt DESC`,
      [req.params.patientId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No appointments found for this patient" });
    }

    // Return all appointment details
    res.json({
      message: "Appointments fetched successfully",
      total: result.rows.length,
      appointments: result.rows
    });
  } catch (err) {
    console.error("Error fetching appointments by patient ID:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ✅ Get appointments by doctorId
router.get('/doctor/:doctorId', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, doctorId, doctorName, yearsOfExperience, department, date, timeSlot, consultantFees, paymentStatus,status, patientId, name, age, gender, bloodGroup, reason ,tokenid
       FROM appointments 
       WHERE doctorId = $1 
       ORDER BY createdAt DESC`,
      [req.params.doctorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No appointments found for this doctor" });
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching doctor appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get appointment by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM appointments WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------- UPDATE (PUT) --------------------
router.put('/update/:id', async (req, res) => {
    const {
        doctorId,
        doctorName,
        yearsOfExperience,
        department,
        date,
        timeSlot,
        consultantFees,
        patientId,
        name,
        age,
        gender,
        bloodGroup,
        reason,
        paymentStatus,
        patientPhone
    } = req.body;

    try {
        const updateQuery = `
            UPDATE appointments
            SET doctorId = COALESCE($1, doctorId),
                doctorName = COALESCE($2, doctorName),
                yearsOfExperience = COALESCE($3, yearsOfExperience),
                department = COALESCE($4, department),
                date = COALESCE($5, date),
                timeSlot = COALESCE($6, timeSlot),
                consultantFees = COALESCE($7, consultantFees),
                patientId = COALESCE($8, patientId),
                name = COALESCE($9, name),
                age = COALESCE($10, age),
                gender = COALESCE($11, gender),
                bloodGroup = COALESCE($12, bloodGroup),
                reason = COALESCE($13, reason),
                paymentStatus = COALESCE($14, paymentStatus),
                patientPhone = COALESCE($15, patientPhone)
            WHERE id = $16
            RETURNING *;
        `;

        const values = [
            doctorId,
            doctorName,
            yearsOfExperience,
            department,
            date,
            timeSlot,
            consultantFees,
            patientId,
            name,
            age,
            gender,
            bloodGroup,
            reason,
            paymentStatus || null,
            patientPhone,
            req.params.id
        ];

        const result = await db.query(updateQuery, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        res.json({
            message: "Appointment updated successfully",
            appointment: result.rows[0]
        });
    } catch (err) {
        console.error("Error updating appointment:", err);
        res.status(500).json({ error: "Server error" });
    }
});





// -------------------- DELETE --------------------
router.delete('/delete/:id', async (req, res) => {
    try {
        const result = await db.query(`DELETE FROM appointments WHERE id = $1 RETURNING *`, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        res.json({ message: "Appointment deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});
// -------------------- UPDATE STATUS --------------------
router.put('/update-status', async (req, res) => {
  const { id, status } = req.body;

  if (!id) {
    return res.status(400).json({ error: "Appointment ID is required" });
  }

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    const updateQuery = `
      UPDATE appointments
      SET status = $1
      WHERE id = $2
      RETURNING *;
    `;

    const result = await db.query(updateQuery, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    res.json({
      message: "Appointment status updated successfully",
      appointment: result.rows[0]
    });
  } catch (err) {
    console.error("Error updating appointment status:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
