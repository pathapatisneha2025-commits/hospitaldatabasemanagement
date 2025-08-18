// routes/tasks.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// Create new task
router.post("/add", async (req, res) => {
  try {
    const { title, description, assignto, priority, due_date } = req.body;

    // Basic validation
    if (!title || !assignto || !priority || !due_date) {
      return res.status(400).json({ error: "Please fill all required fields" });
    }

    // Insert task
    const newTask = await pool.query(
      `INSERT INTO tasks (title, description, assignto, priority, due_date) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, description || null, assignto, priority, due_date]
    );

    res.status(201).json({ message: "Task created successfully", task: newTask.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});
// ============================
// Get all tasks
// ============================
router.get("/all", async (req, res) => {
  try {
    const tasks = await pool.query(
      `SELECT t.*
       FROM tasks t
       LEFT JOIN employees e ON t.assignto = e.email
       ORDER BY t.due_date ASC`
    );

    res.status(200).json({
      success: true,
      count: tasks.rows.length,
      tasks: tasks.rows
    });
  } catch (err) {
    console.error("Get all tasks error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});


// ============================
// Get task by ID
// ============================
router.get("/employee/:empId", async (req, res) => {
  try {
    const { empId } = req.params;

    const tasks = await pool.query(
      `SELECT t.*
       FROM tasks t
       JOIN employees e ON t.assignto = e.email
       WHERE e.id = $1
       ORDER BY t.due_date ASC`,
      [empId]
    );

    if (tasks.rows.length === 0) {
      return res.status(404).json({ error: "No tasks found for this employee ID" });
    }

    res.status(200).json(tasks.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Update task by ID
// ============================
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, assignto, priority, due_date } = req.body;

    // Basic validation
    if (!title || !assignto || !priority || !due_date) {
      return res.status(400).json({ error: "Please fill all required fields" });
    }

    const updatedTask = await pool.query(
      `UPDATE tasks 
       SET title = $1, description = $2, assignto = $3, priority = $4, due_date = $5
       WHERE id = $6
       RETURNING *`,
      [title, description || null, assignto, priority, due_date, id]
    );

    if (updatedTask.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.status(200).json({ message: "Task updated successfully", task: updatedTask.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// Delete task by ID
// ============================
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const deletedTask = await pool.query(
      `DELETE FROM tasks WHERE id = $1 RETURNING *`,
      [id]
    );

    if (deletedTask.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.status(200).json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});



module.exports = router;
