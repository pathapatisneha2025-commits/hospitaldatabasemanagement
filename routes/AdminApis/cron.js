const express = require("express");
const router = express.Router();
const pool = require("../../db");
const { DateTime } = require("luxon");

const CRON_SECRET = process.env.CRON_SECRET || "my_secret_key";

// -------------------- RUN RECURRING TASKS --------------------
router.get("/run-task", async (req, res) => {
  try {
    const { secret } = req.query;
    if (secret !== CRON_SECRET) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    console.log("Cron job triggered:", DateTime.now().setZone("Asia/Kolkata").toString());

    // 🧠 Fetch all recurring tasks
    const recurringTasks = await pool.query(
      `SELECT * FROM Admintasks WHERE RecurringType != 'Not Recurring'`
    );

    if (recurringTasks.rows.length === 0) {
      return res.status(200).json({ success: true, message: "No recurring tasks found" });
    }

    // 🕕 Get current date only (ignore time)
    const now = DateTime.now().setZone("Asia/Kolkata").startOf("day");

    for (const task of recurringTasks.rows) {
      const startDate = DateTime.fromJSDate(task.startdate).setZone("Asia/Kolkata").startOf("day");
      const dueDate = DateTime.fromJSDate(task.duedate).setZone("Asia/Kolkata").startOf("day");

      // ✅ Only create a new task if today's date >= dueDate (ignoring time)
      if (now >= dueDate) {
        let newStart;
        let newEnd;

        switch (task.recurringtype) {
          case "Daily":
            newStart = startDate.plus({ days: 1 });
            newEnd = newStart.plus({ days: 1 });
            break;
          case "Weekly":
            newStart = startDate.plus({ weeks: 1 });
            newEnd = newStart.plus({ weeks: 1 });
            break;
          case "Monthly":
            newStart = startDate.plus({ months: 1 });
            newEnd = newStart.plus({ months: 1 });
            break;
          default:
            continue; // skip unknown types
        }

        // 🔍 Check if a task already exists for that *date* (ignore time)
        const existing = await pool.query(
          `SELECT 1 FROM Admintasks WHERE title=$1 AND DATE(startdate)=$2`,
          [task.title, newStart.toISODate()] // compare only YYYY-MM-DD
        );

        if (existing.rowCount === 0) {
          // 🆕 Insert new recurring task
          const insertQuery = `
            INSERT INTO Admintasks 
            (Title, StartDate, DueDate, AssignedTo, Priority, Attachment, Description, RecurringType, CreatedAt, UpdatedAt)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
              NOW() AT TIME ZONE 'Asia/Kolkata',
              NOW() AT TIME ZONE 'Asia/Kolkata'
            )
          `;

          await pool.query(insertQuery, [
            task.title,
            newStart.toJSDate(),
            newEnd.toJSDate(),
            task.assignedto,
            task.priority,
            task.attachment,
            task.description,
            task.recurringtype,
          ]);

          console.log(`✅ Created new recurring task (by date): ${task.title} (${task.recurringtype})`);
        } else {
          console.log(`⚠️ Task already exists for date: ${task.title} (${task.recurringtype})`);
        }
      }
    }

    res.status(200).json({ success: true, message: "Recurring task check (date-only) completed" });
  } catch (error) {
    console.error("❌ Error running recurring task:", error.message);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

module.exports = router;
