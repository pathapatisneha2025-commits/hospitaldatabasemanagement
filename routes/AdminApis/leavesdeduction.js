const express = require("express");
const router = express.Router();
const pool = require("../../db");

// ➕ Add Leave Deduction Rule
router.post("/add", async (req, res) => {
  try {
    const { employeeId, employeeName, employeeSalary, deductionPerDay, unauthorizedPenalty } = req.body;

    const result = await pool.query(
      `INSERT INTO employee_leavededuction 
       (employee_id, employee_name, employee_salary, deduction_per_day, unauthorized_penalty) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employeeId, employeeName, employeeSalary, deductionPerDay, unauthorizedPenalty]
    );

    res.json({ message: "Leave deduction rule added successfully", data: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error adding leave deduction rule" });
  }
});

// Get All Leave Deduction Rules
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM employee_leavededuction ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching leave deduction rules" });
  }
});

//  Get Leave Deduction Rule by ID
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM employee_leavededuction WHERE id = $1 LIMIT 1",
      [req.params.id]
    );

    if (result.rows.length === 0) 
      return res.status(404).json({ message: "No leave deduction rule found for this ID" });

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching leave deduction rule" });
  }
});

//  Update Leave Deduction Rule by ID
router.put("/update/:id", async (req, res) => {
  try {
    const { employeeId, employeeName, employeeSalary, deductionPerDay, unauthorizedPenalty } = req.body;

    const result = await pool.query(
      `UPDATE employee_leavededuction 
       SET employee_id = $1,
           employee_name = $2,
           employee_salary = $3,
           deduction_per_day = $4,
           unauthorized_penalty = $5,
           updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [employeeId, employeeName, employeeSalary, deductionPerDay, unauthorizedPenalty, req.params.id]
    );

    if (result.rows.length === 0) 
      return res.status(404).json({ message: "No leave deduction rule found for this ID" });

    res.json({ message: "Leave deduction rule updated successfully", data: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating leave deduction rule" });
  }
});

// Delete Leave Deduction Rule by ID
router.delete("/delete/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM employee_leavededuction WHERE id = $1 RETURNING *",
      [req.params.id]
    );

    if (result.rows.length === 0) 
      return res.status(404).json({ message: "No leave deduction rule found for this ID" });

    res.json({ message: "Leave deduction rule deleted successfully", deleted: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting leave deduction rule" });
  }
});

module.exports = router;
