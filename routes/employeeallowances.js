const express = require("express");
const router = express.Router();
const pool = require('../db');

// ➤ Add Allowance Record
router.post("/add", async (req, res) => {
  try {
    const { emp_name, emp_email, allowance_amount } = req.body;

    if (!emp_name || !emp_email || !allowance_amount) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // 1️⃣ Check employee exists in employees table
    const empResult = await db.query(
      "SELECT id FROM employees WHERE email = $1",
      [emp_email]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ message: "Employee not found for this email" });
    }

    const employee_id = empResult.rows[0].id;

    // 2️⃣ Insert into employee_allowances
    const result = await pool.query(
      `INSERT INTO employee_allowances (employee_id, emp_name, emp_email, allowance_amount)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [employee_id, emp_name, emp_email, allowance_amount]
    );

    res.status(201).json({
      message: "Allowance added successfully",
      data: result.rows[0],
    });

  } catch (err) {
    console.log("❌ Error adding allowance:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// ➤ Get All Allowance Records
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM employee_allowances ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.log("❌ Fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ➤ Update Allowance
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { emp_name, emp_email, allowance_amount } = req.body;

    const existing = await pool.query(
      "SELECT * FROM employee_allowances WHERE id = $1",
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Record not found" });
    }

    const updated = await pool.query(
      `UPDATE employee_allowances 
       SET emp_name = $1, emp_email = $2, allowance_amount = $3 
       WHERE id = $4 RETURNING *`,
      [emp_name, emp_email, allowance_amount, id]
    );

    res.json({ message: "Updated successfully", data: updated.rows[0] });

  } catch (err) {
    console.log("❌ Update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ➤ Delete Allowance
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM employee_allowances WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.log("❌ Delete error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
