// routes/tasks.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection

// Create new task
router.post("/add", async (req, res) => {
  try {
    const { title, description, assignto, priority, due_date, due_time, created_by } = req.body;

    // Validation
    if (!title || !assignto || !priority || !due_date || !due_time ) {
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

    // Step 2: Insert task with created_by
    const newTask = await pool.query(
      `INSERT INTO tasks 
        (title, description, assignto, priority, due_date, due_time, status, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() AT TIME ZONE 'Asia/Kolkata', $8)
       RETURNING *`,
      [
        title,
        description || null,
        assignees,
        priority,
        due_date,
        due_time,
        "pending",
        created_by, // <-- added created_by
      ]
    );

    const task = newTask.rows[0];

    // Step 3: Create notifications for each assignee
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
    // Step 1: Update overdue tasks
    await pool.query(`
      UPDATE tasks
      SET status = 'overdue'
      WHERE status = 'pending'
      AND (due_date::date + due_time::time) < (NOW() AT TIME ZONE 'Asia/Kolkata');
    `);

    // Step 2: Fetch all tasks with created_by employee full_name
    const tasks = await pool.query(`
      SELECT 
        t.*,
        e_created.full_name AS created_by_name
      FROM tasks t
      LEFT JOIN employees e_created ON e_created.id = t.created_by
      ORDER BY t.due_date ASC, t.due_time ASC
    `);

    // Step 3: Map assignto array emails to full_names
    const formatted = await Promise.all(
      tasks.rows.map(async (task) => {
        let assigneeNames = [];
        if (task.assignto && task.assignto.length > 0) {
          const assignees = await pool.query(
            `SELECT full_name FROM employees WHERE email = ANY($1)`,
            [task.assignto]
          );
          assigneeNames = assignees.rows.map(a => a.full_name);
        }

        return {
          ...task,
          due_date: task.due_date ? task.due_date.toISOString().split("T")[0] : null,
          created_by: task.created_by_name || null,  // employee name
          assignees: assigneeNames
        };
      })
    );

    // Step 4: Return tasks
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
    const empId = parseInt(req.params.empId, 10);

    if (isNaN(empId)) {
      return res.status(400).json({
        error: "Invalid employee ID",
      });
    }

    // Step 1: Update overdue tasks
    await pool.query(
      `
      UPDATE tasks
      SET status = 'overdue'
      WHERE status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM employees e
        WHERE e.id = $1
        AND e.email = ANY(tasks.assignto)
      )
      AND (
        due_date::date + due_time::time
      ) < (NOW() AT TIME ZONE 'Asia/Kolkata');
      `,
      [empId]
    );

    // Step 2: Fetch employee tasks with creator details
    const tasks = await pool.query(
      `
      SELECT 
        t.*,

        creator.id AS created_by,
        creator.full_name AS created_by_name,
        creator.email AS created_by_email

      FROM tasks t

      JOIN employees e
        ON e.email = ANY(t.assignto)

      LEFT JOIN employees creator
        ON creator.id = t.created_by

      WHERE e.id = $1

      ORDER BY t.due_date ASC, t.due_time ASC
      `,
      [empId]
    );

    if (tasks.rows.length === 0) {
      return res.status(404).json({
        error: "No tasks found for this employee ID",
      });
    }

    // Step 3: Format response
    const formatted = tasks.rows.map((task) => ({
      ...task,

      due_date: task.due_date
        ? task.due_date.toISOString().split("T")[0]
        : null,

      created_at: task.created_at
        ? new Date(task.created_at).toISOString()
        : null,
    }));

    // Step 4: Send response
    res.status(200).json({
      success: true,
      count: formatted.length,
      tasks: formatted,
    });

  } catch (err) {
    console.error("Get employee tasks error:", err.message);

    res.status(500).json({
      error: "Server error",
    });
  }
});
// GET /tasks/created/:employeeId
router.get("/created/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    // Optional: check if employee exists
    const empResult = await pool.query(
      "SELECT id, full_name, email FROM employees WHERE id = $1",
      [employeeId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Fetch tasks created by this employee
    const tasksResult = await pool.query(
      `SELECT *
       FROM tasks
       WHERE created_by = $1
       ORDER BY created_at DESC`,
      [employeeId]
    );

    res.status(200).json({
      success: true,
      tasks: tasksResult.rows,
    });
  } catch (err) {
    console.error("Error fetching tasks by creator:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});


// Update task by ID
// ============================
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, assignto, priority, due_date, due_time } = req.body;

    // ✅ Normalize to array
    let assignees = [];
    if (Array.isArray(assignto)) {
      assignees = assignto;
    } else if (typeof assignto === "string" && assignto.trim() !== "") {
      // Handle comma-separated string
      assignees = assignto.split(",").map((s) => s.trim());
    }

    // ✅ Update query
    const updatedTask = await pool.query(
      `UPDATE tasks 
       SET title = $1, 
           description = $2, 
           assignto = $3::text[], 
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
      task: updatedTask.rows[0],
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
const getISTTime = () => {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });
};

router.post("/update-status", async (req, res) => {
  const { id, status, reject_reason, completed_time } = req.body;

  try {
    let query = `
      UPDATE tasks
      SET status = $1
    `;

    const values = [status];

    if (status === "completed") {
      query += `, completed_time = $2 WHERE id = $3`;
      values.push(completed_time, id);
    } else if (status === "rejected") {
      query += `, reject_reason = $2 WHERE id = $3`;
      values.push(reject_reason, id);
    } else {
      query += ` WHERE id = $2`;
      values.push(id);
    }

    await db.query(query, values);

    res.json({
      success: true,
      message: "Task updated successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});




module.exports = router;
