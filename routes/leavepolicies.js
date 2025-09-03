const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// POST API to create a leave policy
router.post("/add", async (req, res) => { 
  try {
    const { number_of_leaves, yearly_totalleaves, employee_name, employee_email } = req.body;

    // Validate required fields
    if (number_of_leaves === undefined || yearly_totalleaves === undefined || !employee_name || !employee_email) {
      return res.status(400).json({ 
        error: "number_of_leaves, yearly_totalleaves, employee_name, and employee_email are required" 
      });
    }

    // Fetch employee ID based on email
    const employeeQuery = `SELECT id FROM employees WHERE email = $1`;
    const employeeResult = await pool.query(employeeQuery, [employee_email]);

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found with the provided email" });
    }

    const employee_id = employeeResult.rows[0].id;

    // Insert into leave_policies (store employee_id, not email)
    const insertQuery = `
      INSERT INTO leave_policies (number_of_leaves, yearly_totalleaves, employee_id, employee_name) 
      VALUES ($1, $2, $3, $4) 
      RETURNING *;
    `;

    const result = await pool.query(insertQuery, [
      number_of_leaves,
      yearly_totalleaves,
      employee_id,
      employee_name,
    ]);

    res.status(201).json({
      message: "Leave policy created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error inserting leave policy:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// GET API - fetch all leave policies
router.get("/all", async (req, res) => {
  try {
    const query = `SELECT * FROM leave_policies ORDER BY id ASC;`;
    const result = await pool.query(query);

    res.json({
      message: "Leave policies retrieved successfully",
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching leave policies:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET API - fetch a single leave policy by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `SELECT * FROM leave_policies WHERE id = $1;`;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Leave policy not found" });
    }

    res.json({
      message: "Leave policy retrieved successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching leave policy:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT API to update a leave policy by ID
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { number_of_leaves, yearly_totalleaves, employee_name, employee_email } = req.body;

    // Validate required fields
    if (number_of_leaves === undefined || yearly_totalleaves === undefined || !employee_name || !employee_email) {
      return res.status(400).json({
        error: "number_of_leaves, yearly_totalleaves, employee_name, and employee_email are required"
      });
    }

    // Fetch employee ID based on email
    const employeeQuery = `SELECT id FROM employees WHERE email = $1`;
    const employeeResult = await pool.query(employeeQuery, [employee_email]);

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found with the provided email" });
    }

    const employee_id = employeeResult.rows[0].id;

    // Update leave policy
    const query = `
      UPDATE leave_policies 
      SET number_of_leaves = $1, yearly_totalleaves = $2, employee_id = $3, employee_name = $4
      WHERE id = $5
      RETURNING *;
    `;

    const result = await pool.query(query, [
      number_of_leaves,
      yearly_totalleaves,
      employee_id,
      employee_name,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Leave policy not found" });
    }

    res.json({
      message: "Leave policy updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating leave policy:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE API to delete a leave policy by ID
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      DELETE FROM leave_policies 
      WHERE id = $1 
      RETURNING *;
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Leave policy not found" });
    }

    res.json({
      message: "Leave policy deleted successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error deleting leave policy:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
