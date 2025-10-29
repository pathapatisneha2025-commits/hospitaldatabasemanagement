const express = require("express");
const router = express.Router();
const pool = require("../../db");


//  1️ Add Penalty (using employee_email and employee_name)
router.post("/add", async (req, res) => {
  try {
    const { employee_email, employee_name, penalty_amount } = req.body;

    if (!employee_email || !employee_name || !penalty_amount) {
      return res.status(400).json({
        error: "Missing required fields (employee_email, employee_name, penalty_amount)",
      });
    }

    // 🔍 Fetch only employee_id using email
    const employeeResult = await pool.query(
      `SELECT id AS employee_id 
       FROM employees 
       WHERE email = $1`,
      [employee_email]
    );

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found for provided email" });
    }

    const { employee_id } = employeeResult.rows[0];

    // 💾 Insert into latepenalties
    const insertResult = await pool.query(
      `INSERT INTO latepenalties (employee_id, employee_name, penalty_amount)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [employee_id, employee_name, penalty_amount]
    );

    res.status(201).json({
      message: "Penalty added successfully",
      data: insertResult.rows[0],
    });
  } catch (err) {
    console.error("Error adding penalty:", err);
    res.status(500).json({ error: "Failed to add penalty" });
  }
});


//  2️ Get All Penalties
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM latepenalties ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch penalties" });
  }
});


//  3️ Get Penalty by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM latepenalties WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Penalty not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch penalty" });
  }
});


//  4️ Update Penalty (supports employee_email + employee_name)
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_email, employee_name, penalty_amount } = req.body;

    let employee_id = null;

    // If email provided, fetch employee_id
    if (employee_email) {
      const empRes = await pool.query(
        `SELECT id AS employee_id FROM employees WHERE email = $1`,
        [employee_email]
      );

      if (empRes.rows.length === 0) {
        return res.status(404).json({ error: "Employee not found for provided email" });
      }

      employee_id = empRes.rows[0].employee_id;
    }

    const result = await pool.query(
      `UPDATE latepenalties
       SET employee_id = COALESCE($1, employee_id),
           employee_name = COALESCE($2, employee_name),
           penalty_amount = COALESCE($3, penalty_amount),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [employee_id, employee_name, penalty_amount, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Penalty not found" });
    }

    res.json({ message: "Penalty updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error("Error updating penalty:", err);
    res.status(500).json({ error: "Failed to update penalty" });
  }
});


//  5️ Delete Penalty
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM latepenalties WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Penalty not found" });
    }

    res.json({ message: "Penalty deleted successfully", data: result.rows[0] });
  } catch (err) {
    console.error("Error deleting penalty:", err);
    res.status(500).json({ error: "Failed to delete penalty" });
  }
});


module.exports = router;
