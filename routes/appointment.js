const express = require('express');
const router = express.Router();
const db = require('../db'); // PostgreSQL client (from db.js)

// -------------------- CREATE (POST) --------------------
router.post('/add', async (req, res) => {
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
        reason
    } = req.body;

    // Validate request
    if (!doctorId || !doctorName || !yearsOfExperience || !department || !date || !timeSlot || !consultantFees ||
        !patientId || !name || !age || !gender || !bloodGroup || !reason) {
        return res.status(400).json({ error: "All fields including doctor and patient details are required!" });
    }

    try {
        // Check for double booking
        const checkQuery = `SELECT * FROM appointments WHERE doctorId = $1 AND date = $2 AND timeSlot = $3`;
        const existing = await db.query(checkQuery, [doctorId, date, timeSlot]);

        if (existing.rows.length > 0) {
            return res.status(409).json({ error: "This time slot is already booked for the selected doctor." });
        }

        // Insert appointment into database
        const insertQuery = `
            INSERT INTO appointments
            (doctorId, doctorName, yearsOfExperience, department, date, timeSlot, consultantFees,
             paymentStatus, patientId, name, age, gender, bloodGroup, reason, createdAt)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12, $13, NOW())
            RETURNING *;
        `;
        const values = [
            doctorId, doctorName, yearsOfExperience, department, date, timeSlot, consultantFees,
            patientId, name, age, gender, bloodGroup, reason
        ];
        const result = await db.query(insertQuery, values);

        return res.status(201).json({
            message: "Appointment booked successfully",
            appointment: result.rows[0]
        });
    } catch (err) {
        console.error(err);
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

        res.json(result.rows);  // returns list of appointments for patient
    } catch (err) {
        console.error(err);
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
    const { date, timeSlot, reason, paymentStatus } = req.body;

    try {
        const updateQuery = `
            UPDATE appointments
            SET date = COALESCE($1, date),
                timeSlot = COALESCE($2, timeSlot),
                reason = COALESCE($3, reason),
                paymentStatus = COALESCE($4, paymentStatus)
            WHERE id = $5
            RETURNING *;
        `;
        const values = [date, timeSlot, reason, paymentStatus, req.params.id];
        const result = await db.query(updateQuery, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        res.json({
            message: "Appointment updated successfully",
            appointment: result.rows[0]
        });
    } catch (err) {
        console.error(err);
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
