// routes/tasks.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// Create new task
router.post("/add", async (req, res) => {
  try {
    const { title, description, assignto, priority, due_date, due_time } = req.body;

    // Basic validation
    if (!title || !assignto || !priority || !due_date || !due_time) {
      return res.status(400).json({ error: "Please fill all required fields" });
    }

    // Insert task with default status "pending"
    const newTask = await pool.query(
      `INSERT INTO tasks (title, description, assignto, priority, due_date, due_time, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, description || null, assignto, priority, due_date, due_time, "pending"]
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
    // Step 1: Update overdue tasks
    await pool.query(`
      UPDATE tasks
      SET status = 'overdue'
      WHERE status = 'pending'
      AND (
        due_date < (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata') 
        OR (due_date = (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata') 
            AND due_time < (CURRENT_TIME AT TIME ZONE 'Asia/Kolkata'))
      );
    `);

    // Step 2: Fetch all tasks
    const tasks = await pool.query(
      `SELECT t.*
       FROM tasks t
       LEFT JOIN employees e ON t.assignto = e.email
       ORDER BY t.due_date ASC, t.due_time ASC`
    );

    // Step 3: Format date (keep only YYYY-MM-DD)
    const formatted = tasks.rows.map(task => ({
      ...task,
      due_date: task.due_date.toISOString().split("T")[0]
    }));

    // Step 4: Return only tasks (no overdue_updated)
    res.status(200).json({
      success: true,
      count: formatted.length,
      tasks: formatted
    });

  } catch (err) {
    console.error("Get all tasks error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});




// ============================
// Get task by ID
// ============================
// ============================
// Get tasks for a specific employee (with overdue check)
// ============================
router.get("/employee/:empId", async (req, res) => {
  try {
    const { empId } = req.params;

    // Step 1: Update overdue tasks for this employee
    await pool.query(
      `
      UPDATE tasks
      SET status = 'overdue'
      WHERE status = 'pending'
      AND assignto = (SELECT email FROM employees WHERE id = $1)
      AND (
    (due_date + due_time) < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
  );`,
      [empId]
    );

    // Step 2: Fetch employee's tasks
    const tasks = await pool.query(
      `SELECT t.*
       FROM tasks t
       JOIN employees e ON t.assignto = e.email
       WHERE e.id = $1
       ORDER BY t.due_date ASC, t.due_time ASC`,
      [empId]
    );

    if (tasks.rows.length === 0) {
      return res.status(404).json({ error: "No tasks found for this employee ID" });
    }

    // Step 3: Format date (YYYY-MM-DD only)
    const formatted = tasks.rows.map(task => ({
      ...task,
      due_date: task.due_date.toISOString().split("T")[0]
    }));

    // Step 4: Return employee tasks
    res.status(200).json({
      success: true,
      count: formatted.length,
      tasks: formatted
    });

  } catch (err) {
    console.error("Get employee tasks error:", err.message);
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
router.post("/update-status", async (req, res) => {
  try {
    const { id, status } = req.body;

    if (!id || !status) {
      return res.status(400).json({ error: "Task ID and status are required" });
    }

    const query = `
      UPDATE tasks
      SET status = $1
      WHERE id = $2
      RETURNING *;
    `;

    const result = await pool.query(query, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.status(200).json({
      message: `Task status updated to ${status}.`,
      task: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating task status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



module.exports = router;
