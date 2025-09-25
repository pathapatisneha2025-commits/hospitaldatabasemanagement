const express = require("express");
const pool = require("../../db"); // Adjust path as needed
const router = express.Router();

// -------------------- CREATE (with auto late_count + fetch employee_id using email) --------------------
router.post("/add", async (req, res) => {
  try {
    const { employee_email, employee_name, late_date, duration, reason } = req.body;

    if (!employee_email || !employee_name || !late_date || !duration || !reason) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: employee_email, employee_name, late_date, duration, reason",
      });
    }

    // Fetch employee_id from employees table
    const empResult = await pool.query(
      "SELECT id FROM employees WHERE email = $1",
      [employee_email]
    );

    const { employee_id } = empResult.rows[0] || {};

    // Get current late count
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM late_to_come WHERE employee_id = $1",
      [employee_id]
    );
    const currentCount = parseInt(countResult.rows[0].count, 10);

    const newLateCount = currentCount + 1;

    // Insert new record
    const result = await pool.query(
      `INSERT INTO late_to_come (employee_id, employee_name, late_date, duration, reason, status, late_count) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [employee_id, employee_name, late_date, duration, reason, "Pending", newLateCount]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------- READ (ALL) --------------------
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM late_to_come ORDER BY late_date DESC");
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});



// -------------------- UPDATE --------------------
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { late_date, duration, reason, status, employee_name } = req.body;

    const result = await pool.query(
      `UPDATE late_to_come 
       SET late_date = $1, duration = $2, reason = $3, status = $4, employee_name = $5
       WHERE id = $6 RETURNING *`,
      [late_date, duration, reason, status, employee_name, id]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------- DELETE --------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM late_to_come WHERE id = $1", [id]);
    res.json({ success: true, message: "Record deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
