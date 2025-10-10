const express = require("express");
const router = express.Router();
const pool = require("../../db"); // adjust path if needed
const { DateTime } = require("luxon");

// 🔐 Optional security key to protect endpoint
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

    const now = DateTime.now().setZone("Asia/Kolkata");

    for (const task of recurringTasks.rows) {
      const startDate = DateTime.fromJSDate(task.startdate).setZone("Asia/Kolkata");
      const dueDate = DateTime.fromJSDate(task.duedate).setZone("Asia/Kolkata");

      // ✅ Only create a new task if current date is past dueDate
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
            continue; // skip if unrecognized
        }

        // 🔎 Check if task for the next start date already exists
        const existing = await pool.query(
          `SELECT 1 FROM Admintasks WHERE title=$1 AND startdate=$2`,
          [task.title, newStart.toJSDate()]
        );

        if (existing.rowCount === 0) {
          // 🆕 Insert new recurring task with PostgreSQL generating CreatedAt & UpdatedAt
          const insertQuery = `
            INSERT INTO Admintasks 
            (Title, StartDate, DueDate, AssignedTo, Priority, Attachment, Description, RecurringType, CreatedAt, UpdatedAt)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW() AT TIME ZONE 'Asia/Kolkata', NOW() AT TIME ZONE 'Asia/Kolkata')
          `;

          await pool.query(insertQuery, [
            task.title,
            newStart.toJSDate(),
            newEnd.toJSDate(),
            task.assignedto,
            task.priority,
            task.attachment,
            task.description,
            task.recurringtype
          ]);

          console.log(`Recurring task created: ${task.title} (${task.recurringtype})`);
        } else {
          console.log(`Recurring task already exists: ${task.title} (${task.recurringtype})`);
        }
      }
    }

    res.status(200).json({ success: true, message: "Recurring task check completed successfully" });
  } catch (error) {
    console.error("Error running recurring task:", error.message);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
});

module.exports = router;
