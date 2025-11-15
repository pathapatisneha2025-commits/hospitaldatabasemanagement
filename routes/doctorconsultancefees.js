const express = require("express");
const router = express.Router();
const pool = require("../db"); // your DB connection

// ------------------------------
// ADD FEES
// ------------------------------
router.post("/add", async (req, res) => {
  const { employee_name, email, fees } = req.body;

  if (!employee_name || !email || !fees) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Get employee id using email
    const empRes = await pool.query(
      `SELECT id FROM employees WHERE email = $1`,
      [email]
    );

    if (empRes.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found with this email" });
    }

    const employee_id = empRes.rows[0].id;

    // Insert data
    const insertRes = await pool.query(
      `INSERT INTO doctor_consultant_fees (employee_id, employee_name, employee_email, fees)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [employee_id, employee_name, email, fees]
    );

    res.status(201).json({
      message: "Consultant fee added successfully",
      data: insertRes.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------
// GET ALL
// ------------------------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM doctor_consultant_fees ORDER BY id DESC`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------
// GET SINGLE
// ------------------------------
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM doctor_consultant_fees WHERE id = $1`, [
      req.params.id,
    ]);

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Record not found" });

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});
// ------------------------------
// GET CONSULTANT FEE BY EMPLOYEE ID
// ------------------------------
router.get("/employee/:employee_id", async (req, res) => {
  const { employee_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM doctor_consultant_fees WHERE employee_id = $1 ORDER BY id DESC`,
      [employee_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No consultant fee records found for this employee" });
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching consultant fee by employee ID:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------
// UPDATE
// ------------------------------
router.put("/update/:id", async (req, res) => {
  const { employee_name, email, fees } = req.body;

  try {
    const empRes = await pool.query(`SELECT id FROM employees WHERE email = $1`, [email]);

    if (empRes.rows.length === 0)
      return res.status(404).json({ error: "No employee found with this email" });

    const employee_id = empRes.rows[0].id;

    const updateRes = await pool.query(
      `UPDATE doctor_consultant_fees 
       SET employee_id=$1, employee_name=$2, employee_email=$3, fees=$4
       WHERE id = $5
       RETURNING *`,
      [employee_id, employee_name, email, fees, req.params.id]
    );

    res.json({
      message: "Updated successfully",
      data: updateRes.rows[0],
    });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------
// DELETE
// ------------------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM doctor_consultant_fees WHERE id = $1`, [req.params.id]);
    res.json({ message: "Deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
