const express = require('express');
const router = express.Router();
const db = require('../db'); // PostgreSQL client (from db.js)

// -------------------- CREATE (POST) --------------------

// Helper function to generate random 6-character alphanumeric ID
function generateRandomId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// -------------------- CREATE (POST) --------------------
router.post('/add', async (req, res) => {
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
    patientPhone
  } = req.body;

  // Validate request
  if (!doctorId || !doctorName || !experience || !department || !consultantFees ||
      !date || !timeSlot || !patientId || !name || !age || !gender || !bloodGroup || !reason || !patientPhone) {
    return res.status(400).json({ error: "All fields including patientPhone are required!" });
  }

  try {
    // Verify doctor exists
    const doctorCheckQuery = `SELECT id FROM doctor_fees WHERE id = $1`;
    const doctorCheck = await db.query(doctorCheckQuery, [doctorId]);
    if (doctorCheck.rows.length === 0) {
      return res.status(404).json({ error: "Doctor ID does not exist in doctor_fees" });
    }

    // Check for double booking
    const checkQuery = `SELECT * FROM appointments WHERE doctorId = $1 AND date = $2 AND timeSlot = $3`;
    const existing = await db.query(checkQuery, [doctorId, date, timeSlot]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "This time slot is already booked for the selected doctor." });
    }

    // Generate random alphanumeric ID for appointment
    const appointmentId = generateRandomId(6);

    // Insert appointment
    const insertQuery = `
      INSERT INTO appointments
      (id, doctorId, doctorName, yearsOfExperience, department, date, timeSlot, consultantFees,
       paymentStatus, patientId, name, age, gender, bloodGroup, reason, patientPhone, createdAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, $13, $14, $15, NOW())
      RETURNING *;
    `;

    const values = [
      appointmentId,
      doctorId,
      doctorName,
      experience,
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
      patientPhone
    ];

    const result = await db.query(insertQuery, values);

    return res.status(201).json({
      message: "Appointment booked successfully",
      appointment: result.rows[0]
    });
  } catch (err) {
    console.error("Error booking appointment:", err);
    return res.status(500).json({ error: "Server error" });
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
router.get('/patient/:patientId', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, doctorId, doctorName, department, date, timeSlot, consultantFees, paymentStatus 
       FROM appointments 
       WHERE patientId = $1 
       ORDER BY createdAt DESC`,
      [req.params.patientId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No appointments found for this patient" });
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get appointments by doctorId
router.get('/doctor/:doctorId', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, doctorId, doctorName, yearsOfExperience, department, date, timeSlot, consultantFees, paymentStatus, patientId, name, age, gender, bloodGroup, reason 
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

module.exports = router;
