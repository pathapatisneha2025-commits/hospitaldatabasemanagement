const express = require('express');
const router = express.Router();

// Example: replace with your DB connection
const db = require('../db'); // e.g., a MySQL or PostgreSQL client

// POST /api/book-appointment
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
        // Check for double booking (replace with DB query)
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

module.exports = router;
