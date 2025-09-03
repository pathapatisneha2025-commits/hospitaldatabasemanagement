// routes/tasks.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// Create new task
router.post("/add", async (req, res) => {
  try {
    const { title, description, assignto, priority, due_date, due_time } = req.body;

    if (!title || !assignto || !priority || !due_date || !due_time) {
      return res.status(400).json({ error: "Please fill all required fields" });
    }

    
    const assignees = Array.isArray(assignto) ? assignto : [assignto];

    // Step 1: Get employee IDs for all emails
    const employeeResult = await pool.query(
      `SELECT id, email FROM employees WHERE email = ANY($1::text[])`,
      [assignees]
    );

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: "No employees found with given emails" });
    }

    const employeeIds = employeeResult.rows.map(emp => emp.id);

    // Step 2: Insert task (save emails as array in assignto)
    const newTask = await pool.query(
      `INSERT INTO tasks (title, description, assignto, priority, due_date, due_time, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, description || null, assignees, priority, due_date, due_time, "pending"]
    );

    const task = newTask.rows[0];

    // Step 3: Create notifications for each employee
    const notifications = [];
    for (const employeeId of employeeIds) {
      const notificationResult = await pool.query(
        `INSERT INTO notifications (employee_id, message, task_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [employeeId, `A new task "${title}" has been assigned to you.`, task.id]
      );
      const notification = notificationResult.rows[0];
      notifications.push(notification);

      // Step 4: Send WebSocket notification if online
      const ws = clients.get(employeeId.toString());
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "taskAssigned",
            notification,
          })
        );
      }
    }

    res.status(201).json({
      message: "Task created successfully",
      notifications_sent: notifications.length,
      task,
      notifications,
    });

  } catch (err) {
    console.error("Error creating task:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});



// ============================
// Get all tasks
// ============================
router.get("/all", async (req, res) => {
  try {
    // Step 1: Update overdue tasks (for all employees)
    await pool.query(`
      UPDATE tasks
      SET status = 'overdue'
      WHERE status = 'pending'
      AND (due_date::date + due_time::time) < (NOW() AT TIME ZONE 'Asia/Kolkata');
    `);

    // Step 2: Fetch all tasks (join properly on assignto array)
    const tasks = await pool.query(
      `SELECT t.*
       FROM tasks t
       LEFT JOIN employees e ON e.email = ANY(t.assignto)
       ORDER BY t.due_date ASC, t.due_time ASC`
    );

    // Step 3: Format date (keep only YYYY-MM-DD)
    const formatted = tasks.rows.map(task => ({
      ...task,
      due_date: task.due_date ? task.due_date.toISOString().split("T")[0] : null
    }));

    // Step 4: Return only tasks
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
    const empId = parseInt(req.params.empId, 10); // ensure number
    if (isNaN(empId)) {
      return res.status(400).json({ error: "Invalid employee ID" });
    }

    // Step 1: Update overdue tasks for this employee
    await pool.query(
      `
      UPDATE tasks
      SET status = 'overdue'
      WHERE status = 'pending'
      AND EXISTS (
        SELECT 1 FROM employees e
        WHERE e.id = $1
        AND e.email = ANY(tasks.assignto)
      )
      AND (due_date::date + due_time::time) < (NOW() AT TIME ZONE 'Asia/Kolkata');
      `,
      [empId]
    );

    // Step 2: Fetch employee's tasks
    const tasks = await pool.query(
      `SELECT t.*
       FROM tasks t
       JOIN employees e ON e.email = ANY(t.assignto)
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
      due_date: task.due_date ? task.due_date.toISOString().split("T")[0] : null
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
    const { title, description, assignto, priority, due_date, due_time } = req.body;

    // Ensure assignto is always an array
    const assignees = Array.isArray(assignto) ? assignto : [assignto];

    const updatedTask = await pool.query(
      `UPDATE tasks 
       SET title = $1, 
           description = $2, 
           assignto = $3, 
           priority = $4, 
           due_date = $5,
           due_time = $6,
           status = CASE 
                      WHEN ($5::date + $6::time) < (NOW() AT TIME ZONE 'Asia/Kolkata')
                      THEN 'overdue'
                      ELSE 'pending'
                    END
       WHERE id = $7
       RETURNING *`,
      [title, description || null, assignees, priority, due_date || null, due_time || null, id]
    );

    if (updatedTask.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.status(200).json({
      message: "Task updated successfully",
      task: updatedTask.rows[0]
    });
  } catch (err) {
    console.error("Update error:", err);
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
