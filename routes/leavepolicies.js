const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// POST API to create a leave policy
router.post("/add", async (req, res) => {
  try {
    const { department, number_of_leaves, yearly_totalleaves } = req.body;

    if (!department || !number_of_leaves || yearly_totalleaves === undefined) {
      return res.status(400).json({ 
        error: "Department, number_of_leaves, and yearly_totalleaves are required" 
      });
    }

    const query = `
      INSERT INTO leave_policies (department, number_of_leaves, yearly_totalleaves) 
      VALUES ($1, $2, $3) 
      RETURNING *;
    `;

    const result = await pool.query(query, [
      department,
      number_of_leaves,
      yearly_totalleaves,
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
    const { department, number_of_leaves, yearly_totalleaves } = req.body;

    if (!department || !number_of_leaves || yearly_totalleaves === undefined) {
      return res.status(400).json({ 
        error: "Department, number_of_leaves, and yearly_totalleaves are required" 
      });
    }

    const query = `
      UPDATE leave_policies 
      SET department = $1, number_of_leaves = $2, yearly_totalleaves = $3
      WHERE id = $4 
      RETURNING *;
    `;

    const result = await pool.query(query, [
      department,
      number_of_leaves,
      yearly_totalleaves,
      id,
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
