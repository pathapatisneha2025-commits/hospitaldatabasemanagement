const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// POST API - Apply for Leave
router.post("/add", async (req, res) => {
  try {
    const {
      employee_name,
      department,
      leave_type,
      start_date,
      end_date,
      leave_hours,
      reason,
      status
    } = req.body;

    // Basic validation
    if (!employee_name || !department || !leave_type || !start_date || !end_date) {
      return res.status(400).json({ error: "All required fields must be provided." });
    }

    const query = `
      INSERT INTO leaves (
        employee_name,
        department,
        leave_type,
        start_date,
        end_date,
        leave_hours,
        reason,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'Pending'))
      RETURNING *;
    `;

    const values = [
      employee_name,
      department,
      leave_type,
      start_date,
      end_date,
      leave_hours || null,
      reason || null,
      status
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      message: "Leave application submitted successfully.",
      leave: result.rows[0]
    });
  } catch (error) {
    console.error("Error adding leave:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// GET leaves by employee ID without storing employee_id in leaves table (based on full_name)
router.get("/by-employee/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT l.*
      FROM leaves l
      JOIN employees e ON e.full_name = l.employee_name
      WHERE e.id = $1;
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "No leave records found for this employee."
      });
    }

    res.status(200).json({
      message: "Leave records fetched successfully.",
      leaves: result.rows
    });
  } catch (error) {
    console.error("Error fetching leaves by employee ID:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


module.exports = router;
