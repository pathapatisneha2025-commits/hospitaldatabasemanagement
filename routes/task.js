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
      LEFT JOIN employees e_created 
        ON e_created.id = t.created_by
      ORDER BY t.due_date ASC, t.due_time ASC
    `);

    // Step 3: Format tasks + add assignees + departments
    const formatted = await Promise.all(
      tasks.rows.map(async (task) => {

        let assigneeNames = [];
        let assigneeDepartments = [];

        // IMPORTANT: ensure array safety
        const emails = Array.isArray(task.assignto)
          ? task.assignto
          : [];

        if (emails.length > 0) {

          const assignees = await pool.query(
            `SELECT full_name, department, email 
             FROM employees 
             WHERE email = ANY($1)`,
            [emails]
          );

          assigneeNames = assignees.rows.map(a => a.full_name);

          assigneeDepartments = [
            ...new Set(assignees.rows.map(a => a.department))
          ];
        }

        return {
          ...task,

          // format date
          due_date: task.due_date
            ? task.due_date.toISOString().split("T")[0]
            : null,

          // replace created_by id with name
          created_by: task.created_by_name || null,

          // names
          assignees: assigneeNames,

          // 🔥 NEW: departments of all assigned employees
          assignee_departments: assigneeDepartments
        };
      })
    );

    // Step 4: Response
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

    // Step 3: Format response (IMPORTANT FIX HERE)
    const formatted = tasks.rows.map((task) => ({
      ...task,

      due_date: task.due_date
        ? task.due_date.toISOString().split("T")[0]
        : null,

      created_at: task.created_at
        ? new Date(task.created_at).toISOString()
        : null,

      // ✅ FIX: always include reject_reason safely
      reject_reason: task.reject_reason || null,
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
});// GET /tasks/created/:employeeId
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
router.post("/reassign", async (req, res) => {
  const { task_id, new_assignee } = req.body;

  try {
    const assignees = Array.isArray(new_assignee)
      ? new_assignee
      : [new_assignee];

    const cleanEmails = assignees
      .filter(Boolean)
      .map(e => e.trim());

    // validate emails only
    const empResult = await pool.query(
      `SELECT id, email 
       FROM employees 
       WHERE email = ANY($1::text[])`,
      [cleanEmails]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Employee not found",
      });
    }

    const validEmails = empResult.rows.map(e => e.email);

    const updatedTask = await pool.query(
      `
      UPDATE tasks
      SET
        assignto = $1::text[],
        status = 'pending',
        updated_at = NOW(),
        reassigned_at = NOW(),
        reject_reason = NULL
      WHERE id = $2
      RETURNING *
      `,
      [validEmails, task_id]
    );

    return res.json({
      success: true,
      task: updatedTask.rows[0],
    });

  } catch (err) {
    console.error("Reassign task error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to reassign task",
    });
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
  const { id, status, reject_reason } = req.body;

  try {
    const now = new Date();

    let query = `UPDATE tasks SET status = $1`;
    let values = [status];
    let index = 2;

    // ✅ START
    if (status === "in_progress") {
      query += `, start_time = $${index}`;
      values.push(now);
      index++;
    }

    // ✅ COMPLETE
    if (status === "completed") {
      query += `, completed_time = $${index}`;
      values.push(now);
      index++;

      const task = await pool.query(
        `SELECT start_time FROM tasks WHERE id = $1`,
        [id]
      );

      const startTime = task.rows[0]?.start_time;

      if (startTime) {
        const diffMs = new Date(now) - new Date(startTime);
        const mins = Math.floor(diffMs / 60000);

        const hours = Math.floor(mins / 60);
        const minutes = mins % 60;

        const totalTime =
          hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        query += `, total_time = $${index}`;
        values.push(totalTime);
        index++;
      }
    }

    // 🔥 FIX: REJECT reason save
    if (status === "rejected") {
      query += `, reject_reason = $${index}`;
      values.push(reject_reason || "No reason provided");
      index++;
    }

    query += ` WHERE id = $${index}`;
    values.push(id);

    await pool.query(query, values);

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});module.exports = router;
