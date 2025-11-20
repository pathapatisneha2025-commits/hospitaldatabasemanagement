const express = require("express");
const router = express.Router();
const pool = require("../db");



// ------------------- Routes -------------------

// Add new employee deduction
router.post("/add", async (req, res) => {
  const {
    employee_name,
    email,
    salary,
    late_penalty,
    break_penalty,
    salary_deduction,
    unauthorized_leave,
    working_days,
    working_hours,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO employee_deductions 
      (employee_name, email, salary, late_penalty, break_penalty, salary_deduction, unauthorized_leave, working_days, working_hours)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [employee_name, email, salary, late_penalty, break_penalty, salary_deduction, unauthorized_leave, working_days, working_hours]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to add data" });
  }
});

// Get all employee deductions
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM employee_deductions ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch data" });
  }
});

// Update employee deduction
router.put("/update/:id", async (req, res) => {
  const { id } = req.params;
  const {
    employee_name,
    email,
    salary,
    late_penalty,
    break_penalty,
    salary_deduction,
    unauthorized_leave,
    working_days,
    working_hours,
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE employee_deductions
       SET employee_name=$1, email=$2, salary=$3, late_penalty=$4, break_penalty=$5, salary_deduction=$6, unauthorized_leave=$7, working_days=$8, working_hours=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [employee_name, email, salary, late_penalty, break_penalty, salary_deduction, unauthorized_leave, working_days, working_hours, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update data" });
  }
});

// Delete employee deduction
router.delete("/delete/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM employee_deductions WHERE id=$1", [id]);
    res.json({ success: true, message: "Deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to delete data" });
  }
});

module.exports = router;
