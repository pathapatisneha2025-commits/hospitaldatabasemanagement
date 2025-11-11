const express = require("express");
const router = express.Router();
const db = require("../../db"); // Make sure this exports your pool/query methods

// CREATE Break Penalty
router.post("/add", async (req, res) => {
  try {
    const { employee_email, employee_name, break_penalty } = req.body;

    if (!employee_email || !employee_name || !break_penalty) {
      return res.status(400).json({
        error: "Missing required fields (employee_email, employee_name, break_penalty)",
      });
    }

    // 🔍 Fetch only employee_id using email
    const employeeResult = await db.query(
      `SELECT id AS employee_id FROM employees WHERE email = $1`,
      [employee_email]
    );

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found for provided email" });
    }

    const { employee_id } = employeeResult.rows[0];

    // 💾 Insert into breakpenalty
    const insertResult = await db.query(
      `INSERT INTO breakpenalty (employee_id, employee_name, employee_email, break_penalty)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [employee_id, employee_name, employee_email, break_penalty]
    );

    res.status(201).json({
      message: "Break penalty added successfully",
      data: insertResult.rows[0],
    });
  } catch (err) {
    console.error("Error adding break penalty:", err);
    res.status(500).json({ error: "Failed to add break penalty" });
  }
});

// GET All Break Penalties
router.get("/all", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM breakpenalty ORDER BY created_at DESC");
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// GET Single Break Penalty by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("SELECT * FROM breakpenalty WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Record not found" });
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// UPDATE Break Penalty
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_id, employee_name, break_penalty } = req.body;

    const result = await db.query(
      `UPDATE breakpenalty
       SET employee_id = $1, employee_name = $2, break_penalty = $3
       WHERE id = $4
       RETURNING *`,
      [employee_id, employee_name, break_penalty, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Record not found" });
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE Break Penalty
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("DELETE FROM breakpenalty WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) return res.status(404).json({ error: "Record not found" });
    res.status(200).json({ message: "Record deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
