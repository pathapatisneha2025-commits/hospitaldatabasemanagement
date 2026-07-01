const express = require("express");
const router = express.Router();
const pool = require("../db");

// ------------------- Routes -------------------

// Add new employee deduction
router.post("/add", async (req, res) => {
    console.log("REQ BODY:", req.body);

  const {
       //  NEW
    employee_name,
    email,
    salary,
    late_penalty,
    break_penalty,
    working_days,
    working_hours,
    employee_type,
    employee_id,   
  } = req.body;
  console.log("Employee ID:", employee_id);

  try {
    const result = await pool.query(
      `INSERT INTO employee_deductions 
      ( employee_name, email, salary, late_penalty, break_penalty, working_days, working_hours, employee_type,employee_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        employee_id,     // added first
        employee_name,
        email,
        salary,
        late_penalty,
        break_penalty,
        working_days,
        working_hours,
        employee_type,
      ]
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
    working_days,
    working_hours,
    employee_type,   // update includes new field
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE employee_deductions
       SET employee_name=$1, email=$2, salary=$3, late_penalty=$4, break_penalty=$5,
           working_days=$6, working_hours=$7, employee_type=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [
        employee_name,
        email,
        salary,
        late_penalty,
        break_penalty,
        working_days,
        working_hours,
        employee_type,
        id,
      ]
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
