// routes/cron.js
const express = require("express");
const router = express.Router();
const pool = require("../../db"); // adjust path if needed

// 🔐 Optional security key to protect endpoint
const CRON_SECRET = process.env.CRON_SECRET || "my_secret_key";

// -------------------- RUN RECURRING TASKS --------------------
router.get("/run-task", async (req, res) => {
  try {
    // ✅ Optional: verify secret key
    const { secret } = req.query;
    if (secret !== CRON_SECRET) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    console.log("Cron job triggered:", new Date());

    // 🧠 Fetch all recurring tasks from DB
    const recurringTasks = await pool.query(
      `SELECT * FROM Admintasks WHERE RecurringType != 'Not Recurring'`
    );

    if (recurringTasks.rows.length === 0) {
      return res.status(200).json({ success: true, message: "No recurring tasks found" });
    }

    // Loop through each recurring task and check if it needs to be recreated
    for (const task of recurringTasks.rows) {
      const { id, title, startdate, duedate, recurringtype } = task;

      // Example recurrence logic
      const now = new Date();
      const dueDate = new Date(duedate);

      // 🗓️ If the due date has passed, create a new one based on recurring type
      if (now >= dueDate) {
        let newStart, newEnd;

        if (recurringtype === "Daily") {
          newStart = new Date(dueDate.setDate(dueDate.getDate() + 1));
          newEnd = new Date(newStart);
          newEnd.setDate(newStart.getDate() + 1);
        } else if (recurringtype === "Weekly") {
          newStart = new Date(dueDate.setDate(dueDate.getDate() + 7));
          newEnd = new Date(newStart);
          newEnd.setDate(newStart.getDate() + 7);
        } else if (recurringtype === "Monthly") {
          newStart = new Date(dueDate.setMonth(dueDate.getMonth() + 1));
          newEnd = new Date(newStart);
          newEnd.setMonth(newStart.getMonth() + 1);
        } else {
          continue; // Skip if not a recognized type
        }

        // 🆕 Create a new recurring task entry
        const insertQuery = `
          INSERT INTO Admintasks (Title, StartDate, DueDate, AssignedTo, Priority, Attachment, Description, RecurringType)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        await pool.query(insertQuery, [
          title,
          newStart,
          newEnd,
          task.assignedto,
          task.priority,
          task.attachment,
          task.description,
          task.recurringtype,
        ]);

        console.log(`Recurring task duplicated: ${title} (${recurringtype})`);
      }
    }

    res.status(200).json({
      success: true,
      message: "Recurring task check completed successfully",
    });
  } catch (error) {
    console.error("Error running recurring task:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;
